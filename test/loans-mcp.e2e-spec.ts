import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { auth } from '../src/auth/auth.js';
import { startApp } from './app.js';
import { ALL_TOOLS, callError, callOk, connectMcp } from './mcp-client.js';
import { authorizeAndExchange, registerClient } from './oauth-flow.js';

const credentials = { email: 'loans-e2e@example.com', password: 'password-123' };

describe('loans over MCP', () => {
  let app: NestExpressApplication;
  let baseUrl: string;
  let client: Client;

  const balance = async (name: string): Promise<string> =>
    (await callOk(client, 'get_overview')).accounts.find((a: { name: string }) => a.name === name).balance;

  beforeAll(async () => {
    ({ app, baseUrl } = await startApp());
    await auth.api.signUpEmail({ body: { name: 'Loans E2E', ...credentials } });
    const clientId = await registerClient(baseUrl);
    const tokens = await authorizeAndExchange(baseUrl, clientId, credentials);
    client = await connectMcp(baseUrl, tokens.access_token);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...ALL_TOOLS].sort());
    await callOk(client, 'create_account', { type: 'bank', name: 'VCB', opening_balance: '10000000' });
  });

  afterAll(async () => {
    await client?.close();
    await app.close();
  });

  it('creates a car loan, pays an installment, changes the amount and lists what is due', async () => {
    const created = await callOk(client, 'create_loan', {
      name: 'Vay mua xe',
      direction: 'borrow',
      installment_amount: '5500000',
      term_months: 6,
      start_date: '2026-07-15',
      disbursement: 'cash',
      disbursement_account: 'VCB',
      cash_amount: '30000000',
    });
    expect(created).toMatchObject({
      total_payable: '33000000',
      remaining_amount: '33000000',
      account: expect.objectContaining({ name: 'Vay mua xe' }),
      next_due: expect.objectContaining({ seq: 1, due_date: '2026-08-15', amount: '5500000' }),
    });
    expect(created.schedule).toHaveLength(6);

    const overview = await callOk(client, 'get_overview');
    expect(overview.accounts.find((a: { name: string }) => a.name === 'VCB').balance).toBe('40000000');
    expect(overview.debts.items).toEqual([{ currency: 'VND', borrowed: '33000000', lent: '0' }]);

    const paid = await callOk(client, 'record_loan_payment', { loan: 'vay mua xe', paid_on: '2026-08-15' });
    expect(paid.paid).toMatchObject({ seq: 1, status: 'paid', amount: '5500000' });
    expect(paid.loan.remaining_amount).toBe('27500000');
    expect(await balance('VCB')).toBe('34500000');

    // 5 kỳ còn lại × 6.000.000.
    const updated = await callOk(client, 'update_loan', { loan: 'Vay mua xe', installment_amount: '6000000' });
    expect(updated).toMatchObject({ remaining_amount: '30000000', next_due: expect.objectContaining({ seq: 2, amount: '6000000' }) });

    const upcoming = await callOk(client, 'list_upcoming_payments', { as_of: '2026-09-20', days: 30 });
    expect(upcoming.items.map((i: any) => [i.seq, i.due_date, i.status, i.amount])).toEqual([
      [2, '2026-09-15', 'overdue', '6000000'],
      [3, '2026-10-15', 'due', '6000000'],
    ]);
    expect(upcoming.totals).toEqual([{ currency: 'VND', direction: 'borrow', amount: '12000000' }]);

    const status = await callOk(client, 'get_loan_status', { loan: 'Vay mua xe' });
    expect(status.loans[0]).toMatchObject({ paid_periods: 1, remaining_periods: 5 });
    expect(status.schedule[0].status).toBe('paid');
  });

  it('cancels a mistaken loan and protects loans with payments', async () => {
    await callOk(client, 'create_loan', {
      name: 'Vay nhầm',
      direction: 'borrow',
      total_payable: '1000000',
      term_months: 2,
      disbursement: 'cash',
      disbursement_account: 'VCB',
    });
    expect(await balance('VCB')).toBe('35500000');
    await callOk(client, 'cancel_loan', { loan: 'Vay nhầm' });
    expect(await balance('VCB')).toBe('34500000');
    expect((await callOk(client, 'get_loan_status')).loans.map((l: any) => l.name)).toEqual(['Vay mua xe']);

    expect((await callError(client, 'cancel_loan', { loan: 'Vay mua xe' })).code).toBe('LOAN_HAS_PAYMENTS');
    const overpay = await callError(client, 'record_loan_payment', { loan: 'Vay mua xe', amount: '999999999' });
    expect(overpay.code).toBe('OVERPAYMENT');
    expect(overpay.details.remaining_amount).toBe('30000000');
  });

  it('a read-only connection cannot record payments', async () => {
    const clientId = await registerClient(baseUrl);
    const tokens = await authorizeAndExchange(baseUrl, clientId, credentials, 'offline_access finance:read');
    const readOnly = await connectMcp(baseUrl, tokens.access_token);
    try {
      await readOnly.listTools();
      expect((await callError(readOnly, 'record_loan_payment', { loan: 'Vay mua xe' })).code).toBe('INSUFFICIENT_SCOPE');
      expect((await callOk(readOnly, 'get_loan_status')).loans[0].paid_periods).toBe(1);
    } finally {
      await readOnly.close();
    }
  });
});
