import { pool } from '../db/index.js';
import { asUser, createTestUser } from '../../test/fixtures.js';
import {
  accountBalances,
  createAccount,
  loadAccounts,
} from '../ledger/accounts.js';
import { recordTransactions } from '../ledger/transactions.js';
import { lendMoney, receiveRepayment } from './lending.js';
import { createLoan, getLoanStatus } from './loans.js';

describe('lending shortcuts', () => {
  let alice: string;

  const balanceOf = async (name: string) =>
    asUser(alice, async () => {
      const account = (await loadAccounts({ includeArchived: true })).find(
        (a) => a.name === name,
      )!;
      return (
        (await accountBalances()).get(account.id) ?? account.openingBalance
      );
    });
  const status = async (loan: string) =>
    (await asUser(alice, () => getLoanStatus({ loan, includeInactive: true })))
      .loans[0]!;

  beforeAll(async () => {
    alice = await createTestUser();
    await asUser(alice, async () => {
      await createAccount({
        type: 'bank',
        name: 'A',
        openingBalance: '10000000',
      });
      await createAccount({ type: 'ewallet', name: 'B', openingBalance: '0' });
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  it('lends from wallet A and takes repayments into wallet B', async () => {
    const lent = await asUser(alice, () =>
      lendMoney({
        borrower: 'Lan',
        amount: '2000000',
        fromAccount: 'A',
        lentOn: '2026-10-01',
      }),
    );
    expect(lent).toMatchObject({
      name: 'Cho Lan mượn',
      direction: 'lend',
      remaining_amount: '2000000',
    });
    expect(await balanceOf('A')).toBe('8000000');

    const half = await asUser(alice, () =>
      receiveRepayment({
        loan: 'Lan',
        amount: '500000',
        toAccount: 'B',
        receivedOn: '2026-10-10',
      }),
    );
    expect(half.loan).toMatchObject({
      status: 'active',
      remaining_amount: '1500000',
    });
    expect(await balanceOf('B')).toBe('500000');
    expect(await balanceOf('A')).toBe('8000000');

    const rest = await asUser(alice, () =>
      receiveRepayment({
        loan: 'Cho Lan mượn',
        amount: '1500000',
        toAccount: 'B',
      }),
    );
    expect(rest.loan).toMatchObject({
      status: 'closed',
      remaining_amount: '0',
    });
    expect(await balanceOf('B')).toBe('2000000');
    expect(await balanceOf('Cho Lan mượn')).toBe('0');
  });

  it('numbers the name when the same person borrows again', async () => {
    const first = await asUser(alice, () =>
      lendMoney({ borrower: 'Minh', amount: '100000', fromAccount: 'A' }),
    );
    const second = await asUser(alice, () =>
      lendMoney({ borrower: 'Minh', amount: '200000', fromAccount: 'A' }),
    );
    expect([first.name, second.name]).toEqual([
      'Cho Minh mượn',
      'Cho Minh mượn (2)',
    ]);
  });

  it('forgives the rest when the borrower pays less', async () => {
    await asUser(alice, () =>
      lendMoney({ borrower: 'Hoa', amount: '1000000', fromAccount: 'A' }),
    );
    const result = await asUser(alice, () =>
      receiveRepayment({
        loan: 'Hoa',
        amount: '600000',
        toAccount: 'B',
        forgiveRemainder: true,
      }),
    );
    expect(result.loan).toMatchObject({
      status: 'closed',
      remaining_amount: '0',
    });
    expect(await balanceOf('Cho Hoa mượn')).toBe('0');
  });

  it('replaces an income recorded by mistake instead of adding the money twice', async () => {
    await asUser(alice, () =>
      lendMoney({ borrower: 'Tuấn', amount: '2000000', fromAccount: 'A' }),
    );
    const before = Number(await balanceOf('B'));
    const { created } = await asUser(alice, () =>
      recordTransactions([
        {
          amount: '2000000',
          type: 'income',
          account: 'B',
          description: 'Tuấn trả',
        },
      ]),
    );
    expect(Number(await balanceOf('B'))).toBe(before + 2000000);

    await asUser(alice, () =>
      receiveRepayment({
        loan: 'Tuấn',
        amount: '2000000',
        toAccount: 'B',
        replacesTransaction: created[0]!.id,
      }),
    );
    expect(Number(await balanceOf('B'))).toBe(before + 2000000);
    expect((await status('Tuấn')).status).toBe('closed');
  });

  it('refuses a mismatching replaced transaction without changing anything', async () => {
    await asUser(alice, () =>
      lendMoney({ borrower: 'Vy', amount: '300000', fromAccount: 'A' }),
    );
    const { created } = await asUser(alice, () =>
      recordTransactions([{ amount: '999', type: 'income', account: 'B' }]),
    );
    const before = await balanceOf('B');
    await expect(
      asUser(alice, () =>
        receiveRepayment({
          loan: 'Vy',
          amount: '300000',
          toAccount: 'B',
          replacesTransaction: created[0]!.id,
        }),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(await balanceOf('B')).toBe(before);
    expect((await status('Vy')).remaining_amount).toBe('300000');
  });

  it('rejects borrowed loans and amounts above what is owed', async () => {
    await asUser(alice, () =>
      createLoan({
        name: 'Vay xe',
        direction: 'borrow',
        installmentAmount: '1000000',
        termMonths: 2,
        disbursement: 'existing',
      }),
    );
    await expect(
      asUser(alice, () =>
        receiveRepayment({ loan: 'Vay xe', amount: '1000000', toAccount: 'B' }),
      ),
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    await asUser(alice, () =>
      lendMoney({ borrower: 'Nam', amount: '100000', fromAccount: 'A' }),
    );
    await expect(
      asUser(alice, () =>
        receiveRepayment({ loan: 'Nam', amount: '200000', toAccount: 'B' }),
      ),
    ).rejects.toMatchObject({
      code: 'OVERPAYMENT',
    });
  });
});
