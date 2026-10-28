import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { FINANCE_READ, FINANCE_WRITE } from '../../auth/constants.js';
import { LOAN_DIRECTIONS, LOAN_STATUSES } from '../../db/schema/index.js';
import { createLoan, getLoanStatus, listUpcomingPayments } from '../../loans/loans.js';
import { cancelLoan, recordLoanPayment, updateLoan } from '../../loans/payments.js';
import { runTool } from '../tool-kit.js';
import { accountRef, amountInput, balanceView, categoryRef, dateInput, READ_ONLY, WRITE } from './schemas.js';

const loanRef = z.string().describe('Id hoặc tên khoản vay; không cần dấu');

const installmentView = z.object({
  seq: z.number(),
  due_date: z.string(),
  amount: z.string(),
  status: z.enum(['due', 'paid', 'overdue']),
  paid_on: z.string().nullable(),
});

const ref = z.object({ id: z.string(), name: z.string() });

const loanSummary = z.object({
  id: z.string(),
  name: z.string(),
  direction: z.enum(LOAN_DIRECTIONS),
  status: z.enum(LOAN_STATUSES),
  currency: z.string(),
  total_payable: z.string(),
  term_months: z.number(),
  start_date: z.string(),
  first_due_date: z.string(),
  account: ref,
  payment_account: ref.nullable(),
  remaining_amount: z.string(),
  paid_amount: z.string(),
  paid_periods: z.number(),
  remaining_periods: z.number(),
  next_due: installmentView.nullable(),
});

const loanDetail = { ...loanSummary.shape, schedule: z.array(installmentView) };

const nextDueText = (d: { next_due: { due_date: string; amount: string } | null; currency: string }) =>
  d.next_due ? `kỳ tới ${d.next_due.due_date}: ${d.next_due.amount} ${d.currency}` : 'không còn kỳ nào';

export function registerLoanTools(server: McpServer): void {
  server.registerTool(
    'create_loan',
    {
      title: 'Tạo khoản vay / trả góp / cho vay',
      description:
        'Tạo khoản vay (borrow) hoặc cho vay (lend) theo số tiền phải trả mỗi kỳ (đã gồm lãi); tự tạo ví nợ cùng tên và lịch trả hằng tháng. Truyền installment_amount HOẶC total_payable. disbursement: cash (tiền vào/ra disbursement_account; cash_amount = tiền thực nhận nếu ít hơn tổng phải trả — phần chênh lệch ghi là "Lãi & phí vay"), purchase (mua hàng trả góp: ghi một khoản chi bằng tổng phải trả thuộc purchase_category), existing (khoản vay đang chạy: nhập paid_periods). Cho bạn bè mượn một lần: direction=lend, term_months=1, total_payable = số tiền cho mượn, disbursement=cash. Hỏi người dùng các thông số còn thiếu thay vì đoán.',
      inputSchema: {
        name: z.string().describe('Tên khoản vay, ví dụ "Vay mua xe", "Trả góp iPhone"'),
        direction: z.enum(LOAN_DIRECTIONS).describe('borrow = đi vay/trả góp, lend = cho người khác vay'),
        installment_amount: amountInput.optional().describe('Số tiền phải trả mỗi kỳ (đã gồm lãi)'),
        total_payable: amountInput.optional().describe('Tổng phải trả (đã gồm lãi), chia đều cho các kỳ'),
        term_months: z.number().int().min(1).max(600).describe('Số kỳ (tháng)'),
        start_date: dateInput.optional().describe('Ngày giải ngân / mua; mặc định hôm nay'),
        first_due_date: dateInput.optional().describe('Ngày trả kỳ đầu; mặc định 1 tháng sau start_date'),
        disbursement: z.enum(['cash', 'purchase', 'existing']),
        disbursement_account: accountRef.optional().describe('cash: ví nhận tiền vay hoặc ví chi tiền cho vay'),
        cash_amount: amountInput.optional().describe('cash: tiền thực nhận/thực đưa; mặc định = tổng phải trả'),
        purchase_category: categoryRef.optional().describe('purchase: danh mục chi của món hàng'),
        paid_periods: z.number().int().min(0).optional().describe('existing: số kỳ đã trả trước đây'),
        payment_account: accountRef.optional().describe('Ví trả nợ (hoặc nhận tiền trả) mặc định'),
        currency: z.string().optional(),
      },
      outputSchema: loanDetail,
      annotations: WRITE,
    },
    async (a) =>
      runTool(
        FINANCE_WRITE,
        () =>
          createLoan({
            name: a.name,
            direction: a.direction,
            installmentAmount: a.installment_amount,
            totalPayable: a.total_payable,
            termMonths: a.term_months,
            startDate: a.start_date,
            firstDueDate: a.first_due_date,
            disbursement: a.disbursement,
            disbursementAccount: a.disbursement_account,
            cashAmount: a.cash_amount,
            purchaseCategory: a.purchase_category,
            paidPeriods: a.paid_periods,
            paymentAccount: a.payment_account,
            currency: a.currency,
          }),
        (d) => `Đã tạo "${d.name}": còn ${d.remaining_amount} ${d.currency}, ${d.remaining_periods} kỳ; ${nextDueText(d)}.`,
      ),
  );

  server.registerTool(
    'record_loan_payment',
    {
      title: 'Ghi một kỳ trả nợ',
      description:
        'Ghi kỳ kế tiếp của khoản vay bằng một chuyển khoản giữa ví trả và ví nợ; mặc định đúng tiền kỳ. Trả dư: phần dư trừ vào các kỳ cuối. Trả thiếu: phần thiếu cộng vào kỳ sau. payoff=true để tất toán với số tiền thực trả (phần còn lại được miễn). Dùng tool này thay cho record_transfer khi trả nợ. Với khoản cho vay (lend) đây là thu hồi tiền: ví nhận tăng, khoản phải thu giảm cùng số tiền, không ghi thu nhập mới — đừng dùng record_transactions income cho việc này. Số tiền vượt phần còn phải thu bị từ chối (OVERPAYMENT).',
      inputSchema: {
        loan: loanRef,
        paid_on: dateInput.optional(),
        account: accountRef.optional().describe('Ví trả (vay) hoặc ví nhận (cho vay); mặc định ví đã đặt'),
        amount: amountInput.optional().describe('Số tiền thực trả; mặc định = tiền kỳ'),
        payoff: z.boolean().optional().describe('Tất toán khoản vay'),
      },
      outputSchema: { loan: loanSummary, paid: installmentView, balances: z.array(balanceView) },
      annotations: WRITE,
    },
    async (a) =>
      runTool(
        FINANCE_WRITE,
        () => recordLoanPayment({ loan: a.loan, paidOn: a.paid_on, account: a.account, amount: a.amount, payoff: a.payoff }),
        (d) =>
          d.loan.status === 'closed'
            ? `Đã ghi kỳ ${d.paid.seq} và tất toán "${d.loan.name}".`
            : `Đã ghi kỳ ${d.paid.seq} (${d.paid.amount} ${d.loan.currency}); còn ${d.loan.remaining_amount}, ${nextDueText(d.loan)}.`,
      ),
  );

  server.registerTool(
    'update_loan',
    {
      title: 'Sửa khoản vay',
      description:
        'Đổi tên, ví trả mặc định, hoặc số tiền mỗi kỳ mới cho mọi kỳ chưa trả (ví dụ ngân hàng đổi lãi suất). Phần tăng thêm được ghi là "Lãi & phí vay".',
      inputSchema: {
        loan: loanRef,
        name: z.string().optional(),
        installment_amount: amountInput.optional(),
        payment_account: accountRef.optional(),
      },
      outputSchema: loanDetail,
      annotations: WRITE,
    },
    async (a) =>
      runTool(
        FINANCE_WRITE,
        () => updateLoan({ loan: a.loan, name: a.name, installmentAmount: a.installment_amount, paymentAccount: a.payment_account }),
        (d) => `Đã cập nhật "${d.name}"; còn ${d.remaining_amount} ${d.currency}, ${nextDueText(d)}.`,
      ),
  );

  server.registerTool(
    'cancel_loan',
    {
      title: 'Huỷ khoản vay tạo nhầm',
      description: 'Huỷ khoản vay chưa có kỳ trả nào được ghi: xoá mềm giao dịch giải ngân và chi phí vay, lưu trữ ví nợ. Hỏi xác nhận trước khi gọi.',
      inputSchema: { loan: loanRef },
      outputSchema: { cancelled: z.boolean(), loan: loanSummary },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    async ({ loan }) => runTool(FINANCE_WRITE, () => cancelLoan(loan), (d) => `Đã huỷ khoản vay "${d.loan.name}".`),
  );

  server.registerTool(
    'get_loan_status',
    {
      title: 'Tình hình khoản vay',
      description:
        'Không truyền loan: tóm tắt mọi khoản vay đang chạy (còn phải trả, đã trả, số kỳ, kỳ tới). Truyền loan: chi tiết kèm toàn bộ lịch trả. include_inactive để xem cả khoản đã tất toán/huỷ.',
      inputSchema: { loan: loanRef.optional(), include_inactive: z.boolean().optional() },
      outputSchema: { loans: z.array(loanSummary), schedule: z.array(installmentView).nullable() },
      annotations: READ_ONLY,
    },
    async ({ loan, include_inactive }) =>
      runTool(FINANCE_READ, () => getLoanStatus({ loan, includeInactive: include_inactive }), (d) =>
        d.loans.length === 0
          ? 'Không có khoản vay nào.'
          : d.loans.map((l) => `${l.name}: còn ${l.remaining_amount} ${l.currency}, ${l.remaining_periods} kỳ`).join('; '),
      ),
  );

  server.registerTool(
    'list_upcoming_payments',
    {
      title: 'Kỳ trả sắp đến hạn',
      description:
        'Các kỳ quá hạn và đến hạn trong `days` ngày tới (mặc định 30) trên mọi khoản vay đang chạy, kèm tổng theo tiền tệ và chiều (borrow = phải trả, lend = sẽ được nhận). Dùng cho "tháng này phải trả những gì".',
      inputSchema: { as_of: dateInput.optional(), days: z.number().int().min(1).max(366).optional() },
      outputSchema: {
        as_of: z.string(),
        until: z.string(),
        items: z.array(installmentView.extend({ loan: ref, direction: z.enum(LOAN_DIRECTIONS), currency: z.string() })),
        totals: z.array(z.object({ currency: z.string(), direction: z.enum(LOAN_DIRECTIONS), amount: z.string() })),
        overdue_count: z.number(),
      },
      annotations: READ_ONLY,
    },
    async ({ as_of, days }) =>
      runTool(FINANCE_READ, () => listUpcomingPayments({ asOf: as_of, days }), (d) =>
        d.items.length === 0
          ? `Không có kỳ nào tới ${d.until}.`
          : `${d.items.length} kỳ tới ${d.until}${d.overdue_count ? `, ${d.overdue_count} kỳ quá hạn` : ''}.`,
      ),
  );
}
