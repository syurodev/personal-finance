import { pool } from '../db/index.js';
import { asUser, createTestUser } from '../../test/fixtures.js';
import { createAccount } from './accounts.js';
import {
  deleteTransaction,
  reconcileAccount,
  recordTransactions,
  recordTransfer,
  searchTransactions,
  updateTransaction,
} from './transactions.js';

describe('transactions', () => {
  let alice: string;

  beforeAll(async () => {
    alice = await createTestUser();
    await asUser(alice, async () => {
      await createAccount({ type: 'bank', name: 'Vietcombank', openingBalance: '1000000' });
      await createAccount({ type: 'cash', name: 'Tiền mặt' });
      await createAccount({ type: 'ewallet', name: 'Momo' });
      await createAccount({ type: 'bank', name: 'Wise USD', currency: 'USD' });
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  const balanceOf = (balances: Array<{ name: string; balance: string }>, name: string) =>
    balances.find((b) => b.name === name)?.balance;

  it('records a batch of income and expenses and returns balances', async () => {
    const result = await asUser(alice, () =>
      recordTransactions([
        { amount: '25000000', type: 'income', account: 'vietcombank', category: 'luong', occurredOn: '2026-10-01' },
        { amount: '50000', type: 'expense', account: 'tien mat', category: 'an uong', occurredOn: '2026-10-02', description: 'Phở bò' },
        { amount: '85000', type: 'expense', account: 'momo', category: 'Ăn uống', occurredOn: '2026-10-02', merchant: 'Highlands' },
      ]),
    );
    expect(result.created).toHaveLength(3);
    expect(result.created[1]).toMatchObject({ type: 'expense', amount: '50000', signed_amount: '-50000', currency: 'VND' });
    expect(balanceOf(result.balances, 'Vietcombank')).toBe('26000000');
    expect(balanceOf(result.balances, 'Momo')).toBe('-85000');
  });

  it('writes nothing when one item in the batch is invalid', async () => {
    await expect(
      asUser(alice, () =>
        recordTransactions([
          { amount: '10000', type: 'expense', account: 'tien mat' },
          { amount: '1.5', type: 'expense', account: 'tien mat' },
        ]),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_AMOUNT_SCALE', details: expect.objectContaining({ index: 1 }) });
    const found = await asUser(alice, () => searchTransactions({ account: 'tien mat' }));
    expect(found.total_count).toBe(1);
  });

  it('rejects a category of the wrong kind', async () => {
    await expect(
      asUser(alice, () => recordTransactions([{ amount: '1000', type: 'expense', account: 'momo', category: 'Lương' }])),
    ).rejects.toMatchObject({ code: 'CATEGORY_KIND_MISMATCH' });
  });

  it('records a transfer as two linked rows', async () => {
    const result = await asUser(alice, () =>
      recordTransfer({ fromAccount: 'vietcombank', toAccount: 'tien mat', amount: '2000000', occurredOn: '2026-10-03' }),
    );
    expect(result.from).toMatchObject({ type: 'transfer_out', amount: '2000000' });
    expect(result.to).toMatchObject({ type: 'transfer_in', transfer_group_id: result.transfer_group_id });
    expect(balanceOf(result.balances, 'Vietcombank')).toBe('24000000');
    expect(balanceOf(result.balances, 'Tiền mặt')).toBe('1950000');
  });

  it('rejects transfers to the same account or across currencies', async () => {
    await expect(
      asUser(alice, () => recordTransfer({ fromAccount: 'momo', toAccount: 'momo', amount: '1000' })),
    ).rejects.toMatchObject({ code: 'SAME_ACCOUNT_TRANSFER' });
    await expect(
      asUser(alice, () => recordTransfer({ fromAccount: 'vietcombank', toAccount: 'wise usd', amount: '1000' })),
    ).rejects.toMatchObject({ code: 'CURRENCY_MISMATCH' });
  });

  it('records a transfer fee as a separate expense', async () => {
    const result = await asUser(alice, () =>
      recordTransfer({ fromAccount: 'vietcombank', toAccount: 'momo', amount: '500000', fee: '3300', occurredOn: '2026-10-04' }),
    );
    expect(result.fee).toMatchObject({ kind: 'standard', type: 'expense', amount: '3300' });
    expect(balanceOf(result.balances, 'Vietcombank')).toBe('23496700');
  });

  it('updates a standard transaction amount', async () => {
    const pho = (await asUser(alice, () => searchTransactions({ text: 'pho' }))).items[0]!;
    const result = await asUser(alice, () => updateTransaction(pho.id, { amount: '45000' }));
    expect(result.transactions[0]).toMatchObject({ amount: '45000', signed_amount: '-45000' });
  });

  it('requires a new category when switching type', async () => {
    const pho = (await asUser(alice, () => searchTransactions({ text: 'pho' }))).items[0]!;
    await expect(asUser(alice, () => updateTransaction(pho.id, { type: 'income' }))).rejects.toMatchObject({
      code: 'CATEGORY_KIND_MISMATCH',
    });
  });

  it('updates both rows of a transfer and blocks other fields', async () => {
    const transfer = (await asUser(alice, () => searchTransactions({ kind: 'transfer', account: 'tien mat' }))).items[0]!;
    const result = await asUser(alice, () => updateTransaction(transfer.id, { amount: '1500000' }));
    expect(result.transactions.map((t) => t.signed_amount).sort()).toEqual(['-1500000', '1500000']);
    await expect(asUser(alice, () => updateTransaction(transfer.id, { category: 'Khác' }))).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  it('soft deletes and restores', async () => {
    const coffee = (await asUser(alice, () => searchTransactions({ text: 'highlands' }))).items[0]!;
    const deleted = await asUser(alice, () => deleteTransaction(coffee.id));
    expect(deleted.deleted).toBe(true);
    expect((await asUser(alice, () => searchTransactions({ text: 'highlands' }))).total_count).toBe(0);
    const restored = await asUser(alice, () => deleteTransaction(coffee.id, true));
    expect(restored.transactions[0]!.deleted).toBe(false);
  });

  it('returns TRANSACTION_NOT_FOUND for unknown ids', async () => {
    await expect(asUser(alice, () => updateTransaction('not-an-id', { note: 'x' }))).rejects.toMatchObject({
      code: 'TRANSACTION_NOT_FOUND',
    });
  });

  it('searches with type, date range, totals and pagination', async () => {
    const page1 = await asUser(alice, () =>
      searchTransactions({ type: 'expense', from: '2026-10-01', to: '2026-10-31', sort: 'amount_desc', limit: 1 }),
    );
    expect(page1.total_count).toBe(3);
    expect(page1.items[0]!.amount).toBe('85000');
    expect(page1.totals).toEqual([{ currency: 'VND', count: 3, inflow: '0', outflow: '133300' }]);
    const page2 = await asUser(alice, () =>
      searchTransactions({ type: 'expense', from: '2026-10-01', to: '2026-10-31', sort: 'amount_desc', limit: 1, cursor: page1.next_cursor! }),
    );
    expect(page2.items[0]!.amount).toBe('45000');
  });

  it('searches by category including children and by amount range', async () => {
    const result = await asUser(alice, () => searchTransactions({ category: 'an uong', minAmount: '50000' }));
    expect(result.items.map((t) => t.amount)).toEqual(['85000']);
  });

  it('reconciles an account with an adjustment row', async () => {
    const result = await asUser(alice, () => reconcileAccount({ account: 'momo', actualBalance: '500000' }));
    expect(result.previous_balance).toBe('415000');
    expect(result.difference).toBe('85000');
    expect(result.adjustment).toMatchObject({ kind: 'adjustment', type: 'adjustment', signed_amount: '85000' });
    const again = await asUser(alice, () => reconcileAccount({ account: 'momo', actualBalance: '500000' }));
    expect(again.adjustment).toBeNull();
  });
});
