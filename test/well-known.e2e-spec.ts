import type { NestExpressApplication } from '@nestjs/platform-express';
import { startApp } from './app.js';

describe('.well-known discovery', () => {
  let app: NestExpressApplication;
  let baseUrl: string;

  beforeAll(async () => {
    ({ app, baseUrl } = await startApp());
  });

  afterAll(async () => {
    await app.close();
  });

  it.each(['/.well-known/oauth-protected-resource/mcp', '/.well-known/oauth-protected-resource'])(
    'GET %s returns protected resource metadata',
    async (path) => {
      const res = await fetch(`${baseUrl}${path}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.resource).toBe(`${baseUrl}/mcp`);
      expect(body.authorization_servers).toEqual([`${baseUrl}/api/auth`]);
    },
  );

  it.each(['/.well-known/oauth-authorization-server/api/auth', '/.well-known/oauth-authorization-server'])(
    'GET %s returns authorization server metadata with DCR and PKCE',
    async (path) => {
      const res = await fetch(`${baseUrl}${path}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.issuer).toBe(`${baseUrl}/api/auth`);
      expect(body.registration_endpoint).toBe(`${baseUrl}/api/auth/oauth2/register`);
      expect(body.token_endpoint).toBe(`${baseUrl}/api/auth/oauth2/token`);
      expect(body.code_challenge_methods_supported).toContain('S256');
      expect(body.token_endpoint_auth_methods_supported).toContain('none');
    },
  );
});
