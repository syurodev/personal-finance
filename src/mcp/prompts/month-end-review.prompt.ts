import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { todayIn } from '../../common/dates.js';
import { monthRange, parseMonth, reviewMonth } from '../../common/periods.js';
import { getUserSettings } from '../../ledger/user-settings.js';

export function buildReviewScript(month: string): string {
  const { from, to } = monthRange(month);
  return [
    `Hãy cùng tôi tổng kết tài chính tháng ${month} (${from} → ${to}). Làm lần lượt:`,
    '1. Gọi get_overview. Liệt kê các ví đang dùng và hỏi tôi số dư thực tế của chúng trong một câu hỏi. Ví nào tôi trả lời thì gọi reconcile_account; bỏ qua ví tôi không trả lời.',
    `2. Gọi cashflow_summary với from=${from}, to=${to}, group_by=category, compare_previous=true. Trình bày tổng thu, tổng chi, phần để dành và tỷ lệ tiết kiệm; 5 danh mục chi lớn nhất; danh mục tăng/giảm nhiều nhất so với kỳ trước.`,
    `3. Gọi get_budget_status với month=${month}. Nêu các danh mục vượt (over) hoặc sắp vượt (warning) ngân sách.`,
    `4. Gọi search_transactions với from=${from}, to=${to}, type=expense, sort=amount_desc, limit=5 để nêu 5 khoản chi lớn nhất.`,
    '5. Gọi list_upcoming_payments để nêu các kỳ trả nợ quá hạn và đến hạn trong 30 ngày tới (nếu có khoản vay).',
    '6. Nhận xét ngắn gọn và đề xuất 1–3 điều chỉnh. Nếu đề xuất ngân sách cho tháng sau, chỉ gọi set_budget khi tôi đồng ý.',
    'Dùng đúng số liệu tool trả về, không tự cộng trừ lại.',
  ].join('\n');
}

export function registerMonthEndReviewPrompt(server: McpServer): void {
  server.registerPrompt(
    'month_end_review',
    {
      title: 'Tổng kết tháng',
      description: 'Kịch bản tổng kết tài chính một tháng: đối soát ví, thu chi so với tháng trước, ngân sách, khoản chi lớn, nhận xét.',
      argsSchema: {
        month: z
          .string()
          .optional()
          .describe('Tháng YYYY-MM; bỏ trống = tháng trước nếu đang ở 7 ngày đầu tháng, ngược lại là tháng này'),
      },
    },
    async ({ month }) => {
      // Prompt chạy trong ngữ cảnh request đã xác thực (runAsUser), nên đọc được timezone của user.
      const target = month ? parseMonth(month) : reviewMonth(todayIn((await getUserSettings()).timezone));
      return {
        description: `Tổng kết tháng ${target}`,
        messages: [{ role: 'user' as const, content: { type: 'text' as const, text: buildReviewScript(target) } }],
      };
    },
  );
}
