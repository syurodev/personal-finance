import { pool } from '../db/index.js';
import { asUser, createTestUser } from '../../test/fixtures.js';
import { createAccount } from './accounts.js';
import { createCategory } from './categories.js';
import { cashflowSummary } from './cashflow.js';
import { reconcileAccount, recordTransactions, recordTransfer } from './transactions.js';

describe('cashflowSummary', () => {
  let alice: string;

  beforeAll(async () => {
    alice = await createTestUser();
    await asUser(alice, async () => {
      await createAccount({ type: 'bank', name: 'VCB' });
      await createAccount({ type: 'cash', name: 'Tiền mặt' });
      await createAccount({ type: 'bank', name: 'Wise', currency: 'USD' });
      await createCategory({ name: 'Cà phê', kind: 'expense', parent: 'Ăn uống' });
      await recordTransactions([
        { amount: '20000000', type: 'income', account: 'VCB', category: 'Lương', occurredOn: '2026-09-01' },
        { amount: '3000000', type: 'expense', account: 'VCB', category: 'Ăn uống', occurredOn: '2026-09-10' },
        { amount: '500000', type: 'expense', account: 'VCB', category: 'Đi lại', occurredOn: '2026-09-12' },
        { amount: '25000000', type: 'income', account: 'VCB', category: 'Lương', occurredOn: '2026-10-01' },
        { amount: '1500000', type: 'expense', account: 'VCB', category: 'Ăn uống', occurredOn: '2026-10-05' },
        { amount: '500000', type: 'expense', account: 'Tiền mặt', category: 'Cà phê', occurredOn: '2026-10-06', merchant: 'Highlands' },
        { amount: '1000000', type: 'expense', account: 'VCB', occurredOn: '2026-10-07' },
        { amount: '12.5', type: 'expense', account: 'Wise', category: 'Mua sắm', occurredOn: '2026-10-08' },
      ]);
      // Không phải thu/chi: chuyển khoản và điều chỉnh đối soát.
      await recordTransfer({ fromAccount: 'VCB', toAccount: 'Tiền mặt', amount: '2000000', occurredOn: '2026-10-09' });
      await reconcileAccount({ account: 'Tiền mặt', actualBalance: '1000000', asOf: '2026-10-10' });
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  const october = { from: '2026-10-01', to: '2026-10-31' };

  it('totals per currency with net and savings rate, excluding transfers and adjustments', async () => {
    const result = await asUser(alice, () => cashflowSummary(october));
    expect(result).toMatchObject({ ...october, type: 'all', group_by: null, groups: [], previous: null, comparison: null });
    expect(result.totals).toEqual([
      { currency: 'USD', income: '0.00', expense: '12.50', net: '-12.50', savings_rate: null, count: 1 },
      { currency: 'VND', income: '25000000', expense: '3000000', net: '22000000', savings_rate: 0.88, count: 4 },
    ]);
  });

  it('groups by top-level category (children roll up), largest spending first', async () => {
    const result = await asUser(alice, () => cashflowSummary({ ...october, groupBy: 'category' }));
    expect(result.groups.map((g) => [g.currency, g.label, g.expense, g.income])).toEqual([
      ['VND', 'Ăn uống', '2000000', '0'],
      ['VND', '(chưa phân loại)', '1000000', '0'],
      ['USD', 'Mua sắm', '12.50', '0.00'],
      ['VND', 'Lương', '0', '25000000'],
    ]);
  });

  it('groups by merchant and by account', async () => {
    const merchants = await asUser(alice, () => cashflowSummary({ ...october, type: 'expense', groupBy: 'merchant' }));
    expect(merchants.groups.filter((g) => g.currency === 'VND').map((g) => [g.label, g.expense])).toEqual([
      ['(không rõ)', '2500000'],
      ['Highlands', '500000'],
    ]);
    const accounts = await asUser(alice, () => cashflowSummary({ ...october, type: 'expense', groupBy: 'account' }));
    expect(accounts.groups.map((g) => [g.label, g.expense])).toEqual([
      ['VCB', '2500000'],
      ['Tiền mặt', '500000'],
      ['Wise', '12.50'],
    ]);
  });

  it('groups by month in chronological order', async () => {
    const result = await asUser(alice, () =>
      cashflowSummary({ from: '2026-09-01', to: '2026-10-31', type: 'expense', groupBy: 'month' }),
    );
    expect(result.groups.filter((g) => g.currency === 'VND').map((g) => [g.key, g.expense])).toEqual([
      ['2026-09', '3500000'],
      ['2026-10', '3000000'],
    ]);
  });

  it('compares with the previous whole month', async () => {
    const result = await asUser(alice, () => cashflowSummary({ ...october, groupBy: 'category', comparePrevious: true }));
    expect(result.previous).toMatchObject({ from: '2026-09-01', to: '2026-09-30' });
    expect(result.previous!.totals).toEqual([
      { currency: 'VND', income: '20000000', expense: '3500000', net: '16500000', savings_rate: 0.825, count: 3 },
    ]);
    expect(result.comparison).toEqual([
      { currency: 'USD', income_change: '0.00', expense_change: '12.50', net_change: '-12.50' },
      { currency: 'VND', income_change: '5000000', expense_change: '-500000', net_change: '5500000' },
    ]);
  });

  it('validates the date range', async () => {
    await expect(asUser(alice, () => cashflowSummary({ from: '2026-10-31', to: '2026-10-01' }))).rejects.toMatchObject({
      code: 'INVALID_DATE_RANGE',
    });
  });
});
