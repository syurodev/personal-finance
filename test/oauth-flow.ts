import { createHash, randomBytes } from 'node:crypto';

export interface OAuthTokens {
  access_token: string;
  refresh_token?: string;
  scope: string;
  expires_in: number;
  token_type: string;
}

export const REDIRECT_URI = 'http://localhost:6274/oauth/callback';
export const ALL_SCOPES = 'offline_access finance:read finance:write';

async function expectOk(res: Response, step: string): Promise<unknown> {
  const text = await res.text();
  if (!res.ok) throw new Error(`${step} failed: ${res.status} ${text}`);
  return text ? JSON.parse(text) : {};
}

/** better-auth trả 302 (navigation) hoặc JSON { redirect, url } (fetch): chấp nhận cả hai. */
async function readRedirect(res: Response, baseUrl: string, step: string): Promise<URL> {
  if (res.status >= 300 && res.status < 400) {
    const location = res.headers.get('location');
    if (!location) throw new Error(`${step}: redirect without location`);
    return new URL(location, baseUrl);
  }
  const body = (await expectOk(res, step)) as { url?: string };
  if (!body.url) throw new Error(`${step}: no redirect url in ${JSON.stringify(body)}`);
  return new URL(body.url, baseUrl);
}

export async function registerClient(baseUrl: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/auth/oauth2/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: 'E2E MCP Client',
      redirect_uris: [REDIRECT_URI],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    }),
  });
  const body = (await expectOk(res, 'register')) as { client_id: string };
  return body.client_id;
}

/** Chạy giống Claude/ChatGPT: authorize → login → consent → đổi code lấy token (PKCE). */
export async function authorizeAndExchange(
  baseUrl: string,
  clientId: string,
  credentials: { email: string; password: string },
  scope = ALL_SCOPES,
): Promise<OAuthTokens> {
  const origin = { origin: baseUrl };
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const resource = `${baseUrl}/mcp`;

  const authorizeUrl = new URL(`${baseUrl}/api/auth/oauth2/authorize`);
  authorizeUrl.search = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    scope,
    state: 'e2e-state',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    resource,
  }).toString();
  const loginUrl = await readRedirect(await fetch(authorizeUrl, { redirect: 'manual' }), baseUrl, 'authorize');
  if (loginUrl.pathname !== '/login') throw new Error(`authorize: expected /login, got ${loginUrl.href}`);

  const signIn = await fetch(`${baseUrl}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...origin },
    body: JSON.stringify({ ...credentials, oauth_query: loginUrl.search.slice(1) }),
  });
  const cookie = signIn.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
  let next = await readRedirect(signIn, baseUrl, 'sign-in');

  if (next.pathname === '/consent') {
    const consent = await fetch(`${baseUrl}/api/auth/oauth2/consent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie, ...origin },
      body: JSON.stringify({ accept: true, oauth_query: next.search.slice(1) }),
    });
    next = await readRedirect(consent, baseUrl, 'consent');
  }

  const code = next.searchParams.get('code');
  if (!code || next.searchParams.get('state') !== 'e2e-state') {
    throw new Error(`expected callback with code and state, got ${next.href}`);
  }

  const token = await fetch(`${baseUrl}/api/auth/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier,
      redirect_uri: REDIRECT_URI,
      client_id: clientId,
      resource,
    }),
  });
  return (await expectOk(token, 'token')) as OAuthTokens;
}

export async function refresh(baseUrl: string, clientId: string, refreshToken: string): Promise<OAuthTokens> {
  const res = await fetch(`${baseUrl}/api/auth/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
      resource: `${baseUrl}/mcp`,
    }),
  });
  return (await expectOk(res, 'refresh')) as OAuthTokens;
}
