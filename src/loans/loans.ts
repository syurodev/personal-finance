import { Decimal } from 'decimal.js';
import { and, asc, eq, inArray, lte } from 'drizzle-orm';
import { recordAudit } from '../audit/audit.js';
import { parseIsoDate, todayIn } from '../common/dates.js';
import { DomainError } from '../common/domain-error.js';
import { addDays } from '../common/periods.js';
import { requireName } from '../common/text.js';
import { currentContext } from '../db/request-context.js';
import { type LoanDirection, loan, loanInstallment } from '../db/schema/index.js';
import { type AccountRow, createAccount, loadAccounts, resolveAccount } from '../ledger/accounts.js';
import { ensureCategory, resolveCategory } from '../ledger/categories.js';
import { normalizeName } from '../ledger/normalize.js';
import { resolveByName } from '../ledger/resolver.js';
import { recordTransactions, recordTransfer } from '../ledger/transactions.js';
import { getUserSettings } from '../ledger/user-settings.js';
import { type Currency, parseCurrency } from '../money/currency.js';
import { formatAmount, parseAmount } from '../money/money.js';
import { addOneMonth, dueDates, splitEvenly } from './schedule.js';
import type { DebtSummary, InstallmentView, LoanDetail, LoanSummary, UpcomingPayments } from './views.js';

export type LoanRow = typeof loan.$inferSelect;
export type InstallmentRow = typeof loanInstallment.$inferSelect;

/** Danh mục hệ thống cho chi phí vay, tự tạo khi cần. */
export const LOAN_COST_EXPENSE = 'Lãi & phí vay';
export const LOAN_COST_INCOME = 'Lãi cho vay';

function invalid(message: string): DomainError {
  return new DomainError('VALIDATION_ERROR', message);
}

/** Ghi chi phí vay (vay) hoặc tiền lãi được nhận (cho vay) trên ví nợ; trả về id giao dịch. */
export async function recordLoanCost(
  target: { direction: LoanDirection; accountId: string },
  amount: Decimal,
  occurredOn: string,
  description: string,
): Promise<string> {
  const borrow = target.direction === 'borrow';
  const category = borrow ? await ensureCategory(LOAN_COST_EXPENSE, 'expense') : await ensureCategory(LOAN_COST_INCOME, 'income');
  const { created } = await recordTransactions([
    {
      amount: amount.toFixed(),
      type: borrow ? 'expense' : 'income',
      account: target.accountId,
      category: category.id,
      occurredOn,
      description,
    },
  ]);
  return created[0]!.id;
}

// ---------- loading ----------

export async function loadLoans(options: { includeInactive?: boolean } = {}): Promise<LoanRow[]> {
  const { tx } = currentContext();
  const rows = await tx.select().from(loan).orderBy(asc(loan.createdAt), asc(loan.id));
  return options.includeInactive ? rows : rows.filter((row) => row.status === 'active');
}

/** Tìm khoản vay đang chạy theo id/tên; includeInactive để tìm cả khoản đã tất toán/huỷ. */
export async function resolveLoan(ref: string, options: { includeInactive?: boolean } = {}): Promise<LoanRow> {
  try {
    return resolveByName(await loadLoans(), ref, 'LOAN');
  } catch (error) {
    if (!options.includeInactive || !(error instanceof DomainError) || error.code !== 'LOAN_NOT_FOUND') throw error;
    return resolveByName(
      (await loadLoans({ includeInactive: true })).filter((row) => row.status !== 'active'),
      ref,
      'LOAN',
    );
  }
}

export async function installmentsOf(loanIds: readonly string[]): Promise<InstallmentRow[]> {
  if (loanIds.length === 0) return [];
  const { tx } = currentContext();
  return tx
    .select()
    .from(loanInstallment)
    .where(inArray(loanInstallment.loanId, [...loanIds]))
    .orderBy(asc(loanInstallment.seq));
}

// ---------- views ----------

export function toInstallmentView(row: InstallmentRow, currency: Currency, today: string): InstallmentView {
  const paid = row.status === 'paid';
  return {
    seq: row.seq,
    due_date: row.dueDate,
    amount: formatAmount(paid ? (row.amountPaid ?? row.amountDue) : row.amountDue, currency),
    status: paid ? 'paid' : row.dueDate < today ? 'overdue' : 'due',
    paid_on: row.paidOn,
  };
}

export function remainingOf(rows: readonly InstallmentRow[]): Decimal {
  return rows.filter((row) => row.status === 'due').reduce((sum, row) => sum.plus(row.amountDue), new Decimal(0));
}

function summarize(row: LoanRow, rows: InstallmentRow[], accounts: Map<string, AccountRow>, today: string): LoanSummary {
  const currency = parseCurrency(row.currency);
  const due = rows.filter((r) => r.status === 'due');
  const paid = rows.filter((r) => r.status === 'paid');
  const ref = (id: string) => ({ id, name: accounts.get(id)?.name ?? '' });
  return {
    id: row.id,
    name: row.name,
    direction: row.direction,
    status: row.status,
    currency,
    total_payable: formatAmount(row.totalPayable, currency),
    term_months: row.termMonths,
    start_date: row.startDate,
    first_due_date: row.firstDueDate,
    account: ref(row.accountId),
    payment_account: row.paymentAccountId ? ref(row.paymentAccountId) : null,
    remaining_amount: formatAmount(remainingOf(rows), currency),
    paid_amount: formatAmount(
      paid.reduce((sum, r) => sum.plus(r.amountPaid ?? r.amountDue), new Decimal(0)),
      currency,
    ),
    paid_periods: paid.length,
    remaining_periods: due.length,
    next_due: due[0] ? toInstallmentView(due[0], currency, today) : null,
  };
}

async function today(): Promise<string> {
  return todayIn((await getUserSettings()).timezone);
}

export async function loanDetail(loanId: string): Promise<LoanDetail> {
  const row = (await loadLoans({ includeInactive: true })).find((l) => l.id === loanId)!;
  const rows = await installmentsOf([row.id]);
  const accounts = new Map((await loadAccounts({ includeArchived: true })).map((a) => [a.id, a]));
  const date = await today();
  const currency = parseCurrency(row.currency);
  return { ...summarize(row, rows, accounts, date), schedule: rows.map((r) => toInstallmentView(r, currency, date)) };
}

// ---------- create ----------

export type CreateLoanInput = {
  name: string;
  direction: LoanDirection;
  /** Một trong hai: tiền mỗi kỳ, hoặc tổng phải trả (chia đều). */
  installmentAmount?: string;
  totalPayable?: string;
  termMonths: number;
  startDate?: string;
  firstDueDate?: string;
  /** cash: tiền chuyển qua ví; purchase: mua hàng trả góp; existing: khoản vay đã chạy từ trước. */
  disbursement: 'cash' | 'purchase' | 'existing';
  /** cash: ví nhận tiền vay (vay) hoặc ví chi tiền (cho vay). */
  disbursementAccount?: string;
  /** cash: tiền thực nhận/thực đưa; mặc định = tổng phải trả. Phần chênh lệch là chi phí vay. */
  cashAmount?: string;
  /** purchase: danh mục chi của món hàng. */
  purchaseCategory?: string;
  /** existing: số kỳ đã trả trước khi theo dõi. */
  paidPeriods?: number;
  /** Ví trả nợ (vay) / ví nhận tiền trả (cho vay) mặc định; cash mặc định là disbursementAccount. */
  paymentAccount?: string;
  currency?: string;
};

export async function createLoan(input: CreateLoanInput): Promise<LoanDetail> {
  const { tx, userId } = currentContext();
  const settings = await getUserSettings();
  const name = requireName(input.name);
  if ((await loadLoans()).some((row) => normalizeName(row.name) === normalizeName(name))) {
    throw new DomainError('DUPLICATE_NAME', `Đã có khoản vay "${name}".`);
  }
  const termMonths = input.termMonths;
  if (!Number.isInteger(termMonths) || termMonths < 1 || termMonths > 600) throw invalid('term_months phải là số nguyên từ 1 đến 600.');
  if ((input.installmentAmount === undefined) === (input.totalPayable === undefined)) {
    throw invalid('Truyền đúng một trong hai: installment_amount (tiền mỗi kỳ) hoặc total_payable (tổng phải trả).');
  }
  if (input.disbursement === 'purchase' && input.direction === 'lend') throw invalid('Cho vay không dùng disbursement=purchase.');
  if (input.disbursement !== 'existing' && input.paidPeriods) throw invalid('paid_periods chỉ dùng với disbursement=existing.');
  if (input.disbursement !== 'cash' && input.cashAmount !== undefined) throw invalid('cash_amount chỉ dùng với disbursement=cash.');
  if (input.disbursement === 'cash' && !input.disbursementAccount) throw invalid('Cần disbursement_account khi disbursement=cash.');
  if (input.disbursement === 'purchase' && !input.purchaseCategory) throw invalid('Cần purchase_category khi disbursement=purchase.');

  const startDate = input.startDate ? parseIsoDate(input.startDate, 'start_date') : todayIn(settings.timezone);
  const firstDueDate = input.firstDueDate ? parseIsoDate(input.firstDueDate, 'first_due_date') : addOneMonth(startDate);
  if (firstDueDate <= startDate) throw invalid('first_due_date phải sau start_date.');

  const disbursementAccount = input.disbursement === 'cash' ? await resolveAccount(input.disbursementAccount!) : null;
  const purchaseCategory = input.disbursement === 'purchase' ? await resolveCategory(input.purchaseCategory!, 'expense') : null;
  const paymentAccount = input.paymentAccount ? await resolveAccount(input.paymentAccount) : disbursementAccount;

  const currency = parseCurrency(input.currency ?? disbursementAccount?.currency ?? paymentAccount?.currency ?? settings.baseCurrency);
  for (const account of [disbursementAccount, paymentAccount]) {
    if (account && account.currency !== currency) {
      throw new DomainError('CURRENCY_MISMATCH', `Ví "${account.name}" dùng ${account.currency}, khoản vay dùng ${currency}.`);
    }
  }

  const amounts =
    input.installmentAmount !== undefined
      ? Array.from({ length: termMonths }, () => parseAmount(input.installmentAmount!, currency))
      : splitEvenly(parseAmount(input.totalPayable!, currency), termMonths, currency);
  const total = amounts.reduce((sum, a) => sum.plus(a), new Decimal(0));
  const paidPeriods = input.paidPeriods ?? 0;
  if (!Number.isInteger(paidPeriods) || paidPeriods < 0 || paidPeriods >= termMonths) {
    throw invalid('paid_periods phải từ 0 đến term_months − 1.');
  }
  const cash = disbursementAccount ? (input.cashAmount !== undefined ? parseAmount(input.cashAmount, currency) : total) : null;
  if (cash && cash.greaterThan(total)) throw invalid('cash_amount không được lớn hơn tổng phải trả.');

  const remaining = amounts.slice(paidPeriods).reduce((sum, a) => sum.plus(a), new Decimal(0));
  const sign = input.direction === 'borrow' ? -1 : 1;
  const account = await createAccount({
    type: 'loan',
    name,
    currency,
    openingBalance: input.disbursement === 'existing' ? remaining.times(sign).toFixed() : '0',
  });

  let disbursementTransactionId: string | null = null;
  let costTransactionId: string | null = null;
  if (disbursementAccount && cash) {
    const transfer =
      input.direction === 'borrow'
        ? await recordTransfer({ fromAccount: account.id, toAccount: disbursementAccount.id, amount: cash.toFixed(), occurredOn: startDate, note: `Giải ngân ${name}` })
        : await recordTransfer({ fromAccount: disbursementAccount.id, toAccount: account.id, amount: cash.toFixed(), occurredOn: startDate, note: `Cho vay ${name}` });
    disbursementTransactionId = transfer.from.id;
    const cost = total.minus(cash);
    if (cost.greaterThan(0)) {
      costTransactionId = await recordLoanCost({ direction: input.direction, accountId: account.id }, cost, startDate, `Lãi & phí ${name}`);
    }
  } else if (purchaseCategory) {
    const { created } = await recordTransactions([
      { amount: total.toFixed(), type: 'expense', account: account.id, category: purchaseCategory.id, occurredOn: startDate, description: name },
    ]);
    disbursementTransactionId = created[0]!.id;
  }

  const dates = dueDates(firstDueDate, termMonths);
  const [row] = await tx
    .insert(loan)
    .values({
      userId,
      name,
      direction: input.direction,
      totalPayable: total.toFixed(),
      currency,
      termMonths,
      startDate,
      firstDueDate,
      accountId: account.id,
      paymentAccountId: paymentAccount?.id ?? null,
      disbursementTransactionId,
      costTransactionId,
    })
    .returning();
  await tx.insert(loanInstallment).values(
    amounts.map((amount, index) => ({
      userId,
      loanId: row!.id,
      seq: index + 1,
      dueDate: dates[index]!,
      amountDue: amount.toFixed(),
      status: index < paidPeriods ? ('paid' as const) : ('due' as const),
    })),
  );
  await recordAudit('loan.create', 'loan', [row!.id]);
  return loanDetail(row!.id);
}

// ---------- read ----------

export async function getLoanStatus(input: { loan?: string; includeInactive?: boolean }): Promise<{
  loans: LoanSummary[];
  schedule: InstallmentView[] | null;
}> {
  if (input.loan) {
    const { schedule, ...summary } = await loanDetail((await resolveLoan(input.loan, { includeInactive: true })).id);
    return { loans: [summary], schedule };
  }
  const rows = await loadLoans({ includeInactive: input.includeInactive });
  const installments = await installmentsOf(rows.map((r) => r.id));
  const accounts = new Map((await loadAccounts({ includeArchived: true })).map((a) => [a.id, a]));
  const date = await today();
  return {
    loans: rows.map((row) => summarize(row, installments.filter((i) => i.loanId === row.id), accounts, date)),
    schedule: null,
  };
}

export async function listUpcomingPayments(input: { asOf?: string; days?: number } = {}): Promise<UpcomingPayments> {
  const { tx } = currentContext();
  const asOf = input.asOf ? parseIsoDate(input.asOf, 'as_of') : await today();
  const days = input.days ?? 30;
  if (!Number.isInteger(days) || days < 1 || days > 366) throw invalid('days phải từ 1 đến 366.');
  const until = addDays(asOf, days);
  const loans = await loadLoans();
  if (loans.length === 0) return { as_of: asOf, until, items: [], totals: [], overdue_count: 0 };
  const order = new Map(loans.map((row, index) => [row.id, index]));
  const byId = new Map(loans.map((row) => [row.id, row]));

  const rows = await tx
    .select()
    .from(loanInstallment)
    .where(and(eq(loanInstallment.status, 'due'), lte(loanInstallment.dueDate, until), inArray(loanInstallment.loanId, [...byId.keys()])));
  rows.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || order.get(a.loanId)! - order.get(b.loanId)! || a.seq - b.seq);

  const items = rows.map((row) => {
    const owner = byId.get(row.loanId)!;
    const currency = parseCurrency(owner.currency);
    return { loan: { id: owner.id, name: owner.name }, direction: owner.direction, currency, ...toInstallmentView(row, currency, asOf) };
  });

  const totals = new Map<string, { currency: Currency; direction: LoanDirection; amount: Decimal }>();
  for (const item of items) {
    const key = `${item.currency}|${item.direction}`;
    const entry = totals.get(key) ?? { currency: parseCurrency(item.currency), direction: item.direction, amount: new Decimal(0) };
    entry.amount = entry.amount.plus(item.amount);
    totals.set(key, entry);
  }

  return {
    as_of: asOf,
    until,
    items,
    totals: [...totals.values()]
      .sort((a, b) => a.currency.localeCompare(b.currency) || a.direction.localeCompare(b.direction))
      .map((t) => ({ currency: t.currency, direction: t.direction, amount: formatAmount(t.amount, t.currency) })),
    overdue_count: items.filter((item) => item.status === 'overdue').length,
  };
}

/** Tóm tắt nợ cho get_overview; null khi không có khoản vay đang chạy. */
export async function debtSummary(asOf: string): Promise<DebtSummary | null> {
  const loans = await loadLoans();
  if (loans.length === 0) return null;
  const order = new Map(loans.map((row, index) => [row.id, index]));
  const byId = new Map(loans.map((row) => [row.id, row]));
  const rows = (await installmentsOf(loans.map((l) => l.id))).filter((r) => r.status === 'due');

  const perCurrency = new Map<Currency, { borrowed: Decimal; lent: Decimal }>();
  for (const row of rows) {
    const owner = byId.get(row.loanId)!;
    const currency = parseCurrency(owner.currency);
    const entry = perCurrency.get(currency) ?? { borrowed: new Decimal(0), lent: new Decimal(0) };
    if (owner.direction === 'borrow') entry.borrowed = entry.borrowed.plus(row.amountDue);
    else entry.lent = entry.lent.plus(row.amountDue);
    perCurrency.set(currency, entry);
  }

  const next = [...rows].sort(
    (a, b) => a.dueDate.localeCompare(b.dueDate) || order.get(a.loanId)! - order.get(b.loanId)! || a.seq - b.seq,
  )[0];
  const nextOwner = next ? byId.get(next.loanId)! : null;
  return {
    items: [...perCurrency.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([currency, entry]) => ({ currency, borrowed: formatAmount(entry.borrowed, currency), lent: formatAmount(entry.lent, currency) })),
    next_due:
      next && nextOwner
        ? {
            loan: nextOwner.name,
            direction: nextOwner.direction,
            due_date: next.dueDate,
            amount: formatAmount(next.amountDue, parseCurrency(nextOwner.currency)),
            currency: nextOwner.currency,
          }
        : null,
    overdue_count: rows.filter((row) => row.dueDate < asOf).length,
  };
}
