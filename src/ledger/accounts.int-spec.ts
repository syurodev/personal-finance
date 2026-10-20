import { pool } from '../db/index.js';
import { asUser, createTestUser } from '../../test/fixtures.js';
import { createAccount, resolveAccount, updateAccount } from './accounts.js';

describe('accounts', () => {
  let alice: string;
  let bob: string;

  beforeAll(async () => {
    alice = await createTestUser();
    bob = await createTestUser();
  });

  afterAll(async () => {
    await pool.end();
  });

  it('creates an account in the base currency with its opening balance', async () => {
    const view = await asUser(alice, () => createAccount({ type: 'bank', name: 'Vietcombank', openingBalance: '1000000' }));
    expect(view).toMatchObject({ name: 'Vietcombank', type: 'bank', currency: 'VND', balance: '1000000', archived: false });
  });

  it('allows a negative opening balance for a credit card', async () => {
    const view = await asUser(alice, () =>
      createAccount({ type: 'credit_card', name: 'Thẻ TPBank', openingBalance: '-2000000' }),
    );
    expect(view.balance).toBe('-2000000');
  });

  it('rejects a duplicate name ignoring accents and case', async () => {
    await expect(asUser(alice, () => createAccount({ type: 'bank', name: 'vietcombank' }))).rejects.toMatchObject({
      code: 'DUPLICATE_NAME',
    });
  });

  it('reports archived accounts and can unarchive them', async () => {
    await asUser(alice, () => createAccount({ type: 'cash', name: 'Tiền mặt cũ' }));
    await asUser(alice, () => updateAccount('tien mat cu', { archived: true }));
    await expect(asUser(alice, () => resolveAccount('tien mat cu'))).rejects.toMatchObject({ code: 'ACCOUNT_ARCHIVED' });
    const view = await asUser(alice, () => updateAccount('tien mat cu', { archived: false }));
    expect(view.archived).toBe(false);
  });

  it('renames an account', async () => {
    const view = await asUser(alice, () => updateAccount('thẻ tpbank', { name: 'Thẻ TPB' }));
    expect(view.name).toBe('Thẻ TPB');
  });

  it("cannot see another user's accounts", async () => {
    await expect(asUser(bob, () => resolveAccount('Vietcombank'))).rejects.toMatchObject({ code: 'ACCOUNT_NOT_FOUND' });
  });

  it('rejects an unsupported currency', async () => {
    await expect(
      asUser(alice, () => createAccount({ type: 'bank', name: 'Lạ', currency: 'XYZ' })),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_CURRENCY' });
  });
});
