import { Decimal } from 'decimal.js';
import { eq } from 'drizzle-orm';
import { DomainError } from '../common/domain-error.js';
import { currentContext } from '../db/request-context.js';
import { ledgerTransaction } from '../db/schema/index.js';
import { resolveAccount } from '../ledger/accounts.js';
import { normalizeName } from '../ledger/normalize.js';
import { deleteTransaction } from '../ledger/transactions.js';
import { parseCurrency } from '../money/currency.js';
import { parseAmount } from '../money/money.js';
import { createLoan, loadLoans, resolveLoan } from './loans.js';
import { recordLoanPayment } from './payments.js';
import type { LoanDetail } from './views.js';
import type { LoanPaymentInput } from './payments.js';

export type LendMoneyInput = {
  /** Người mượn, ví dụ "Lan". */
  borrower: string;
  amount: string;
  /** Ví đưa tiền. */
  fromAccount: string;
  lentOn?: string;
  /** Hạn hẹn trả; mặc định 1 tháng sau ngày cho mượn. */
  dueOn?: string;
};

/** Cho mượn một lần, không lãi: một khoản lend một kỳ, tiền đi từ `fromAccount` sang ví nợ. */
export async function lendMoney(input: LendMoneyInput): Promise<LoanDetail> {
  const borrower = input.borrower.trim();
  if (!borrower)
    throw new DomainError('VALIDATION_ERROR', 'Cần tên người mượn.');
  const base = `Cho ${borrower} mượn`;
  const taken = new Set(
    (await loadLoans()).map((row) => normalizeName(row.name)),
  );
  // Cho cùng một người mượn nhiều lần: khoản sau thêm số thứ tự để tên không trùng.
  let name = base;
  for (let n = 2; taken.has(normalizeName(name)); n++) name = `${base} (${n})`;
  return createLoan({
    name,
    direction: 'lend',
    totalPayable: input.amount,
    termMonths: 1,
    startDate: input.lentOn,
    firstDueDate: input.dueOn,
    disbursement: 'cash',
    disbursementAccount: input.fromAccount,
  });
}

export type ReceiveRepaymentInput = {
  loan: string;
  amount: string;
  /** Ví nhận tiền trả, có thể khác ví đã đưa tiền. */
  toAccount: string;
  receivedOn?: string;
  /** Trả thiếu và chủ nợ bỏ phần còn lại: khoản cho mượn đóng lại. */
  forgiveRemainder?: boolean;
  /** Giao dịch thu nhập đã ghi nhầm cho đúng khoản tiền này: xoá cùng lúc, tránh cộng tiền hai lần. */
  replacesTransaction?: string;
};

/** Nhận lại tiền cho mượn (một phần hoặc đủ); khoản vay tự đóng khi dư nợ về 0. */
export async function receiveRepayment(input: ReceiveRepaymentInput) {
  const target = await resolveLoan(input.loan);
  if (target.direction !== 'lend') {
    throw new DomainError(
      'VALIDATION_ERROR',
      `"${target.name}" là khoản đi vay; dùng record_loan_payment để trả kỳ.`,
    );
  }
  const account = await resolveAccount(input.toAccount);

  if (input.replacesTransaction) {
    const { tx } = currentContext();
    const [row] = await tx
      .select()
      .from(ledgerTransaction)
      .where(eq(ledgerTransaction.id, input.replacesTransaction));
    if (!row || row.deletedAt) {
      throw new DomainError(
        'TRANSACTION_NOT_FOUND',
        `Không thấy giao dịch ${input.replacesTransaction}.`,
      );
    }
    const amount = parseAmount(input.amount, parseCurrency(target.currency));
    if (
      row.kind !== 'standard' ||
      new Decimal(row.amount).isNegative() ||
      row.accountId !== account.id ||
      !new Decimal(row.amount).equals(amount)
    ) {
      throw new DomainError(
        'VALIDATION_ERROR',
        'replaces_transaction phải là một khoản thu thường, cùng ví nhận và cùng số tiền với lần nhận này.',
      );
    }
    await deleteTransaction(row.id);
  }

  const payment: LoanPaymentInput = {
    loan: target.id,
    paidOn: input.receivedOn,
    account: account.id,
    amount: input.amount,
    payoff: input.forgiveRemainder,
  };
  return recordLoanPayment(payment);
}
