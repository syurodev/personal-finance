import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAccountTools } from './tools/account.tools.js';
import { registerCategoryTools } from './tools/category.tools.js';
import { registerOverviewTool } from './tools/overview.tool.js';
import { registerReconcileTool } from './tools/reconcile.tool.js';
import { registerTransactionTools } from './tools/transaction.tools.js';
import { registerWhoamiTool } from './tools/whoami.tool.js';

export const SERVER_INSTRUCTIONS = [
  'Đây là sổ thu chi cá nhân của người dùng.',
  'Trả lời người dùng bằng ngôn ngữ họ dùng.',
  'Đầu mỗi cuộc trò chuyện, gọi get_overview để biết ngày hôm nay theo múi giờ người dùng, các ví và danh mục.',
  'Số tiền luôn là chuỗi số dương với dấu chấm thập phân ("85000", "12.5"); chiều thu/chi do tham số type quyết định. Đổi "85k" thành "85000", "2tr" thành "2000000".',
  'Ghi nhiều khoản trong một lần gọi record_transactions.',
  'Chi tiêu bằng thẻ tín dụng ghi vào ví thẻ; trả nợ thẻ, rút tiền ATM, nạp ví điện tử là record_transfer.',
  'Không tự tạo ví hay danh mục mới khi chưa hỏi người dùng.',
  'Khi một tool trả lỗi dạng JSON {code, message}, đọc message để sửa tham số rồi gọi lại; với AMBIGUOUS_* hoặc *_NOT_FOUND thì hỏi người dùng chọn trong candidates/suggestions.',
].join('\n');

/** Tạo server mới cho mỗi request (transport stateless không dùng lại được). */
export function createMcpServer(): McpServer {
  const server = new McpServer(
    { name: 'personal-finance', version: '0.2.0' },
    { instructions: SERVER_INSTRUCTIONS },
  );
  registerWhoamiTool(server);
  registerOverviewTool(server);
  registerAccountTools(server);
  registerCategoryTools(server);
  registerTransactionTools(server);
  registerReconcileTool(server);
  return server;
}
