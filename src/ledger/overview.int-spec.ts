import { pool } from '../db/index.js';
import { asUser, createTestUser } from '../../test/fixtures.js';
import { createAccount, updateAccount } from './accounts.js';
import { setBudget } from './budgets.js';
import { getOverview } from './overview.js';
import { recordTransactions } from './transactions.js';

describe('getOverview', () => {
  let alice: string;

  beforeAll(async () => {
    alice = await createTestUser();
    await asUser(alice, async () => {
      await createAccount({ type: 'bank', name: 'VCB', openingBalance: '1000000' });
      await createAccount({ type: 'cash', name: 'Tiền mặt', openingBalance: '200000' });
      await createAccount({ type: 'bank', name: 'Wise', currency: 'USD', openingBalance: '10.5' });
      await createAccount({ type: 'cash', name: 'Ví cũ', openingBalance: '999' });
      await updateAccount('Ví cũ', { archived: true });
      await recordTransactions([
        { amount: '300000', type: 'expense', account: 'VCB', category: 'Khác', occurredOn: '2026-10-05' },
        { amount: '100000', type: 'expense', account: 'VCB', category: 'Khác', occurredOn: '2026-10-20' },
      ]);
      await setBudget({ category: 'Khác', amount: '350000', fromMonth: '2026-10' });
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  it('returns balances as of a date, net worth per currency and the category tree', async () => {
    const overview = await asUser(alice, () => getOverview('2026-10-10'));
    expect(overview.as_of).toBe('2026-10-10');
    expect(overview.timezone).toBe('Asia/Ho_Chi_Minh');
    expect(overview.base_currency).toBe('VND');
    expect(overview.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(overview.accounts.map((a) => [a.name, a.balance])).toEqual([
      ['VCB', '700000'],
      ['Tiền mặt', '200000'],
      ['Wise', '10.50'],
    ]);
    expect(overview.net_worth).toEqual([
      { currency: 'USD', total: '10.50' },
      { currency: 'VND', total: '900000' },
    ]);
    expect(overview.categories).toHaveLength(15);
    expect(overview.debts).toBeNull();
  });

  it('summarises the budget of the as_of month', async () => {
    const overview = await asUser(alice, () => getOverview('2026-10-10'));
    // Tháng 10: 300.000 + 100.000 = 400.000 / 350.000 → vượt.
    expect(overview.budget).toEqual({
      month: '2026-10',
      currency: 'VND',
      limit: '350000',
      spent: '400000',
      remaining: '-50000',
      percent: 114.3,
      over_count: 1,
      warning_count: 0,
    });
    expect((await asUser(alice, () => getOverview('2026-09-10'))).budget).toBeNull();
  });
});
