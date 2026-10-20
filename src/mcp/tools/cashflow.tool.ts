import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { FINANCE_READ } from '../../auth/constants.js';
import { CASHFLOW_GROUPS, cashflowSummary } from '../../ledger/cashflow.js';
import { runTool } from '../tool-kit.js';
import { READ_ONLY } from './schemas.js';

const totals = z.object({
  currency: z.string(),
  income: z.string(),
  expense: z.string(),
  net: z.string(),
  savings_rate: z.number().nullable(),
  count: z.number(),
});

const group = z.object({
  currency: z.string(),
  key: z.string().nullable(),
  label: z.string(),
  income: z.string(),
  expense: z.string(),
  net: z.string(),
  count: z.number(),
});

const period = { from: z.string(), to: z.string(), totals: z.array(totals), groups: z.array(group) };

export function registerCashflowTool(server: McpServer): void {
  server.registerTool(
    'cashflow_summary',
    {
      title: 'Báo cáo thu chi',
      description:
        'Tổng thu, tổng chi, chênh lệch (net) và tỷ lệ tiết kiệm (savings_rate = net/income) trong khoảng from..to, tách theo tiền tệ; không tính chuyển khoản và điều chỉnh. group_by để chia theo danh mục cấp 1 (gồm con), ví, merchant, tháng, tuần hoặc ngày. compare_previous=true so với kỳ liền trước (tháng trọn → tháng trước). Dùng đúng số liệu trả về, không tự cộng trừ lại.',
      inputSchema: {
        from: z.string().describe('YYYY-MM-DD'),
        to: z.string().describe('YYYY-MM-DD'),
        type: z.enum(['all', 'expense', 'income']).optional().describe('Mặc định all'),
        group_by: z.enum(CASHFLOW_GROUPS).optional(),
        compare_previous: z.boolean().optional(),
      },
      outputSchema: {
        ...period,
        type: z.enum(['all', 'expense', 'income']),
        group_by: z.enum(CASHFLOW_GROUPS).nullable(),
        previous: z.object(period).nullable(),
        comparison: z
          .array(
            z.object({
              currency: z.string(),
              income_change: z.string(),
              expense_change: z.string(),
              net_change: z.string(),
            }),
          )
          .nullable(),
      },
      annotations: READ_ONLY,
    },
    async ({ from, to, type, group_by, compare_previous }) =>
      runTool(
        FINANCE_READ,
        () => cashflowSummary({ from, to, type, groupBy: group_by, comparePrevious: compare_previous }),
        (d) =>
          d.totals.length === 0
            ? `Không có khoản thu/chi nào từ ${d.from} đến ${d.to}.`
            : d.totals.map((x) => `${x.currency}: thu ${x.income}, chi ${x.expense}, còn ${x.net}`).join('; '),
      ),
  );
}
