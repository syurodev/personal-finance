import { pool } from '../db/index.js';
import { asUser, createTestUser } from '../../test/fixtures.js';
import { accountBalances, createAccount, loadAccounts } from '../ledger/accounts.js';
import { searchTransactions } from '../ledger/transactions.js';
import { createLoan, getLoanStatus } from './loans.js';
import { cancelLoan, recordLoanPayment, updateLoan } from './payments.js';

describe('loan payments', () => {
  let alice: string;

  const balanceOf = async (name: string) =>
    asUser(alice, async () => {
      const account = (await loadAccounts({ includeArchived: true })).find((a) => a.name === name)!;
      return (await accountBalances()).get(account.id) ?? account.openingBalance;
    });
  const due = async (loan: string) =>
    (await asUser(alice, () => getLoanStatus({ loan }))).schedule!.filter((i) => i.status !== 'paid').map((i) => [i.seq, i.amount]);

  beforeAll(async () => {
    alice = await createTestUser();
    await asUser(alice, async () => {
      await createAccount({ type: 'bank', name: 'VCB', openingBalance: '10000000' });
      // Nhận 30.000.000, trả 6 kỳ × 5.500.000 = 33.000.000 → chi phí vay 3.000.000.
      await createLoan({
        name: 'Vay mua xe',
        direction: 'borrow',
        installmentAmount: '5500000',
        termMonths: 6,
        startDate: '2026-07-15',
        disbursement: 'cash',
        disbursementAccount: 'VCB',
        cashAmount: '30000000',
      });
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  it('disbursement credits the cash and the debt account holds the whole payable', async () => {
    expect(await balanceOf('VCB')).toBe('40000000');
    expect(await balanceOf('Vay mua xe')).toBe('-33000000');
  });

  it('pays the next installment', async () => {
    const result = await asUser(alice, () => recordLoanPayment({ loan: 'vay mua xe', paidOn: '2026-08-15' }));
    expect(result.paid).toEqual({ seq: 1, due_date: '2026-08-15', amount: '5500000', status: 'paid', paid_on: '2026-08-15' });
    expect(result.loan).toMatchObject({ remaining_amount: '27500000', paid_periods: 1, remaining_periods: 5 });
    expect(await balanceOf('VCB')).toBe('34500000');
    expect(await balanceOf('Vay mua xe')).toBe('-27500000');
  });

  it('paying more reduces the last installment', async () => {
    const result = await asUser(alice, () => recordLoanPayment({ loan: 'Vay mua xe', paidOn: '2026-09-15', amount: '6000000' }));
    expect(result.paid).toMatchObject({ seq: 2, amount: '6000000' });
    expect(result.loan.remaining_amount).toBe('21500000');
    expect(await due('Vay mua xe')).toEqual([
      [3, '5500000'],
      [4, '5500000'],
      [5, '5500000'],
      [6, '5000000'],
    ]);
    expect(await balanceOf('VCB')).toBe('28500000');
  });

  it('paying less carries the shortfall to the next installment', async () => {
    await asUser(alice, () => recordLoanPayment({ loan: 'Vay mua xe', paidOn: '2026-10-15', amount: '5000000' }));
    expect(await due('Vay mua xe')).toEqual([
      [4, '6000000'],
      [5, '5500000'],
      [6, '5000000'],
    ]);
    expect(await balanceOf('VCB')).toBe('23500000');
    expect(await balanceOf('Vay mua xe')).toBe('-16500000');
  });

  it('a new installment amount applies to every unpaid installment and books the extra cost', async () => {
    const detail = await asUser(alice, () => updateLoan({ loan: 'Vay mua xe', installmentAmount: '6000000' }));
    // 3 kỳ × 6.000.000 = 18.000.000; trước đó 16.500.000 → chi phí thêm 1.500.000.
    expect(detail.remaining_amount).toBe('18000000');
    expect(await due('Vay mua xe')).toEqual([
      [4, '6000000'],
      [5, '6000000'],
      [6, '6000000'],
    ]);
    expect(await balanceOf('Vay mua xe')).toBe('-18000000');
  });

  it('rejects paying more than what is left and writes nothing', async () => {
    await expect(asUser(alice, () => recordLoanPayment({ loan: 'Vay mua xe', amount: '20000000' }))).rejects.toMatchObject({
      code: 'OVERPAYMENT',
      details: { remaining_amount: '18000000' },
    });
    expect(await balanceOf('VCB')).toBe('23500000');
  });

  it('cannot cancel a loan with recorded payments', async () => {
    await expect(asUser(alice, () => cancelLoan('Vay mua xe'))).rejects.toMatchObject({ code: 'LOAN_HAS_PAYMENTS' });
  });

  it('early payoff with a discount closes the loan and writes off the rest', async () => {
    const result = await asUser(alice, () => recordLoanPayment({ loan: 'Vay mua xe', paidOn: '2026-11-15', amount: '17000000', payoff: true }));
    expect(result.loan).toMatchObject({ status: 'closed', remaining_amount: '0', paid_periods: 4, remaining_periods: 0, next_due: null });
    expect(result.paid).toMatchObject({ seq: 4, amount: '17000000' });
    expect(await balanceOf('Vay mua xe')).toBe('0');
    expect(await balanceOf('VCB')).toBe('6500000');
    await expect(asUser(alice, () => recordLoanPayment({ loan: 'Vay mua xe' }))).rejects.toMatchObject({ code: 'LOAN_CLOSED' });
    expect((await asUser(alice, () => getLoanStatus({}))).loans).toEqual([]);
  });

  it('a large payment can remove several last installments and closes when nothing is left', async () => {
    await asUser(alice, () =>
      createLoan({ name: 'Vay nhỏ', direction: 'borrow', totalPayable: '3000000', termMonths: 3, disbursement: 'cash', disbursementAccount: 'VCB' }),
    );
    await asUser(alice, () => recordLoanPayment({ loan: 'Vay nhỏ', amount: '2500000' }));
    expect(await due('Vay nhỏ')).toEqual([[2, '500000']]);
    const last = await asUser(alice, () => recordLoanPayment({ loan: 'Vay nhỏ' }));
    expect(last.loan.status).toBe('closed');
    expect(await balanceOf('VCB')).toBe('6500000');
  });

  it('cancels a loan created by mistake', async () => {
    await asUser(alice, () =>
      createLoan({ name: 'Vay nhầm', direction: 'borrow', totalPayable: '1200000', termMonths: 2, disbursement: 'cash', disbursementAccount: 'VCB', cashAmount: '1000000' }),
    );
    expect(await balanceOf('VCB')).toBe('7500000');
    const result = await asUser(alice, () => cancelLoan('Vay nhầm'));
    expect(result).toMatchObject({ cancelled: true, loan: { status: 'cancelled' } });
    expect(await balanceOf('VCB')).toBe('6500000');
    expect((await asUser(alice, () => loadAccounts())).map((a) => a.name)).not.toContain('Vay nhầm');
  });

  it('borrowing costs are spending in the system category', async () => {
    const cost = await asUser(alice, () => searchTransactions({ category: 'Lãi & phí vay' }));
    // 3.000.000 lúc tạo + 1.500.000 khi tăng tiền kỳ; chi phí của "Vay nhầm" đã bị xoá khi huỷ.
    expect(cost.totals).toEqual([{ currency: 'VND', count: 2, inflow: '0', outflow: '4500000' }]);
  });

  it('lending: interest is income at creation and payments come back as transfers', async () => {
    await asUser(alice, () =>
      createLoan({ name: 'Cho Lan vay', direction: 'lend', totalPayable: '2100000', termMonths: 2, startDate: '2026-10-01', disbursement: 'cash', disbursementAccount: 'VCB', cashAmount: '2000000' }),
    );
    expect(await balanceOf('VCB')).toBe('4500000');
    expect(await balanceOf('Cho Lan vay')).toBe('2100000');
    const result = await asUser(alice, () => recordLoanPayment({ loan: 'Cho Lan vay', paidOn: '2026-11-01' }));
    expect(result.paid).toMatchObject({ seq: 1, amount: '1050000' });
    expect(await balanceOf('Cho Lan vay')).toBe('1050000');
    expect(await balanceOf('VCB')).toBe('5550000');
    const income = await asUser(alice, () => searchTransactions({ category: 'Lãi cho vay' }));
    expect(income.totals).toEqual([{ currency: 'VND', count: 1, inflow: '100000', outflow: '0' }]);
  });
});
