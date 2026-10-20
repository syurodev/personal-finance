import type { NestExpressApplication } from '@nestjs/platform-express';
import { auth } from '../src/auth/auth.js';
import { startApp } from './app.js';
import { connectMcp } from './mcp-client.js';
import { authorizeAndExchange, refresh, registerClient } from './oauth-flow.js';

const credentials = { email: 'oauth-e2e@example.com', password: 'password-123' };

describe('OAuth connect → MCP tool call', () => {
  let app: NestExpressApplication;
  let baseUrl: string;
  let userId: string;

  beforeAll(async () => {
    ({ app, baseUrl } = await startApp());
    const result = await auth.api.signUpEmail({ body: { name: 'E2E', ...credentials } });
    userId = result.user.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('a dynamically registered client can connect and call whoami', async () => {
    const clientId = await registerClient(baseUrl);
    const tokens = await authorizeAndExchange(baseUrl, clientId, credentials);
    expect(tokens.refresh_token).toBeTruthy();

    const client = await connectMcp(baseUrl, tokens.access_token);
    try {
      expect(client.getInstructions()).toContain('sổ thu chi');
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name)).toContain('whoami');

      const result = await client.callTool({ name: 'whoami', arguments: {} });
      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toMatchObject({
        user_id: userId,
        client_id: clientId,
        db_user_context: userId,
      });
      expect((result.structuredContent as { scopes: string[] }).scopes).toEqual(
        expect.arrayContaining(['finance:read', 'finance:write']),
      );
    } finally {
      await client.close();
    }
  });

  it('a refreshed access token keeps working', async () => {
    const clientId = await registerClient(baseUrl);
    const first = await authorizeAndExchange(baseUrl, clientId, credentials);
    const second = await refresh(baseUrl, clientId, first.refresh_token!);
    expect(second.access_token).not.toBe(first.access_token);

    const client = await connectMcp(baseUrl, second.access_token);
    try {
      const result = await client.callTool({ name: 'whoami', arguments: {} });
      expect(result.structuredContent).toMatchObject({ user_id: userId });
    } finally {
      await client.close();
    }
  });

  it('a token without finance:read gets INSUFFICIENT_SCOPE from whoami', async () => {
    const clientId = await registerClient(baseUrl);
    const tokens = await authorizeAndExchange(baseUrl, clientId, credentials, 'offline_access finance:write');
    const client = await connectMcp(baseUrl, tokens.access_token);
    try {
      const result = await client.callTool({ name: 'whoami', arguments: {} });
      expect(result.isError).toBe(true);
      expect(JSON.parse((result.content as Array<{ text: string }>)[0]!.text).code).toBe('INSUFFICIENT_SCOPE');
    } finally {
      await client.close();
    }
  });
});
