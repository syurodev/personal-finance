import { Decimal } from 'decimal.js';
import { and, eq, gte, isNull, lte, type SQL, sql } from 'drizzle-orm';
import { assertDateRange, parseIsoDate } from '../common/dates.js';
import { previousPeriod } from '../common/periods.js';
import { currentContext } from '../db/request-context.js';
import { category, ledgerTransaction } from '../db/schema/index.js';
import { parseCurrency } from '../money/currency.js';
import { formatAmount } from '../money/money.js';
import { loadAccounts } from './accounts.js';
import { loadCategories } from './categories.js';
import type { EntryType } from './views.js';

export const CASHFLOW_GROUPS = ['category', 'account', 'merchant', 'month', 'week', 'day'] as const;
export type CashflowGroupBy = (typeof CASHFLOW_GROUPS)[number];
export type CashflowType = EntryType | 'all';

export type CashflowTotals = {
  currency: string;
  income: string;
  expense: string;
  net: string;
  savings_rate: number | null;
  count: number;
};

export type CashflowGroup = {
  currency: string;
  key: string | null;
  label: string;
  income: string;
  expense: string;
  net: string;
  count: number;
};

export type CashflowPeriod = { from: string; to: string; totals: CashflowTotals[]; groups: CashflowGroup[] };

export type CashflowComparison = { currency: string; income_change: string; expense_change: string; net_change: string };

export type CashflowSummary = CashflowPeriod & {
  type: CashflowType;
  group_by: CashflowGroupBy | null;
  previous: CashflowPeriod | null;
  comparison: CashflowComparison[] | null;
};

const t = ledgerTransaction;
const INCOME = sql<string>`coalesce(sum(${t.amount}) filter (where ${t.amount} > 0), 0)::text`;
const EXPENSE = sql<string>`coalesce(sum(-${t.amount}) filter (where ${t.amount} < 0), 0)::text`;
const COUNT = sql<number>`count(*)::int`;
const TIME_GROUPS: ReadonlySet<CashflowGroupBy> = new Set(['month', 'week', 'day']);

/** Chỉ thu/chi thật: bỏ chuyển khoản, điều chỉnh và dòng đã xoá. */
function baseWhere(from: string, to: string, type: CashflowType): SQL {
  const conditions: SQL[] = [eq(t.kind, 'standard'), isNull(t.deletedAt), gte(t.occurredOn, from), lte(t.occurredOn, to)];
  if (type === 'expense') conditions.push(sql`${t.amount} < 0`);
  if (type === 'income') conditions.push(sql`${t.amount} > 0`);
  return and(...conditions)!;
}

/** Khoá nhóm. Không có tham số `${giá trị}` để select và group by khớp nhau theo văn bản. */
function groupKey(groupBy: CashflowGroupBy): SQL<string | null> {
  switch (groupBy) {
    case 'category':
      return sql<string | null>`coalesce(${category.parentId}, ${category.id})::text`;
    case 'account':
      return sql<string | null>`${t.accountId}::text`;
    case 'merchant':
      return sql<string | null>`nullif(unaccent(lower(trim(${t.merchant}))), '')`;
    case 'month':
      return sql<string | null>`to_char(${t.occurredOn}, 'YYYY-MM')`;
    case 'week':
      return sql<string | null>`to_char(date_trunc('week', ${t.occurredOn}::timestamp), 'YYYY-MM-DD')`;
    case 'day':
      return sql<string | null>`${t.occurredOn}::text`;
  }
}

async function totalsFor(from: string, to: string, type: CashflowType): Promise<CashflowTotals[]> {
  const { tx } = currentContext();
  const rows = await tx
    .select({ currency: t.currency, income: INCOME, expense: EXPENSE, count: COUNT })
    .from(t)
    .where(baseWhere(from, to, type))
    .groupBy(t.currency)
    .orderBy(t.currency);
  return rows.map((row) => {
    const currency = parseCurrency(row.currency);
    const income = new Decimal(row.income);
    const net = income.minus(row.expense);
    return {
      currency,
      income: formatAmount(income, currency),
      expense: formatAmount(row.expense, currency),
      net: formatAmount(net, currency),
      savings_rate: income.isZero() ? null : net.div(income).toDecimalPlaces(4).toNumber(),
      count: row.count,
    };
  });
}

async function groupsFor(from: string, to: string, type: CashflowType, groupBy: CashflowGroupBy): Promise<CashflowGroup[]> {
  const { tx } = currentContext();
  const key = groupKey(groupBy);
  const rows = await tx
    .select({
      currency: t.currency,
      key,
      merchantLabel: sql<string | null>`min(trim(${t.merchant}))`,
      income: INCOME,
      expense: EXPENSE,
      count: COUNT,
    })
    .from(t)
    .leftJoin(category, eq(category.id, t.categoryId))
    .where(baseWhere(from, to, type))
    .groupBy(t.currency, key);

  const categoryNames = new Map((await loadCategories({ includeArchived: true })).map((c) => [c.id, c.name]));
  const accountNames = new Map((await loadAccounts({ includeArchived: true })).map((a) => [a.id, a.name]));
  const labelOf = (rowKey: string | null, merchantLabel: string | null): string => {
    if (groupBy === 'category') return rowKey ? (categoryNames.get(rowKey) ?? rowKey) : '(chưa phân loại)';
    if (groupBy === 'account') return rowKey ? (accountNames.get(rowKey) ?? rowKey) : '(không rõ)';
    if (groupBy === 'merchant') return rowKey ? (merchantLabel ?? rowKey) : '(không rõ)';
    return rowKey ?? '';
  };

  const groups = rows.map((row) => {
    const currency = parseCurrency(row.currency);
    return {
      currency,
      key: row.key,
      label: labelOf(row.key, row.merchantLabel),
      income: formatAmount(row.income, currency),
      expense: formatAmount(row.expense, currency),
      net: formatAmount(new Decimal(row.income).minus(row.expense), currency),
      count: row.count,
    };
  });

  if (TIME_GROUPS.has(groupBy)) {
    return groups.sort((a, b) => (a.key ?? '').localeCompare(b.key ?? '') || a.currency.localeCompare(b.currency));
  }
  return groups.sort(
    (a, b) =>
      new Decimal(b.expense).comparedTo(a.expense) ||
      new Decimal(b.income).comparedTo(a.income) ||
      a.label.localeCompare(b.label),
  );
}

export async function cashflowSummary(input: {
  from: string;
  to: string;
  type?: CashflowType;
  groupBy?: CashflowGroupBy;
  comparePrevious?: boolean;
}): Promise<CashflowSummary> {
  const from = parseIsoDate(input.from, 'from');
  const to = parseIsoDate(input.to, 'to');
  assertDateRange(from, to);
  const type = input.type ?? 'all';

  const period = async (periodFrom: string, periodTo: string): Promise<CashflowPeriod> => ({
    from: periodFrom,
    to: periodTo,
    totals: await totalsFor(periodFrom, periodTo, type),
    groups: input.groupBy ? await groupsFor(periodFrom, periodTo, type, input.groupBy) : [],
  });

  const current = await period(from, to);
  let previous: CashflowPeriod | null = null;
  let comparison: CashflowComparison[] | null = null;

  if (input.comparePrevious) {
    const range = previousPeriod(from, to);
    previous = await period(range.from, range.to);
    const before = previous;
    const currencies = [...new Set([...current.totals, ...before.totals].map((row) => row.currency))].sort();
    comparison = currencies.map((code) => {
      const currency = parseCurrency(code);
      const now = current.totals.find((row) => row.currency === code);
      const earlier = before.totals.find((row) => row.currency === code);
      const change = (field: 'income' | 'expense' | 'net') =>
        formatAmount(new Decimal(now?.[field] ?? 0).minus(earlier?.[field] ?? 0), currency);
      return { currency, income_change: change('income'), expense_change: change('expense'), net_change: change('net') };
    });
  }

  return { ...current, type, group_by: input.groupBy ?? null, previous, comparison };
}
