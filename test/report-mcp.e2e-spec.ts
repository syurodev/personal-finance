import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { auth } from '../src/auth/auth.js';
import { startApp } from './app.js';
import { ALL_TOOLS, callError, callOk, connectMcp } from './mcp-client.js';
import { authorizeAndExchange, registerClient } from './oauth-flow.js';

const credentials = { email: 'report-e2e@example.com', password: 'password-123' };

describe('budgets and reports over MCP', () => {
  let app: NestExpressApplication;
  let baseUrl: string;
  let client: Client;

  beforeAll(async () => {
    ({ app, baseUrl } = await startApp());
    await auth.api.signUpEmail({ body: { name: 'Report E2E', ...credentials } });
    const clientId = await registerClient(baseUrl);
    const tokens = await authorizeAndExchange(baseUrl, clientId, credentials);
    client = await connectMcp(baseUrl, tokens.access_token);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...ALL_TOOLS].sort());

    await callOk(client, 'create_account', { type: 'bank', name: 'VCB' });
    await callOk(client, 'create_account', { type: 'cash', name: 'Tiền mặt' });
    await callOk(client, 'create_category', { name: 'Cà phê', kind: 'expense', parent: 'Ăn uống' });
    await callOk(client, 'record_transactions', {
      items: [
        { amount: '20000000', type: 'income', account: 'VCB', category: 'Lương', occurred_on: '2026-09-01' },
        { amount: '3000000', type: 'expense', account: 'VCB', category: 'Ăn uống', occurred_on: '2026-09-10' },
        { amount: '500000', type: 'expense', account: 'VCB', category: 'Đi lại', occurred_on: '2026-09-12' },
        { amount: '25000000', type: 'income', account: 'VCB', category: 'Lương', occurred_on: '2026-10-01' },
        { amount: '1500000', type: 'expense', account: 'VCB', category: 'Ăn uống', occurred_on: '2026-10-05' },
        { amount: '500000', type: 'expense', account: 'VCB', category: 'Cà phê', occurred_on: '2026-10-06', merchant: 'Highlands' },
        { amount: '1000000', type: 'expense', account: 'VCB', category: 'Mua sắm', occurred_on: '2026-10-07' },
      ],
    });
    await callOk(client, 'record_transfer', {
      from_account: 'VCB',
      to_account: 'Tiền mặt',
      amount: '1000000',
      occurred_on: '2026-10-08',
    });
  });

  afterAll(async () => {
    await client?.close();
    await app.close();
  });

  it('sets budgets and reports their status', async () => {
    await callOk(client, 'set_budget', { category: 'an uong', amount: '2500000', from_month: '2026-09' });
    await callOk(client, 'set_budget', { category: 'Mua sắm', amount: '800000', from_month: '2026-10' });
    expect((await callError(client, 'set_budget', { category: 'Lương', amount: '1000' })).code).toBe(
      'CATEGORY_KIND_MISMATCH',
    );

    const october = await callOk(client, 'get_budget_status', { month: '2026-10' });
    expect(october.items.map((i: any) => [i.category.name, i.spent, i.remaining, i.status])).toEqual([
      ['Mua sắm', '1000000', '-200000', 'over'],
      ['Ăn uống', '2000000', '500000', 'warning'],
    ]);
    expect(october.total).toMatchObject({ limit: '3300000', spent: '3000000', percent: 90.9 });

    const september = await callOk(client, 'get_budget_status', { month: '2026-09' });
    expect(september.items.map((i: any) => i.category.name)).toEqual(['Ăn uống']);

    await callOk(client, 'set_budget', { category: 'Ăn uống', amount: null, from_month: '2026-11' });
    const november = await callOk(client, 'get_budget_status', { month: '2026-11' });
    expect(november.items.map((i: any) => [i.category.name, i.status])).toEqual([['Mua sắm', 'ok']]);

    const overview = await callOk(client, 'get_overview', { as_of: '2026-10-15' });
    expect(overview.budget).toMatchObject({ month: '2026-10', over_count: 1, warning_count: 1 });
  });

  it('summarises cashflow by category and compares with the previous month', async () => {
    const result = await callOk(client, 'cashflow_summary', {
      from: '2026-10-01',
      to: '2026-10-31',
      group_by: 'category',
      compare_previous: true,
    });
    expect(result.totals).toEqual([
      { currency: 'VND', income: '25000000', expense: '3000000', net: '22000000', savings_rate: 0.88, count: 4 },
    ]);
    expect(result.groups.map((g: any) => [g.label, g.expense, g.income])).toEqual([
      ['Ăn uống', '2000000', '0'],
      ['Mua sắm', '1000000', '0'],
      ['Lương', '0', '25000000'],
    ]);
    expect(result.previous.totals[0]).toMatchObject({ expense: '3500000', net: '16500000' });
    expect(result.comparison).toEqual([
      { currency: 'VND', income_change: '5000000', expense_change: '-500000', net_change: '5500000' },
    ]);

    const byMonth = await callOk(client, 'cashflow_summary', {
      from: '2026-09-01',
      to: '2026-10-31',
      type: 'expense',
      group_by: 'month',
    });
    expect(byMonth.groups.map((g: any) => [g.key, g.expense])).toEqual([
      ['2026-09', '3500000'],
      ['2026-10', '3000000'],
    ]);
  });

  it('offers the month-end review prompt', async () => {
    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name)).toContain('month_end_review');
    const prompt = await client.getPrompt({ name: 'month_end_review', arguments: { month: '2026-10' } });
    const text = (prompt.messages[0]!.content as { text: string }).text;
    expect(text).toContain('from=2026-10-01, to=2026-10-31');
    expect(text).toContain('cashflow_summary');
  });
});
