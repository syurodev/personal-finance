import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { FINANCE_READ, FINANCE_WRITE } from '../../auth/constants.js';
import { getBudgetStatus, setBudget } from '../../ledger/budgets.js';
import { runTool } from '../tool-kit.js';
import { amountInput, categoryRef, READ_ONLY, WRITE } from './schemas.js';

const monthInput = z.string().describe('Tháng dạng YYYY-MM; bỏ trống = tháng hiện tại theo múi giờ người dùng');

const measure = {
  limit: z.string(),
  spent: z.string(),
  remaining: z.string(),
  percent: z.number(),
  status: z.enum(['ok', 'warning', 'over']),
};

export function registerBudgetTools(server: McpServer): void {
  server.registerTool(
    'set_budget',
    {
      title: 'Đặt ngân sách',
      description:
        'Đặt hạn mức chi hằng tháng cho một danh mục chi (tính cả danh mục con), áp dụng từ from_month cho các tháng sau cho tới khi đặt lại. amount=null để bỏ hạn mức từ tháng đó. Hỏi người dùng trước khi đặt.',
      inputSchema: {
        category: categoryRef,
        amount: amountInput.nullable().describe('Hạn mức tháng; null để bỏ'),
        from_month: monthInput.optional(),
      },
      outputSchema: {
        category: z.object({ id: z.string(), name: z.string() }),
        effective_from: z.string(),
        limit: z.string().nullable(),
        currency: z.string(),
      },
      annotations: WRITE,
    },
    async ({ category, amount, from_month }) =>
      runTool(
        FINANCE_WRITE,
        () => setBudget({ category, amount, fromMonth: from_month }),
        (d) =>
          d.limit === null
            ? `Đã bỏ ngân sách "${d.category.name}" từ ${d.effective_from}.`
            : `Ngân sách "${d.category.name}": ${d.limit} ${d.currency}/tháng từ ${d.effective_from}.`,
      ),
  );

  server.registerTool(
    'get_budget_status',
    {
      title: 'Tình hình ngân sách',
      description:
        'Với mỗi danh mục có ngân sách trong tháng: hạn mức, đã chi, còn lại, % và trạng thái (ok, warning từ 80%, over). Kèm số ngày đã qua trong tháng để đánh giá tốc độ chi. Dùng đúng số liệu trả về.',
      inputSchema: { month: monthInput.optional() },
      outputSchema: {
        month: z.string(),
        currency: z.string(),
        days_in_month: z.number(),
        days_elapsed: z.number(),
        items: z.array(
          z.object({
            ...measure,
            category: z.object({ id: z.string(), name: z.string() }),
            effective_from: z.string(),
          }),
        ),
        total: z.object(measure).nullable(),
      },
      annotations: READ_ONLY,
    },
    async ({ month }) =>
      runTool(FINANCE_READ, () => getBudgetStatus(month), (d) =>
        d.total
          ? `Tháng ${d.month}: đã chi ${d.total.spent}/${d.total.limit} ${d.currency} (${d.total.percent}%).`
          : `Tháng ${d.month} chưa có ngân sách nào.`,
      ),
  );
}
