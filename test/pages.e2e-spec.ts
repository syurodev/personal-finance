import type { NestExpressApplication } from '@nestjs/platform-express';
import { startApp } from './app.js';

describe('pages', () => {
  let app: NestExpressApplication;
  let baseUrl: string;

  beforeAll(async () => {
    ({ app, baseUrl } = await startApp());
  });

  afterAll(async () => {
    await app.close();
  });

  it.each([
    ['/login', 'text/html', 'auth-form'],
    ['/consent', 'text/html', 'consent-actions'],
    ['/assets/login.js', 'text/javascript', 'oauth_query'],
    ['/assets/consent.js', 'text/javascript', '/api/auth/oauth2/consent'],
    ['/assets/style.css', 'text/css', 'body'],
  ])('GET %s serves %s', async (path, type, marker) => {
    const res = await fetch(`${baseUrl}${path}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain(type);
    expect(await res.text()).toContain(marker);
  });

  it('sends a strict CSP on HTML pages', async () => {
    const res = await fetch(`${baseUrl}/login`);
    const csp = res.headers.get('content-security-policy') ?? '';
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
  });
});
