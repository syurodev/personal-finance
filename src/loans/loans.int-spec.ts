import { pool } from '../db/index.js';
import { asUser, createTestUser } from '../../test/fixtures.js';
import { accountBalances, createAccount, loadAccounts } from '../ledger/accounts.js';
import { searchTransactions } from '../ledger/transactions.js';
import { createLoan, getLoanStatus, listUpcomingPayments } from './loans.js';

describe('loans: create, status, upcoming', () => {
  let alice: string;

  const balanceOf = async (name: string) =>
    asUser(alice, async () => {
      const account = (await loadAccounts({ includeArchived: true })).find((a) => a.name === name)!;
      return (await accountBalances()).get(account.id) ?? account.openingBalance;
    });

  beforeAll(async () => {
    alice = await createTestUser();
    await asUser(alice, async () => {
      await createAccount({ type: 'bank', name: 'VCB', openingBalance: '10000000' });
      await createAccount({ type: 'ewallet', name: 'Momo' });
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  it('installment purchase: the whole amount is spending in the item category', async () => {
    const loan = await asUser(alice, () =>
      createLoan({
        name: 'Trả góp iPhone',
        direction: 'borrow',
        installmentAmount: '2000000',
        termMonths: 12,
        startDate: '2026-10-01',
        disbursement: 'purchase',
        purchaseCategory: 'Mua sắm',
        paymentAccount: 'Momo',
      }),
    );
    expect(loan).toMatchObject({
      direction: 'borrow',
      total_payable: '24000000',
      remaining_amount: '24000000',
      paid_periods: 0,
      remaining_periods: 12,
      first_due_date: '2026-11-01',
      payment_account: expect.objectContaining({ name: 'Momo' }),
      next_due: { seq: 1, due_date: '2026-11-01', amount: '2000000', status: 'due', paid_on: null },
    });
    expect(loan.schedule).toHaveLength(12);
    expect(await balanceOf('Trả góp iPhone')).toBe('-24000000');
    const spending = await asUser(alice, () => searchTransactions({ category: 'Mua sắm' }));
    expect(spending.totals).toEqual([{ currency: 'VND', count: 1, inflow: '0', outflow: '24000000' }]);
  });

  it('cash loan: receives the cash and books the borrowing cost once', async () => {
    const loan = await asUser(alice, () =>
      createLoan({
        name: 'Vay tín chấp',
        direction: 'borrow',
        totalPayable: '11500000',
        termMonths: 10,
        startDate: '2026-10-10',
        disbursement: 'cash',
        disbursementAccount: 'VCB',
        cashAmount: '10000000',
      }),
    );
    expect(loan).toMatchObject({ total_payable: '11500000', remaining_amount: '11500000', next_due: expect.objectContaining({ amount: '1150000' }) });
    expect(await balanceOf('VCB')).toBe('20000000');
    expect(await balanceOf('Vay tín chấp')).toBe('-11500000');
    const cost = await asUser(alice, () => searchTransactions({ category: 'Lãi & phí vay' }));
    expect(cost.totals).toEqual([{ currency: 'VND', count: 1, inflow: '0', outflow: '1500000' }]);
  });

  it('existing loan: past periods are paid and the debt account opens at what is left', async () => {
    const loan = await asUser(alice, () =>
      createLoan({
        name: 'Vay tiêu dùng',
        direction: 'borrow',
        installmentAmount: '1066185',
        termMonths: 12,
        startDate: '2026-01-10',
        disbursement: 'existing',
        paidPeriods: 9,
        paymentAccount: 'VCB',
      }),
    );
    // Còn 3 kỳ × 1.066.185 = 3.198.555; đã trả 9 × 1.066.185 = 9.595.665.
    expect(loan).toMatchObject({
      remaining_amount: '3198555',
      paid_amount: '9595665',
      paid_periods: 9,
      remaining_periods: 3,
      next_due: expect.objectContaining({ seq: 10, due_date: '2026-11-10', amount: '1066185' }),
    });
    expect(await balanceOf('Vay tiêu dùng')).toBe('-3198555');
    expect(await balanceOf('VCB')).toBe('20000000');
  });

  it('cash lending moves money into a receivable account', async () => {
    const loan = await asUser(alice, () =>
      createLoan({
        name: 'Cho Nam vay',
        direction: 'lend',
        totalPayable: '5000000',
        termMonths: 1,
        startDate: '2026-10-05',
        disbursement: 'cash',
        disbursementAccount: 'VCB',
      }),
    );
    expect(loan).toMatchObject({ direction: 'lend', remaining_amount: '5000000', payment_account: expect.objectContaining({ name: 'VCB' }) });
    expect(await balanceOf('Cho Nam vay')).toBe('5000000');
    expect(await balanceOf('VCB')).toBe('15000000');
  });

  it('validates inputs', async () => {
    const base = { direction: 'borrow' as const, installmentAmount: '500000', termMonths: 2, disbursement: 'cash' as const, disbursementAccount: 'VCB' };
    const fails = (overrides: Record<string, unknown>, code: string) =>
      expect(asUser(alice, () => createLoan({ ...base, name: 'X', ...overrides } as never))).rejects.toMatchObject({ code });
    await fails({ name: 'Trả góp iPhone' }, 'DUPLICATE_NAME');
    await fails({ totalPayable: '1000000' }, 'VALIDATION_ERROR');
    await fails({ installmentAmount: undefined }, 'VALIDATION_ERROR');
    await fails({ termMonths: 0 }, 'VALIDATION_ERROR');
    await fails({ direction: 'lend', disbursement: 'purchase', purchaseCategory: 'Mua sắm' }, 'VALIDATION_ERROR');
    await fails({ disbursement: 'existing', paidPeriods: 2 }, 'VALIDATION_ERROR');
    await fails({ disbursementAccount: undefined }, 'VALIDATION_ERROR');
    await fails({ cashAmount: '2000000' }, 'VALIDATION_ERROR');
    await fails({ disbursement: 'purchase', purchaseCategory: 'Mua sắm', cashAmount: '100' }, 'VALIDATION_ERROR');
  });

  it('lists active loans and the schedule of one loan', async () => {
    const all = await asUser(alice, () => getLoanStatus({}));
    expect(all.loans.map((l) => l.name)).toEqual(['Trả góp iPhone', 'Vay tín chấp', 'Vay tiêu dùng', 'Cho Nam vay']);
    expect(all.schedule).toBeNull();
    const one = await asUser(alice, () => getLoanStatus({ loan: 'vay tieu dung' }));
    expect(one.loans).toHaveLength(1);
    expect(one.schedule!.filter((i) => i.status === 'paid')).toHaveLength(9);
  });

  it('lists overdue and upcoming installments with totals per currency and direction', async () => {
    const upcoming = await asUser(alice, () => listUpcomingPayments({ asOf: '2026-11-15', days: 20 }));
    expect(upcoming).toMatchObject({ as_of: '2026-11-15', until: '2026-12-05', overdue_count: 4 });
    expect(upcoming.items.map((i) => [i.loan.name, i.seq, i.due_date, i.status, i.amount])).toEqual([
      ['Trả góp iPhone', 1, '2026-11-01', 'overdue', '2000000'],
      ['Cho Nam vay', 1, '2026-11-05', 'overdue', '5000000'],
      ['Vay tín chấp', 1, '2026-11-10', 'overdue', '1150000'],
      ['Vay tiêu dùng', 10, '2026-11-10', 'overdue', '1066185'],
      ['Trả góp iPhone', 2, '2026-12-01', 'due', '2000000'],
    ]);
    // Vay: 2.000.000 + 1.150.000 + 1.066.185 + 2.000.000.
    expect(upcoming.totals).toEqual([
      { currency: 'VND', direction: 'borrow', amount: '6216185' },
      { currency: 'VND', direction: 'lend', amount: '5000000' },
    ]);
  });
});
