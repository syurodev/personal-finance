import { Decimal } from 'decimal.js';
import { and, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import { recordAudit } from '../audit/audit.js';
import { todayIn } from '../common/dates.js';
import { daysInMonth, monthOf, monthRange, parseMonth } from '../common/periods.js';
import { currentContext } from '../db/request-context.js';
import { budget, ledgerTransaction } from '../db/schema/index.js';
import { type Currency, parseCurrency } from '../money/currency.js';
import { formatAmount, parseAmount } from '../money/money.js';
import { descendantIds, loadCategories, resolveCategory } from './categories.js';
import { getUserSettings } from './user-settings.js';

export type BudgetHealth = 'ok' | 'warning' | 'over';

export type BudgetMeasure = { limit: string; spent: string; remaining: string; percent: number; status: BudgetHealth };

export type BudgetItem = BudgetMeasure & { category: { id: string; name: string }; effective_from: string };

export type BudgetStatus = {
  month: string;
  currency: string;
  days_in_month: number;
  days_elapsed: number;
  items: BudgetItem[];
  total: BudgetMeasure | null;
};

export type BudgetSetting = {
  category: { id: string; name: string };
  effective_from: string;
  limit: string | null;
  currency: string;
};

/** Ngưỡng cảnh báo: đã chi từ 80% hạn mức. */
const WARNING_PERCENT = 80;

function measure(limit: Decimal, spent: Decimal, currency: Currency): BudgetMeasure {
  const percent = limit.isZero() ? 0 : spent.div(limit).times(100).toDecimalPlaces(1).toNumber();
  const status: BudgetHealth = spent.greaterThan(limit) ? 'over' : percent >= WARNING_PERCENT ? 'warning' : 'ok';
  return {
    limit: formatAmount(limit, currency),
    spent: formatAmount(spent, currency),
    remaining: formatAmount(limit.minus(spent), currency),
    percent,
    status,
  };
}

export async function setBudget(input: {
  category: string;
  amount: string | null;
  fromMonth?: string;
}): Promise<BudgetSetting> {
  const { tx, userId } = currentContext();
  const settings = await getUserSettings();
  const target = await resolveCategory(input.category, 'expense');
  const effectiveFrom = input.fromMonth
    ? parseMonth(input.fromMonth, 'from_month')
    : monthOf(todayIn(settings.timezone));
  const currency = settings.baseCurrency;
  const amount = input.amount === null ? null : parseAmount(input.amount, currency).toFixed();

  const [row] = await tx
    .insert(budget)
    .values({ userId, categoryId: target.id, amount, currency, effectiveFrom })
    .onConflictDoUpdate({
      target: [budget.userId, budget.categoryId, budget.effectiveFrom],
      set: { amount, currency, updatedAt: new Date() },
    })
    .returning();
  await recordAudit('budget.set', 'budget', [row!.id]);

  return {
    category: { id: target.id, name: target.name },
    effective_from: effectiveFrom,
    limit: amount === null ? null : formatAmount(amount, currency),
    currency,
  };
}

export async function getBudgetStatus(monthInput?: string): Promise<BudgetStatus> {
  const { tx } = currentContext();
  const t = ledgerTransaction;
  const settings = await getUserSettings();
  const today = todayIn(settings.timezone);
  const month = monthInput ? parseMonth(monthInput) : monthOf(today);
  const { from, to } = monthRange(month);
  const length = daysInMonth(month);
  const currentMonth = monthOf(today);
  const daysElapsed = month < currentMonth ? length : month === currentMonth ? Number(today.slice(8, 10)) : 0;

  // Dòng mới nhất (effective_from <= month) của mỗi danh mục quyết định hạn mức tháng đó.
  const rows = await tx.select().from(budget).where(lte(budget.effectiveFrom, month)).orderBy(desc(budget.effectiveFrom));
  const latest = new Map<string, (typeof rows)[number]>();
  for (const row of rows) if (!latest.has(row.categoryId)) latest.set(row.categoryId, row);

  const categories = new Map((await loadCategories()).map((c) => [c.id, c]));
  const active = [...latest.values()].filter((row) => row.amount !== null && categories.has(row.categoryId));

  const items: BudgetItem[] = [];
  for (const row of active) {
    const currency = parseCurrency(row.currency);
    const ids = await descendantIds(row.categoryId);
    const [spentRow] = await tx
      .select({ spent: sql<string>`coalesce(sum(-${t.amount}), 0)::text` })
      .from(t)
      .where(
        and(
          eq(t.kind, 'standard'),
          isNull(t.deletedAt),
          sql`${t.amount} < 0`,
          eq(t.currency, currency),
          gte(t.occurredOn, from),
          lte(t.occurredOn, to),
          inArray(t.categoryId, ids),
        ),
      );
    const target = categories.get(row.categoryId)!;
    items.push({
      category: { id: target.id, name: target.name },
      effective_from: row.effectiveFrom,
      ...measure(new Decimal(row.amount!), new Decimal(spentRow?.spent ?? '0'), currency),
    });
  }
  items.sort((a, b) => b.percent - a.percent || a.category.name.localeCompare(b.category.name));

  // Tổng không cộng ngân sách của danh mục con khi danh mục cha cũng có ngân sách.
  const budgeted = new Set(active.map((row) => row.categoryId));
  const counted = items.filter((item) => {
    const parentId = categories.get(item.category.id)?.parentId;
    return !(parentId && budgeted.has(parentId));
  });
  const baseCurrency = settings.baseCurrency;
  const total =
    counted.length === 0
      ? null
      : measure(
          counted.reduce((sum, item) => sum.plus(item.limit), new Decimal(0)),
          counted.reduce((sum, item) => sum.plus(item.spent), new Decimal(0)),
          baseCurrency,
        );

  return { month, currency: baseCurrency, days_in_month: length, days_elapsed: daysElapsed, items, total };
}
