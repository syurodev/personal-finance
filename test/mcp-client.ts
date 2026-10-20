import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

export async function connectMcp(baseUrl: string, accessToken: string): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
  const client = new Client({ name: 'e2e', version: '1.0.0' });
  await client.connect(transport);
  return client;
}

// SDK callTool trả về một union trong đó biến thể compat (toolResult) không có `content`;
// weak-type check của TS 6 từ chối `{ content?: unknown }`, nên nhận unknown và thu hẹp bên trong.
function firstText(result: unknown): string {
  return (result as { content?: Array<{ text?: string }> }).content?.[0]?.text ?? '';
}

/** Gọi tool, ném lỗi nếu tool trả isError; trả về structuredContent. */
export async function callOk<T = any>(client: Client, name: string, args: Record<string, unknown> = {}): Promise<T> {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError) throw new Error(`${name} failed: ${firstText(result)}`);
  return result.structuredContent as T;
}

/** Gọi tool mong đợi lỗi nghiệp vụ; trả về body JSON {code, message, details}. */
export async function callError(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<{ code: string; message: string; details?: any }> {
  const result = await client.callTool({ name, arguments: args });
  if (!result.isError) throw new Error(`${name} unexpectedly succeeded`);
  return JSON.parse(firstText(result));
}
