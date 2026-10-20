import { pool } from '../db/index.js';
import { asUser, createTestUser } from '../../test/fixtures.js';
import { createAccount } from './accounts.js';
import { getBudgetStatus, setBudget } from './budgets.js';
import { createCategory } from './categories.js';
import { deleteTransaction, recordTransactions, recordTransfer, searchTransactions } from './transactions.js';

describe('budgets', () => {
  let alice: string;

  beforeAll(async () => {
    alice = await createTestUser();
    await asUser(alice, async () => {
      await createAccount({ type: 'bank', name: 'VCB', openingBalance: '50000000' });
      await createAccount({ type: 'cash', name: 'Tiền mặt' });
      await createCategory({ name: 'Cà phê', kind: 'expense', parent: 'Ăn uống' });
      await recordTransactions([
        { amount: '3000000', type: 'expense', account: 'VCB', category: 'Ăn uống', occurredOn: '2026-09-10' },
        { amount: '1500000', type: 'expense', account: 'VCB', category: 'Ăn uống', occurredOn: '2026-10-05' },
        { amount: '500000', type: 'expense', account: 'VCB', category: 'Cà phê', occurredOn: '2026-10-06' },
        { amount: '1000000', type: 'expense', account: 'VCB', category: 'Mua sắm', occurredOn: '2026-10-07' },
        { amount: '999000', type: 'expense', account: 'VCB', category: 'Mua sắm', occurredOn: '2026-10-08', note: 'sẽ xoá' },
      ]);
      // Chuyển khoản không tính vào ngân sách.
      await recordTransfer({ fromAccount: 'VCB', toAccount: 'Tiền mặt', amount: '700000', occurredOn: '2026-10-09' });
    });
    const deleted = await asUser(alice, async () => (await searchTransactions({ text: 'sẽ xoá' })).items[0]!);
    await asUser(alice, () => deleteTransaction(deleted.id));
  });

  afterAll(async () => {
    await pool.end();
  });

  it('sets a budget from a given month in the base currency', async () => {
    const result = await asUser(alice, () => setBudget({ category: 'an uong', amount: '2500000', fromMonth: '2026-09' }));
    expect(result).toMatchObject({ category: { name: 'Ăn uống' }, effective_from: '2026-09', limit: '2500000', currency: 'VND' });
    await asUser(alice, () => setBudget({ category: 'Mua sắm', amount: '800000', fromMonth: '2026-10' }));
  });

  it('rejects budgets on income categories and bad amounts', async () => {
    await expect(asUser(alice, () => setBudget({ category: 'Lương', amount: '1000' }))).rejects.toMatchObject({
      code: 'CATEGORY_KIND_MISMATCH',
    });
    await expect(asUser(alice, () => setBudget({ category: 'Mua sắm', amount: '0' }))).rejects.toMatchObject({
      code: 'INVALID_AMOUNT',
    });
  });

  it('computes October: children roll up, transfers and deleted rows are ignored', async () => {
    const status = await asUser(alice, () => getBudgetStatus('2026-10'));
    expect(status).toMatchObject({ month: '2026-10', currency: 'VND', days_in_month: 31 });
    expect(status.items).toEqual([
      {
        category: expect.objectContaining({ name: 'Mua sắm' }),
        effective_from: '2026-10',
        limit: '800000',
        spent: '1000000',
        remaining: '-200000',
        percent: 125,
        status: 'over',
      },
      {
        category: expect.objectContaining({ name: 'Ăn uống' }),
        effective_from: '2026-09',
        limit: '2500000',
        spent: '2000000',
        remaining: '500000',
        percent: 80,
        status: 'warning',
      },
    ]);
    expect(status.total).toEqual({ limit: '3300000', spent: '3000000', remaining: '300000', percent: 90.9, status: 'warning' });
  });

  it('a budget applies only from its month on', async () => {
    const status = await asUser(alice, () => getBudgetStatus('2026-09'));
    expect(status.items.map((i) => [i.category.name, i.spent, i.status])).toEqual([['Ăn uống', '3000000', 'over']]);
    expect(status.days_elapsed).toBe(30);
  });

  it('null removes a budget from a month on, earlier months keep it', async () => {
    await asUser(alice, () => setBudget({ category: 'Ăn uống', amount: null, fromMonth: '2026-11' }));
    const november = await asUser(alice, () => getBudgetStatus('2026-11'));
    expect(november.items.map((i) => i.category.name)).toEqual(['Mua sắm']);
    expect(november.items[0]).toMatchObject({ spent: '0', percent: 0, status: 'ok' });
    const october = await asUser(alice, () => getBudgetStatus('2026-10'));
    expect(october.items).toHaveLength(2);
  });

  it('setting the same month twice updates instead of duplicating', async () => {
    await asUser(alice, () => setBudget({ category: 'Mua sắm', amount: '900000', fromMonth: '2026-10' }));
    const status = await asUser(alice, () => getBudgetStatus('2026-10'));
    expect(status.items.find((i) => i.category.name === 'Mua sắm')?.limit).toBe('900000');
  });

  it('a child budget is shown but not double counted in the total when its parent has one', async () => {
    await asUser(alice, () => setBudget({ category: 'Cà phê', amount: '400000', fromMonth: '2026-10' }));
    const status = await asUser(alice, () => getBudgetStatus('2026-10'));
    expect(status.items.find((i) => i.category.name === 'Cà phê')).toMatchObject({ spent: '500000', status: 'over' });
    // Tổng = Ăn uống 2.500.000 + Mua sắm 900.000; Cà phê nằm trong Ăn uống nên không cộng thêm.
    expect(status.total).toMatchObject({ limit: '3400000', spent: '3000000' });
  });

  it('returns no total when there are no budgets', async () => {
    const bob = await createTestUser();
    const status = await asUser(bob, () => getBudgetStatus('2026-10'));
    expect(status.items).toEqual([]);
    expect(status.total).toBeNull();
  });
});
