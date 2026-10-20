import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { FINANCE_READ, FINANCE_WRITE } from '../../auth/constants.js';
import { TRANSACTION_KINDS } from '../../db/schema/index.js';
import {
  deleteTransaction,
  recordTransactions,
  recordTransfer,
  searchTransactions,
  updateTransaction,
} from '../../ledger/transactions.js';
import { runTool } from '../tool-kit.js';
import {
  accountRef,
  amountInput,
  balanceView,
  categoryRef,
  dateInput,
  entryType,
  READ_ONLY,
  transactionView,
  WRITE,
} from './schemas.js';

export function registerTransactionTools(server: McpServer): void {
  server.registerTool(
    'record_transactions',
    {
      title: 'Ghi thu/chi',
      description:
        'Ghi 1–50 khoản thu hoặc chi trong một lần gọi. Cả lô ghi nguyên tử: một dòng lỗi thì không dòng nào được ghi (lỗi chỉ rõ dòng). Chuyển tiền giữa các ví dùng record_transfer.',
      inputSchema: {
        items: z
          .array(
            z.object({
              amount: amountInput,
              type: entryType,
              account: accountRef,
              category: categoryRef.optional(),
              occurred_on: dateInput.optional(),
              description: z.string().optional().describe('Mô tả ngắn, ví dụ "Phở bò"'),
              merchant: z.string().optional().describe('Nơi chi tiêu/nguồn thu, ví dụ "Highlands"'),
              note: z.string().optional(),
            }),
          )
          .min(1)
          .max(50),
      },
      outputSchema: { created: z.array(transactionView), balances: z.array(balanceView) },
      annotations: WRITE,
    },
    async ({ items }) =>
      runTool(
        FINANCE_WRITE,
        () =>
          recordTransactions(
            items.map((item) => ({
              amount: item.amount,
              type: item.type,
              account: item.account,
              category: item.category,
              occurredOn: item.occurred_on,
              description: item.description,
              merchant: item.merchant,
              note: item.note,
            })),
          ),
        (d) => `Đã ghi ${d.created.length} giao dịch.`,
      ),
  );

  server.registerTool(
    'record_transfer',
    {
      title: 'Chuyển tiền giữa ví',
      description:
        'Chuyển tiền giữa hai ví cùng tiền tệ: rút ATM, nạp ví điện tử, trả nợ thẻ tín dụng. Không tính là thu/chi. Phí (nếu có) được ghi thành một khoản chi riêng.',
      inputSchema: {
        from_account: accountRef,
        to_account: accountRef,
        amount: amountInput,
        occurred_on: dateInput.optional(),
        note: z.string().optional(),
        fee: amountInput.optional().describe('Phí chuyển khoản, trừ vào ví nguồn'),
        fee_category: categoryRef.optional().describe('Danh mục chi cho phí'),
      },
      outputSchema: {
        transfer_group_id: z.string(),
        from: transactionView,
        to: transactionView,
        fee: transactionView.nullable(),
        balances: z.array(balanceView),
      },
      annotations: WRITE,
    },
    async (a) =>
      runTool(
        FINANCE_WRITE,
        () =>
          recordTransfer({
            fromAccount: a.from_account,
            toAccount: a.to_account,
            amount: a.amount,
            occurredOn: a.occurred_on,
            note: a.note,
            fee: a.fee,
            feeCategory: a.fee_category,
          }),
        (d) => `Đã chuyển ${d.from.amount} ${d.from.currency} từ ${d.from.account.name} sang ${d.to.account.name}.`,
      ),
  );

  server.registerTool(
    'update_transaction',
    {
      title: 'Sửa giao dịch',
      description:
        'Sửa một giao dịch theo id (lấy id từ search_transactions). Chỉ truyền trường cần đổi; null để xoá category/description/merchant/note. Chuyển khoản chỉ sửa được amount, occurred_on, note (áp cho cả hai phía).',
      inputSchema: {
        id: z.string(),
        amount: amountInput.optional(),
        type: entryType.optional(),
        account: accountRef.optional(),
        category: categoryRef.nullable().optional(),
        occurred_on: dateInput.optional(),
        description: z.string().nullable().optional(),
        merchant: z.string().nullable().optional(),
        note: z.string().nullable().optional(),
      },
      outputSchema: { transactions: z.array(transactionView) },
      annotations: WRITE,
    },
    async ({ id, occurred_on, ...rest }) =>
      runTool(
        FINANCE_WRITE,
        () => updateTransaction(id, { ...rest, occurredOn: occurred_on }),
        (d) => `Đã sửa ${d.transactions.length} dòng giao dịch.`,
      ),
  );

  server.registerTool(
    'delete_transaction',
    {
      title: 'Xoá giao dịch',
      description: 'Xoá mềm một giao dịch (chuyển khoản: xoá cả hai phía). restore=true để khôi phục.',
      inputSchema: { id: z.string(), restore: z.boolean().optional() },
      outputSchema: {
        deleted: z.boolean(),
        transactions: z.array(transactionView),
        balances: z.array(balanceView),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    async ({ id, restore }) =>
      runTool(
        FINANCE_WRITE,
        () => deleteTransaction(id, restore ?? false),
        (d) => (d.deleted ? `Đã xoá ${d.transactions.length} dòng giao dịch.` : 'Đã khôi phục giao dịch.'),
      ),
  );

  server.registerTool(
    'search_transactions',
    {
      title: 'Tìm giao dịch',
      description:
        'Tìm và liệt kê giao dịch theo khoảng ngày, ví, danh mục (gồm danh mục con), loại, khoảng số tiền, từ khoá (không dấu) trong mô tả/merchant/ghi chú. Dùng sort=amount_desc + limit cho "khoản chi lớn nhất". totals là tổng của toàn bộ kết quả, không chỉ trang hiện tại.',
      inputSchema: {
        from: dateInput.optional(),
        to: dateInput.optional(),
        account: accountRef.optional(),
        category: categoryRef.optional(),
        type: entryType.optional().describe('Chỉ khoản thu hoặc chi thường (bỏ qua chuyển khoản, điều chỉnh)'),
        kind: z.enum(TRANSACTION_KINDS).optional(),
        min_amount: z.string().optional(),
        max_amount: z.string().optional(),
        text: z.string().optional(),
        sort: z.enum(['date_desc', 'date_asc', 'amount_desc', 'amount_asc']).optional(),
        limit: z.number().int().min(1).max(200).optional().describe('Mặc định 50'),
        cursor: z.string().optional().describe('next_cursor của lần gọi trước'),
        include_deleted: z.boolean().optional(),
      },
      outputSchema: {
        items: z.array(transactionView),
        next_cursor: z.string().nullable(),
        total_count: z.number(),
        totals: z.array(z.object({ currency: z.string(), count: z.number(), inflow: z.string(), outflow: z.string() })),
      },
      annotations: READ_ONLY,
    },
    async (a) =>
      runTool(
        FINANCE_READ,
        () =>
          searchTransactions({
            from: a.from,
            to: a.to,
            account: a.account,
            category: a.category,
            type: a.type,
            kind: a.kind,
            minAmount: a.min_amount,
            maxAmount: a.max_amount,
            text: a.text,
            sort: a.sort,
            limit: a.limit,
            cursor: a.cursor,
            includeDeleted: a.include_deleted,
          }),
        (d) => `Tìm thấy ${d.total_count} giao dịch, hiển thị ${d.items.length}.`,
      ),
  );
}
