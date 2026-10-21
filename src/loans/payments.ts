import { Decimal } from 'decimal.js';
import { eq, inArray, sql } from 'drizzle-orm';
import { recordAudit } from '../audit/audit.js';
import { parseIsoDate, todayIn } from '../common/dates.js';
import { DomainError } from '../common/domain-error.js';
import { requireName } from '../common/text.js';
import { currentContext } from '../db/request-context.js';
import { ledgerTransaction, loan, loanInstallment } from '../db/schema/index.js';
import { accountById, resolveAccount, updateAccount } from '../ledger/accounts.js';
import { normalizeName } from '../ledger/normalize.js';
import { balancesFor, deleteTransaction, recordTransfer } from '../ledger/transactions.js';
import { getUserSettings } from '../ledger/user-settings.js';
import type { AccountBalanceView } from '../ledger/views.js';
import { type Currency, parseCurrency } from '../money/currency.js';
import { formatAmount, parseAmount } from '../money/money.js';
import {
  type LoanRow,
  installmentsOf,
  loadLoans,
  loanDetail,
  recordLoanCost,
  remainingOf,
  resolveLoan,
  toInstallmentView,
} from './loans.js';
import { addOneMonth } from './schedule.js';
import type { InstallmentView, LoanDetail, LoanSummary } from './views.js';

/** Khoá dòng khoản vay tới hết transaction: thao tác song song phải chờ và đọc lịch đã cập nhật. */
async function lockLoan(id: string): Promise<void> {
  await currentContext().tx.execute(sql`select 1 from loan where id = ${id} for update`);
}

async function activeLoan(ref: string): Promise<LoanRow> {
  const target = await resolveLoan(ref, { includeInactive: true });
  if (target.status !== 'active') {
    throw new DomainError('LOAN_CLOSED', `Khoản vay "${target.name}" đã ${target.status === 'closed' ? 'tất toán' : 'bị huỷ'}.`);
  }
  await lockLoan(target.id);
  return target;
}

/** Dòng điều chỉnh trên ví nợ (không tính vào thu/chi), giữ bất biến số dư = các kỳ chưa trả. */
async function adjustDebt(target: LoanRow, signedAmount: Decimal, occurredOn: string, note: string): Promise<void> {
  const { tx, userId, clientId } = currentContext();
  const [row] = await tx
    .insert(ledgerTransaction)
    .values({
      userId,
      accountId: target.accountId,
      kind: 'adjustment',
      amount: signedAmount.toFixed(),
      currency: target.currency,
      occurredOn,
      note,
      sourceClientId: clientId,
    })
    .returning();
  await recordAudit('loan.adjustment', 'ledger_transaction', [row!.id]);
}

async function today(): Promise<string> {
  return todayIn((await getUserSettings()).timezone);
}

function withoutSchedule(detail: LoanDetail): LoanSummary {
  const summary: LoanSummary & { schedule?: InstallmentView[] } = { ...detail };
  delete summary.schedule;
  return summary;
}

export type LoanPaymentInput = {
  loan: string;
  paidOn?: string;
  /** Ví trả (vay) / ví nhận (cho vay); mặc định ví đã đặt cho khoản vay. */
  account?: string;
  /** Số tiền thực trả; mặc định = tiền kỳ (hoặc toàn bộ phần còn lại khi payoff). */
  amount?: string;
  /** Tất toán: trả `amount`, phần còn lại được miễn và khoản vay đóng lại. */
  payoff?: boolean;
};

export async function recordLoanPayment(input: LoanPaymentInput): Promise<{
  loan: LoanSummary;
  paid: InstallmentView;
  balances: AccountBalanceView[];
}> {
  const { tx } = currentContext();
  const target = await activeLoan(input.loan);
  const currency: Currency = parseCurrency(target.currency);
  const borrow = target.direction === 'borrow';
  const due = (await installmentsOf([target.id])).filter((row) => row.status === 'due');
  const next = due[0];
  if (!next) throw new DomainError('LOAN_CLOSED', `Khoản vay "${target.name}" không còn kỳ nào phải trả.`);

  const account = input.account ? await resolveAccount(input.account) : target.paymentAccountId ? await accountById(target.paymentAccountId) : null;
  if (!account) throw new DomainError('VALIDATION_ERROR', `Khoản vay "${target.name}" chưa có ví trả mặc định; truyền account.`);
  if (account.currency !== target.currency) {
    throw new DomainError('CURRENCY_MISMATCH', `Ví "${account.name}" dùng ${account.currency}, khoản vay dùng ${target.currency}.`);
  }

  const remaining = remainingOf(due);
  const amount =
    input.amount !== undefined ? parseAmount(input.amount, currency) : input.payoff ? remaining : new Decimal(next.amountDue);
  if (amount.greaterThan(remaining)) {
    throw new DomainError(
      'OVERPAYMENT',
      `Số tiền ${formatAmount(amount, currency)} vượt phần còn phải trả ${formatAmount(remaining, currency)}.`,
      { remaining_amount: formatAmount(remaining, currency) },
    );
  }
  const paidOn = input.paidOn ? parseIsoDate(input.paidOn, 'paid_on') : await today();
  const note = `${target.name} kỳ ${next.seq}`;

  const transfer = borrow
    ? await recordTransfer({ fromAccount: account.id, toAccount: target.accountId, amount: amount.toFixed(), occurredOn: paidOn, note: `Trả ${note}` })
    : await recordTransfer({ fromAccount: target.accountId, toAccount: account.id, amount: amount.toFixed(), occurredOn: paidOn, note: `Thu ${note}` });

  const [paidRow] = await tx
    .update(loanInstallment)
    .set({ status: 'paid', paidOn, amountPaid: amount.toFixed(), transferGroupId: transfer.transfer_group_id })
    .where(eq(loanInstallment.id, next.id))
    .returning();

  const rest = due.slice(1);
  const left = remaining.minus(amount);
  if (input.payoff || left.isZero()) {
    if (left.greaterThan(0)) {
      // Phần được miễn khi tất toán sớm.
      await adjustDebt(target, borrow ? left : left.negated(), paidOn, `Miễn giảm khi tất toán ${target.name}`);
    }
    if (rest.length > 0) await tx.delete(loanInstallment).where(inArray(loanInstallment.id, rest.map((r) => r.id)));
    await tx.update(loan).set({ status: 'closed', closedAt: new Date() }).where(eq(loan.id, target.id));
  } else {
    let diff = amount.minus(next.amountDue);
    if (diff.greaterThan(0)) {
      // Trả dư: trừ dần vào các kỳ cuối.
      for (const row of [...rest].reverse()) {
        if (diff.isZero()) break;
        const cut = Decimal.min(diff, row.amountDue);
        const reduced = new Decimal(row.amountDue).minus(cut);
        if (reduced.isZero()) await tx.delete(loanInstallment).where(eq(loanInstallment.id, row.id));
        else await tx.update(loanInstallment).set({ amountDue: reduced.toFixed() }).where(eq(loanInstallment.id, row.id));
        diff = diff.minus(cut);
      }
    } else if (diff.lessThan(0)) {
      // Trả thiếu: cộng vào kỳ kế tiếp, hoặc thêm một kỳ tháng sau.
      const shortfall = diff.negated();
      if (rest[0]) {
        await tx
          .update(loanInstallment)
          .set({ amountDue: new Decimal(rest[0].amountDue).plus(shortfall).toFixed() })
          .where(eq(loanInstallment.id, rest[0].id));
      } else {
        await tx.insert(loanInstallment).values({
          userId: target.userId,
          loanId: target.id,
          seq: next.seq + 1,
          dueDate: addOneMonth(next.dueDate),
          amountDue: shortfall.toFixed(),
        });
      }
    }
  }

  await recordAudit('loan.payment', 'loan_installment', [next.id]);
  return {
    loan: withoutSchedule(await loanDetail(target.id)),
    paid: toInstallmentView(paidRow!, currency, paidOn),
    balances: await balancesFor([account.id, target.accountId]),
  };
}

export async function updateLoan(input: {
  loan: string;
  name?: string;
  /** Số tiền mới cho mọi kỳ chưa trả (ví dụ ngân hàng đổi lãi suất). */
  installmentAmount?: string;
  paymentAccount?: string;
}): Promise<LoanDetail> {
  const { tx } = currentContext();
  if (input.name === undefined && input.installmentAmount === undefined && input.paymentAccount === undefined) {
    throw new DomainError('VALIDATION_ERROR', 'Không có trường nào để sửa.');
  }
  const target = await activeLoan(input.loan);
  const currency = parseCurrency(target.currency);
  const changes: Partial<typeof loan.$inferInsert> = {};

  if (input.name !== undefined) {
    const name = requireName(input.name);
    const clash = (await loadLoans()).find((row) => row.id !== target.id && normalizeName(row.name) === normalizeName(name));
    if (clash) throw new DomainError('DUPLICATE_NAME', `Đã có khoản vay "${clash.name}".`);
    await updateAccount(target.accountId, { name });
    changes.name = name;
  }
  if (input.paymentAccount !== undefined) {
    const account = await resolveAccount(input.paymentAccount);
    if (account.currency !== target.currency) {
      throw new DomainError('CURRENCY_MISMATCH', `Ví "${account.name}" dùng ${account.currency}, khoản vay dùng ${target.currency}.`);
    }
    changes.paymentAccountId = account.id;
  }
  if (input.installmentAmount !== undefined) {
    const amount = parseAmount(input.installmentAmount, currency);
    const due = (await installmentsOf([target.id])).filter((row) => row.status === 'due');
    const before = remainingOf(due);
    await tx.update(loanInstallment).set({ amountDue: amount.toFixed() }).where(inArray(loanInstallment.id, due.map((r) => r.id)));
    const delta = amount.times(due.length).minus(before);
    const date = await today();
    if (delta.greaterThan(0)) {
      await recordLoanCost(target, delta, date, `Tăng tiền kỳ ${target.name}`);
    } else if (delta.lessThan(0)) {
      const reduction = delta.negated();
      await adjustDebt(target, target.direction === 'borrow' ? reduction : reduction.negated(), date, `Giảm tiền kỳ ${target.name}`);
    }
  }

  if (Object.keys(changes).length > 0) await tx.update(loan).set(changes).where(eq(loan.id, target.id));
  await recordAudit('loan.update', 'loan', [target.id]);
  return loanDetail(target.id);
}

export async function cancelLoan(ref: string): Promise<{ cancelled: true; loan: LoanSummary }> {
  const { tx } = currentContext();
  const target = await activeLoan(ref);
  if ((await installmentsOf([target.id])).some((row) => row.transferGroupId)) {
    throw new DomainError(
      'LOAN_HAS_PAYMENTS',
      `Khoản vay "${target.name}" đã có kỳ trả được ghi nên không huỷ được. Nếu cần, xoá từng giao dịch bằng delete_transaction.`,
    );
  }
  for (const id of [target.disbursementTransactionId, target.costTransactionId]) {
    if (id) await deleteTransaction(id);
  }
  await updateAccount(target.accountId, { archived: true });
  await tx.update(loan).set({ status: 'cancelled', closedAt: new Date() }).where(eq(loan.id, target.id));
  await recordAudit('loan.cancel', 'loan', [target.id]);
  return { cancelled: true, loan: withoutSchedule(await loanDetail(target.id)) };
}
