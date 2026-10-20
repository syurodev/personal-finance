import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { FINANCE_READ } from '../../auth/constants.js';
import { getOverview } from '../../ledger/overview.js';
import { runTool } from '../tool-kit.js';
import { accountView, categoryNode, dateInput, READ_ONLY } from './schemas.js';

export function registerOverviewTool(server: McpServer): void {
  server.registerTool(
    'get_overview',
    {
      title: 'Tổng quan tài chính',
      description:
        'Gọi đầu mỗi cuộc trò chuyện. Trả về ngày hôm nay theo múi giờ người dùng, tiền tệ mặc định, các ví và số dư (tại as_of), tổng tài sản theo tiền tệ, cây danh mục, và tóm tắt ngân sách của tháng chứa as_of (null nếu chưa đặt).',
      inputSchema: { as_of: dateInput.optional() },
      outputSchema: {
        today: z.string(),
        as_of: z.string(),
        timezone: z.string(),
        base_currency: z.string(),
        accounts: z.array(accountView),
        net_worth: z.array(z.object({ currency: z.string(), total: z.string() })),
        categories: z.array(categoryNode),
        budget: z
          .object({
            month: z.string(),
            currency: z.string(),
            limit: z.string(),
            spent: z.string(),
            remaining: z.string(),
            percent: z.number(),
            over_count: z.number(),
            warning_count: z.number(),
          })
          .nullable(),
      },
      annotations: READ_ONLY,
    },
    async ({ as_of }) =>
      runTool(FINANCE_READ, () => getOverview(as_of), (d) => {
        const worth = d.net_worth.map((n) => `${n.total} ${n.currency}`).join(', ') || '0';
        const budget = d.budget ? ` Ngân sách ${d.budget.month}: ${d.budget.spent}/${d.budget.limit} (${d.budget.percent}%).` : '';
        return `Hôm nay ${d.today}. ${d.accounts.length} ví; tổng tài sản: ${worth}.${budget}`;
      }),
  );
}
