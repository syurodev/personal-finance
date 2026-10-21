import { pool } from '../db/index.js';
import { asUser, createTestUser } from '../../test/fixtures.js';
import { createAccount } from '../ledger/accounts.js';
import { createLoan, getLoanStatus } from './loans.js';
import { recordLoanPayment } from './payments.js';

describe('recordLoanPayment concurrency', () => {
  afterAll(async () => {
    await pool.end();
  });

  it('two concurrent payments settle two different installments', async () => {
    const alice = await createTestUser();
    await asUser(alice, async () => {
      await createAccount({ type: 'bank', name: 'VCB' });
      await createLoan({ name: 'Vay', direction: 'borrow', totalPayable: '3000000', termMonths: 3, disbursement: 'cash', disbursementAccount: 'VCB' });
    });

    const results = await Promise.all([1, 2].map(() => asUser(alice, () => recordLoanPayment({ loan: 'Vay' }))));

    expect(results.map((r) => r.paid.seq).sort((a, b) => a - b)).toEqual([1, 2]);
    const status = await asUser(alice, () => getLoanStatus({ loan: 'Vay' }));
    expect(status.loans[0]).toMatchObject({ remaining_amount: '1000000', paid_periods: 2 });
  });
});
