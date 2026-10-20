import type { NestExpressApplication } from '@nestjs/platform-express';
import { startApp } from './app.js';

const initialize = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } },
};

describe('/mcp authentication', () => {
  let app: NestExpressApplication;
  let baseUrl: string;

  beforeAll(async () => {
    ({ app, baseUrl } = await startApp());
  });

  afterAll(async () => {
    await app.close();
  });

  const post = (headers: Record<string, string>) =>
    fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
      body: JSON.stringify(initialize),
    });

  it('returns 401 with resource metadata pointer when no token is sent', async () => {
    const res = await post({});
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toBe(
      `Bearer resource_metadata="${baseUrl}/.well-known/oauth-protected-resource/mcp"`,
    );
  });

  it('returns 401 for an unknown token', async () => {
    const res = await post({ authorization: 'Bearer not-a-real-token' });
    expect(res.status).toBe(401);
  });

  it.each(['GET', 'DELETE'])('%s /mcp returns 405', async (method) => {
    const res = await fetch(`${baseUrl}/mcp`, { method });
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('POST');
  });
});
