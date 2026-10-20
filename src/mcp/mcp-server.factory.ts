import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerWhoamiTool } from './tools/whoami.tool.js';

export const SERVER_INSTRUCTIONS = [
  'Đây là sổ thu chi cá nhân của người dùng.',
  'Trả lời người dùng bằng ngôn ngữ họ dùng.',
  'Khi một tool trả lỗi dạng JSON {code, message}, đọc message để sửa tham số rồi gọi lại; nếu cần lựa chọn của người dùng thì hỏi họ.',
].join('\n');

/** Tạo server mới cho mỗi request (transport stateless không dùng lại được). */
export function createMcpServer(): McpServer {
  const server = new McpServer(
    { name: 'personal-finance', version: '0.1.0' },
    { instructions: SERVER_INSTRUCTIONS },
  );
  registerWhoamiTool(server);
  return server;
}
