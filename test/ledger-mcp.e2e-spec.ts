import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { auth } from '../src/auth/auth.js';
import { startApp } from './app.js';
import { callError, callOk, connectMcp } from './mcp-client.js';
import { authorizeAndExchange, registerClient } from './oauth-flow.js';

const credentials = { email: 'ledger-e2e@example.com', password: 'password-123' };

const LEDGER_TOOLS = [
  'whoami',
  'get_overview',
  'create_account',
  'update_account',
  'create_category',
  'update_category',
  'record_transactions',
  'record_transfer',
  'update_transaction',
  'delete_transaction',
  'search_transactions',
  'reconcile_account',
];

describe('ledger over MCP: one month of usage', () => {
  let app: NestExpressApplication;
  let baseUrl: string;
  let client: Client;

  const balance = async (name: string): Promise<string> => {
    const overview = await callOk(client, 'get_overview');
    return overview.accounts.find((a: { name: string }) => a.name === name).balance;
  };

  beforeAll(async () => {
    ({ app, baseUrl } = await startApp());
    await auth.api.signUpEmail({ body: { name: 'Ledger E2E', ...credentials } });
    const clientId = await registerClient(baseUrl);
    const tokens = await authorizeAndExchange(baseUrl, clientId, credentials);
    client = await connectMcp(baseUrl, tokens.access_token);
    // listTools bật kiểm tra outputSchema phía client cho mọi lần gọi sau.
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...LEDGER_TOOLS].sort());
  });

  afterAll(async () => {
    await client?.close();
    await app.close();
  });

  it('starts with seeded categories and no accounts', async () => {
    const overview = await callOk(client, 'get_overview');
    expect(overview.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(overview.accounts).toEqual([]);
    expect(overview.categories.map((c: { name: string }) => c.name)).toContain('Ăn uống');
  });

  it('runs a month: salary, spending, ATM, edit, delete/restore, search, reconcile', async () => {
    await callOk(client, 'create_account', { type: 'bank', name: 'Vietcombank', opening_balance: '1000000' });
    await callOk(client, 'create_account', { type: 'ewallet', name: 'Momo' });
    await callOk(client, 'create_account', { type: 'cash', name: 'Tiền mặt' });

    const recorded = await callOk(client, 'record_transactions', {
      items: [
        { amount: '25000000', type: 'income', account: 'vietcombank', category: 'luong', occurred_on: '2026-10-01' },
        { amount: '50000', type: 'expense', account: 'tien mat', category: 'an uong', occurred_on: '2026-10-02', description: 'Phở' },
        { amount: '85000', type: 'expense', account: 'momo', category: 'Ăn uống', occurred_on: '2026-10-02', merchant: 'Highlands' },
      ],
    });
    expect(recorded.created).toHaveLength(3);

    await callOk(client, 'record_transfer', { from_account: 'vietcombank', to_account: 'tien mat', amount: '2000000' });
    expect(await balance('Vietcombank')).toBe('24000000');
    expect(await balance('Tiền mặt')).toBe('1950000');

    const pho = (await callOk(client, 'search_transactions', { text: 'pho' })).items[0];
    await callOk(client, 'update_transaction', { id: pho.id, amount: '45000' });
    expect(await balance('Tiền mặt')).toBe('1955000');

    const spending = await callOk(client, 'search_transactions', { type: 'expense', from: '2026-10-01' });
    expect(spending.total_count).toBe(2);
    expect(spending.totals).toEqual([{ currency: 'VND', count: 2, inflow: '0', outflow: '130000' }]);

    const coffee = (await callOk(client, 'search_transactions', { text: 'highlands' })).items[0];
    await callOk(client, 'delete_transaction', { id: coffee.id });
    expect(await balance('Momo')).toBe('0');
    await callOk(client, 'delete_transaction', { id: coffee.id, restore: true });
    expect(await balance('Momo')).toBe('-85000');

    const reconciled = await callOk(client, 'reconcile_account', { account: 'momo', actual_balance: '100000' });
    expect(reconciled.difference).toBe('185000');
    expect(reconciled.adjustment).not.toBeNull();

    const overview = await callOk(client, 'get_overview');
    expect(overview.net_worth).toEqual([{ currency: 'VND', total: '26055000' }]);
  });

  it('returns actionable errors', async () => {
    expect((await callError(client, 'record_transactions', {
      items: [{ amount: '1000', type: 'expense', account: 'momo', category: 'Lương' }],
    })).code).toBe('CATEGORY_KIND_MISMATCH');

    const notFound = await callError(client, 'record_transactions', {
      items: [{ amount: '1000', type: 'expense', account: 'Techcombank' }],
    });
    expect(notFound.code).toBe('ACCOUNT_NOT_FOUND');
    expect(notFound.details.suggestions.length).toBeGreaterThan(0);

    const before = await balance('Tiền mặt');
    const partial = await callError(client, 'record_transactions', {
      items: [
        { amount: '10000', type: 'expense', account: 'tien mat' },
        { amount: '1.5', type: 'expense', account: 'tien mat' },
      ],
    });
    expect(partial.code).toBe('INVALID_AMOUNT_SCALE');
    expect(partial.message).toContain('Dòng 2');
    expect(await balance('Tiền mặt')).toBe(before);
  });

  it('a read-only connection cannot write', async () => {
    const clientId = await registerClient(baseUrl);
    const tokens = await authorizeAndExchange(baseUrl, clientId, credentials, 'offline_access finance:read');
    const readOnly = await connectMcp(baseUrl, tokens.access_token);
    try {
      await readOnly.listTools();
      const error = await callError(readOnly, 'record_transactions', {
        items: [{ amount: '1000', type: 'expense', account: 'momo' }],
      });
      expect(error.code).toBe('INSUFFICIENT_SCOPE');
      expect((await callOk(readOnly, 'get_overview')).accounts.length).toBe(3);
    } finally {
      await readOnly.close();
    }
  });
});
