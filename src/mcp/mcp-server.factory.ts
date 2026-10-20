import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerMonthEndReviewPrompt } from './prompts/month-end-review.prompt.js';
import { registerAccountTools } from './tools/account.tools.js';
import { registerBudgetTools } from './tools/budget.tools.js';
import { registerCashflowTool } from './tools/cashflow.tool.js';
import { registerCategoryTools } from './tools/category.tools.js';
import { registerOverviewTool } from './tools/overview.tool.js';
import { registerReconcileTool } from './tools/reconcile.tool.js';
import { registerTransactionTools } from './tools/transaction.tools.js';
import { registerWhoamiTool } from './tools/whoami.tool.js';

/** Khớp `version` trong package.json và CHANGELOG.md. */
export const SERVER_VERSION = '0.3.0';

export const SERVER_INSTRUCTIONS = [
  'Đây là sổ thu chi cá nhân của người dùng.',
  'Trả lời người dùng bằng ngôn ngữ họ dùng.',
  'Đầu mỗi cuộc trò chuyện, gọi get_overview để biết ngày hôm nay theo múi giờ người dùng, các ví, danh mục và ngân sách tháng.',
  'Số tiền luôn là chuỗi số dương với dấu chấm thập phân ("85000", "12.5"); chiều thu/chi do tham số type quyết định. Đổi "85k" thành "85000", "2tr" thành "2000000".',
  'Ghi nhiều khoản trong một lần gọi record_transactions.',
  'Chi tiêu bằng thẻ tín dụng ghi vào ví thẻ; trả nợ thẻ, rút tiền ATM, nạp ví điện tử là record_transfer.',
  'Hỏi về hạn mức, "còn bao nhiêu cho …" → get_budget_status. Tổng kết, so sánh thu chi giữa các kỳ → cashflow_summary. Tổng kết cuối tháng có thể theo prompt month_end_review.',
  'Dùng đúng số liệu tool trả về; không tự cộng trừ lại.',
  'Không tự tạo ví, danh mục hay ngân sách khi chưa hỏi người dùng.',
  'Khi một tool trả lỗi dạng JSON {code, message}, đọc message để sửa tham số rồi gọi lại; với AMBIGUOUS_* hoặc *_NOT_FOUND thì hỏi người dùng chọn trong candidates/suggestions.',
].join('\n');

/** Tạo server mới cho mỗi request (transport stateless không dùng lại được). */
export function createMcpServer(): McpServer {
  const server = new McpServer({ name: 'personal-finance', version: SERVER_VERSION }, { instructions: SERVER_INSTRUCTIONS });
  registerWhoamiTool(server);
  registerOverviewTool(server);
  registerAccountTools(server);
  registerCategoryTools(server);
  registerTransactionTools(server);
  registerReconcileTool(server);
  registerBudgetTools(server);
  registerCashflowTool(server);
  registerMonthEndReviewPrompt(server);
  return server;
}
