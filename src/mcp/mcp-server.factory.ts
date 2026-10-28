import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerMonthEndReviewPrompt } from './prompts/month-end-review.prompt.js';
import { registerAccountTools } from './tools/account.tools.js';
import { registerBudgetTools } from './tools/budget.tools.js';
import { registerCashflowTool } from './tools/cashflow.tool.js';
import { registerCategoryTools } from './tools/category.tools.js';
import { registerLoanTools } from './tools/loan.tools.js';
import { registerOverviewTool } from './tools/overview.tool.js';
import { registerReconcileTool } from './tools/reconcile.tool.js';
import { registerTransactionTools } from './tools/transaction.tools.js';
import { registerWhoamiTool } from './tools/whoami.tool.js';

/** Khớp `version` trong package.json và CHANGELOG.md. */
export const SERVER_VERSION = '0.4.0';

export const SERVER_INSTRUCTIONS = [
  'Đây là sổ thu chi cá nhân của người dùng.',
  'Trả lời người dùng bằng ngôn ngữ họ dùng.',
  'Đầu mỗi cuộc trò chuyện, gọi get_overview để biết ngày hôm nay theo múi giờ người dùng, các ví, danh mục và ngân sách tháng.',
  'Số tiền luôn là chuỗi số dương với dấu chấm thập phân ("85000", "12.5"); chiều thu/chi do tham số type quyết định. Đổi "85k" thành "85000", "2tr" thành "2000000".',
  'Ghi nhiều khoản trong một lần gọi record_transactions.',
  'Chi tiêu bằng thẻ tín dụng ghi vào ví thẻ; trả nợ thẻ, rút tiền ATM, nạp ví điện tử là record_transfer.',
  'Hỏi về hạn mức, "còn bao nhiêu cho …" → get_budget_status. Tổng kết, so sánh thu chi giữa các kỳ → cashflow_summary. Tổng kết cuối tháng có thể theo prompt month_end_review.',
  'Khoản vay, trả góp, cho vay: dùng create_loan với số tiền mỗi kỳ đã gồm lãi (tự tạo ví nợ và lịch trả); trả một kỳ dùng record_loan_payment, không dùng record_transfer. "Tháng này phải trả gì" → list_upcoming_payments. Nếu get_overview báo kỳ quá hạn, nhắc người dùng.',
  'Cho người khác mượn tiền (không lãi): dùng lend_money với from_account = ví đưa tiền. Khi họ trả lại ("bạn trả nợ", "thu hồi tiền cho mượn"): dùng receive_repayment với to_account = ví nhận (có thể khác ví đã đưa); nhiều khoản khớp hoặc không thấy khoản nào thì gọi get_loan_status rồi hỏi người dùng một câu ngắn. KHÔNG ghi tiền thu hồi bằng record_transactions type income hay record_transfer: tiền gốc nhận lại không phải thu nhập, ghi vậy ví tăng mà khoản phải thu vẫn còn nên tài sản bị tính trùng. Nếu đã lỡ ghi income cho khoản đó, truyền id của nó vào replaces_transaction. Ghi sai các giao dịch khác thì sửa bằng update_transaction hoặc delete_transaction, không ghi bù thêm giao dịch.',
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
  registerLoanTools(server);
  registerMonthEndReviewPrompt(server);
  return server;
}
