import { pool } from '../db/index.js';
import { asUser, createTestUser } from '../../test/fixtures.js';
import { createAccount } from './accounts.js';
import { reconcileAccount } from './transactions.js';

describe('reconcileAccount concurrency', () => {
  afterAll(async () => {
    await pool.end();
  });

  it('two concurrent reconciliations to the same balance create exactly one adjustment', async () => {
    const alice = await createTestUser();
    await asUser(alice, () => createAccount({ type: 'cash', name: 'Ví', openingBalance: '100000' }));

    const results = await Promise.all(
      [1, 2, 3].map(() => asUser(alice, () => reconcileAccount({ account: 'Ví', actualBalance: '150000' }))),
    );

    expect(results.filter((r) => r.adjustment !== null)).toHaveLength(1);
    const after = await asUser(alice, () => reconcileAccount({ account: 'Ví', actualBalance: '150000' }));
    expect(after.difference).toBe('0');
  });
});
