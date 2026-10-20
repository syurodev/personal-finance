# Plan 3 — Ngân sách, báo cáo cashflow, prompt tổng kết tháng: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agent đặt và theo dõi ngân sách tháng theo danh mục, trả lời câu hỏi thu–chi–tiết kiệm có so sánh kỳ trước, và có kịch bản tổng kết tháng; đồng thời đối soát số dư an toàn khi gọi song song.

**Architecture:** Thêm bảng `budget` (RLS) và hai module domain thuần `src/ledger/budgets.ts`, `src/ledger/cashflow.ts` tính toán bằng SQL tổng hợp trên cột `numeric`, `decimal.js` ở app. Ba tool MCP mới + một MCP prompt; `get_overview` thêm trường `budget` (thay đổi tương thích). `reconcile_account` khoá dòng ví (`SELECT … FOR UPDATE`) trước khi đọc số dư.

**Tech Stack:** như Plan 2 — Bun 1.4, NestJS 12, Drizzle 0.45, PostgreSQL 18, decimal.js, zod 4, @modelcontextprotocol/sdk 1.32.1, vitest 4.

**Spec:** `docs/superpowers/specs/2026-10-20-personal-finance-mcp-design.md` §4.3 (ngân sách), §6.2 (#11–13), §6.3 (prompt), §10 (quy tắc tương thích). **Plan 2** đã xong (12 tool, ledger có RLS).

---

## Quy ước cho người thực thi

- **Chỉ dùng Bun:** `bun <file.ts>`, `bun run <script>`, `bun add`, `bunx --bun`. Không `node`, `npm`, `npx`, `tsx`. Nếu `bun` không có trên PATH: `/home/ptvu3/.bun/bin/bun`.
- **Git:** chỉ dùng DevKit tools (`mcp__devkit__git_stage`, `mcp__devkit__git_commit`, `mcp__devkit__git_branch_create`); commit message kết thúc bằng dòng `Co-Authored-By` theo hướng dẫn phiên. Không push.
- **Import nội bộ** có hậu tố `.js`. **Tiền không bao giờ là JS `number`** — `numeric` ở DB, `Decimal` trong code, chuỗi ở output. `percent` và `savings_rate` là số (không phải tiền).
- **Postgres** phải chạy (`bun run db:up`, cổng 5433). e2e dùng cổng 3101; app của người dùng có thể đang chạy ở 3000 với DB dev — để yên.
- **Không nới assertion.** Các test ghi chú cách tính từng con số; số không khớp thì tìm lỗi trong code.
- **Biểu thức SQL dùng trong cả `select` và `groupBy` không được có tham số** (`${…}` của giá trị JS): Postgres so khớp GROUP BY theo văn bản, `$1` ≠ `$2`. Chuỗi hằng viết thẳng trong template (`'YYYY-MM'`), chỉ nội suy cột.

## File structure

```
src/common/periods.ts                 tháng, khoảng ngày, kỳ liền trước, tháng tổng kết mặc định
src/common/periods.spec.ts
src/db/schema/ledger.ts               (sửa) thêm bảng budget
drizzle/0005_budget.sql, 0006_budget_rls.sql
src/ledger/budgets.ts                 setBudget, getBudgetStatus
src/ledger/budgets.int-spec.ts
src/ledger/cashflow.ts                cashflowSummary
src/ledger/cashflow.int-spec.ts
src/ledger/transactions.ts            (sửa) reconcileAccount khoá dòng ví
src/ledger/reconcile-concurrency.int-spec.ts
src/ledger/overview.ts                (sửa) thêm trường budget
src/mcp/tools/budget.tools.ts         set_budget, get_budget_status
src/mcp/tools/cashflow.tool.ts        cashflow_summary
src/mcp/tools/overview.tool.ts        (sửa) outputSchema + summary có budget
src/mcp/prompts/month-end-review.prompt.ts
src/mcp/mcp-server.factory.ts         (sửa) đăng ký tool/prompt, instructions, version 0.3.0
test/mcp-client.ts                    (sửa) ALL_TOOLS dùng chung
test/ledger-mcp.e2e-spec.ts           (sửa) dùng ALL_TOOLS
test/report-mcp.e2e-spec.ts           kịch bản ngân sách + báo cáo qua MCP
CHANGELOG.md, package.json            0.3.0
```

---

### Task 1: Kỳ thời gian (`periods`)

**Files:**
- Create: `src/common/periods.ts`, `src/common/periods.spec.ts`

- [ ] **Step 1: Test thất bại** — `src/common/periods.spec.ts`:

```ts
import {
  addDays,
  addMonths,
  daysInMonth,
  monthOf,
  monthRange,
  parseMonth,
  previousPeriod,
  reviewMonth,
} from './periods.js';

describe('periods', () => {
  it('parses months', () => {
    expect(parseMonth('2026-10')).toBe('2026-10');
    expect(() => parseMonth('2026-13')).toThrow(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
    expect(() => parseMonth('2026-1')).toThrow(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
  });

  it('does month arithmetic across years', () => {
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(addMonths('2026-10', 3)).toBe('2027-01');
    expect(monthOf('2026-10-20')).toBe('2026-10');
  });

  it('knows month lengths including leap years', () => {
    expect(daysInMonth('2026-02')).toBe(28);
    expect(daysInMonth('2028-02')).toBe(29);
    expect(monthRange('2026-09')).toEqual({ from: '2026-09-01', to: '2026-09-30' });
  });

  it('adds days across month boundaries', () => {
    expect(addDays('2026-10-01', -1)).toBe('2026-09-30');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('previous period of whole months is the previous whole months', () => {
    expect(previousPeriod('2026-10-01', '2026-10-31')).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(previousPeriod('2026-03-01', '2026-03-31')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(previousPeriod('2026-09-01', '2026-10-31')).toEqual({ from: '2026-07-01', to: '2026-08-31' });
  });

  it('previous period of an arbitrary range has the same length', () => {
    expect(previousPeriod('2026-10-10', '2026-10-16')).toEqual({ from: '2026-10-03', to: '2026-10-09' });
  });

  it('review month is last month during the first week, otherwise this month', () => {
    expect(reviewMonth('2026-10-05')).toBe('2026-09');
    expect(reviewMonth('2026-10-20')).toBe('2026-10');
  });
});
```

Run: `bun run test src/common/periods.spec.ts` → FAIL.

- [ ] **Step 2: `src/common/periods.ts`**

```ts
import { DomainError } from './domain-error.js';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const DAY_MS = 86_400_000;

export function parseMonth(input: string, field = 'month'): string {
  if (!MONTH.test(input)) throw new DomainError('VALIDATION_ERROR', `${field} phải có dạng YYYY-MM (nhận "${input}").`);
  return input;
}

export function monthOf(date: string): string {
  return date.slice(0, 7);
}

function splitMonth(month: string): [number, number] {
  const [year, monthNumber] = month.split('-').map(Number);
  return [year!, monthNumber!];
}

export function addMonths(month: string, delta: number): string {
  const [year, monthNumber] = splitMonth(month);
  return new Date(Date.UTC(year, monthNumber - 1 + delta, 1)).toISOString().slice(0, 7);
}

export function daysInMonth(month: string): number {
  const [year, monthNumber] = splitMonth(month);
  return new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
}

export function monthRange(month: string): { from: string; to: string } {
  return { from: `${month}-01`, to: `${month}-${String(daysInMonth(month)).padStart(2, '0')}` };
}

export function addDays(date: string, delta: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + delta * DAY_MS).toISOString().slice(0, 10);
}

function monthsBetween(from: string, to: string): number {
  const [fromYear, fromMonth] = splitMonth(from);
  const [toYear, toMonth] = splitMonth(to);
  return (toYear - fromYear) * 12 + (toMonth - fromMonth);
}

/** Kỳ liền trước: khoảng phủ trọn tháng → lùi đúng số tháng đó; khoảng bất kỳ → lùi cùng số ngày. */
export function previousPeriod(from: string, to: string): { from: string; to: string } {
  const wholeMonths = from.endsWith('-01') && to === monthRange(monthOf(to)).to;
  if (wholeMonths) {
    const span = monthsBetween(monthOf(from), monthOf(to)) + 1;
    return {
      from: `${addMonths(monthOf(from), -span)}-01`,
      to: monthRange(addMonths(monthOf(to), -span)).to,
    };
  }
  const length = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1;
  return { from: addDays(from, -length), to: addDays(from, -1) };
}

/** Tháng mặc định để tổng kết: 7 ngày đầu tháng → tháng trước, còn lại → tháng hiện tại. */
export function reviewMonth(today: string): string {
  return Number(today.slice(8, 10)) <= 7 ? addMonths(monthOf(today), -1) : monthOf(today);
}
```

- [ ] **Step 3: Chạy** — `bun run test && bun run typecheck` → PASS.

- [ ] **Step 4: Commit** — `src/common/periods.ts`, `src/common/periods.spec.ts`:

```
feat(common): add month and period helpers for budgets and reports
```

---

### Task 2: Bảng `budget` + RLS

**Files:**
- Modify: `src/db/schema/ledger.ts`
- Generate: `drizzle/0005_budget.sql`, `drizzle/0006_budget_rls.sql` (custom)

- [ ] **Step 1: Thêm vào cuối `src/db/schema/ledger.ts`** (dùng lại helper `ownerId()` và `timestamps()` đã có trong file):

```ts
export const budget = pgTable(
  'budget',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    userId: ownerId(),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => category.id, { onDelete: 'cascade' }),
    /** Hạn mức tháng; null = bỏ hạn mức từ effective_from. */
    amount: numeric('amount'),
    currency: text('currency').notNull(),
    /** 'YYYY-MM': áp dụng từ tháng này cho tới dòng mới hơn của cùng danh mục. */
    effectiveFrom: text('effective_from').notNull(),
    ...timestamps(),
  },
  (t) => [
    check('budget_effective_from_format', sql`${t.effectiveFrom} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
    check('budget_amount_positive', sql`${t.amount} is null or ${t.amount} > 0`),
    uniqueIndex('budget_user_category_month_uidx').on(t.userId, t.categoryId, t.effectiveFrom),
  ],
);
```

- [ ] **Step 2: Sinh migration bảng** — `bun run db:generate --name=budget` → `drizzle/0005_budget.sql` có `CREATE TABLE "budget"`, hai `CHECK`, unique index, FK.

- [ ] **Step 3: Migration custom RLS** — `bun run db:generate --custom --name=budget_rls`, ghi vào `drizzle/0006_budget_rls.sql`:

```sql
ALTER TABLE "budget" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "budget" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "budget_owner" ON "budget" TO pf_app
  USING ("user_id" = current_setting('app.user_id', true))
  WITH CHECK ("user_id" = current_setting('app.user_id', true));
```

- [ ] **Step 4: Áp dụng lên DB dev** — `bun run db:migrate` rồi `docker compose exec -T db psql -U postgres -d personal_finance -c '\dp budget'` → có policy `budget_owner`.

- [ ] **Step 5: Chạy** — `bun run test:int && bun run typecheck` → PASS (36 test cũ).

- [ ] **Step 6: Commit** — `src/db/schema/ledger.ts`, `drizzle/`:

```
feat(db): add monthly budget table with row level security
```

---

### Task 3: Domain ngân sách

**Files:**
- Create: `src/ledger/budgets.ts`, `src/ledger/budgets.int-spec.ts`

- [ ] **Step 1: Integration test thất bại** — `src/ledger/budgets.int-spec.ts`:

```ts
import { pool } from '../db/index.js';
import { asUser, createTestUser } from '../../test/fixtures.js';
import { createAccount } from './accounts.js';
import { getBudgetStatus, setBudget } from './budgets.js';
import { createCategory } from './categories.js';
import { deleteTransaction, recordTransactions, recordTransfer, searchTransactions } from './transactions.js';

describe('budgets', () => {
  let alice: string;

  beforeAll(async () => {
    alice = await createTestUser();
    await asUser(alice, async () => {
      await createAccount({ type: 'bank', name: 'VCB', openingBalance: '50000000' });
      await createAccount({ type: 'cash', name: 'Tiền mặt' });
      await createCategory({ name: 'Cà phê', kind: 'expense', parent: 'Ăn uống' });
      await recordTransactions([
        { amount: '3000000', type: 'expense', account: 'VCB', category: 'Ăn uống', occurredOn: '2026-09-10' },
        { amount: '1500000', type: 'expense', account: 'VCB', category: 'Ăn uống', occurredOn: '2026-10-05' },
        { amount: '500000', type: 'expense', account: 'VCB', category: 'Cà phê', occurredOn: '2026-10-06' },
        { amount: '1000000', type: 'expense', account: 'VCB', category: 'Mua sắm', occurredOn: '2026-10-07' },
        { amount: '999000', type: 'expense', account: 'VCB', category: 'Mua sắm', occurredOn: '2026-10-08', note: 'sẽ xoá' },
      ]);
      // Chuyển khoản không tính vào ngân sách.
      await recordTransfer({ fromAccount: 'VCB', toAccount: 'Tiền mặt', amount: '700000', occurredOn: '2026-10-09' });
    });
    const deleted = await asUser(alice, async () => (await searchTransactions({ text: 'sẽ xoá' })).items[0]!);
    await asUser(alice, () => deleteTransaction(deleted.id));
  });

  afterAll(async () => {
    await pool.end();
  });

  it('sets a budget from a given month in the base currency', async () => {
    const result = await asUser(alice, () => setBudget({ category: 'an uong', amount: '2500000', fromMonth: '2026-09' }));
    expect(result).toMatchObject({ category: { name: 'Ăn uống' }, effective_from: '2026-09', limit: '2500000', currency: 'VND' });
    await asUser(alice, () => setBudget({ category: 'Mua sắm', amount: '800000', fromMonth: '2026-10' }));
  });

  it('rejects budgets on income categories and bad amounts', async () => {
    await expect(asUser(alice, () => setBudget({ category: 'Lương', amount: '1000' }))).rejects.toMatchObject({
      code: 'CATEGORY_KIND_MISMATCH',
    });
    await expect(asUser(alice, () => setBudget({ category: 'Mua sắm', amount: '0' }))).rejects.toMatchObject({
      code: 'INVALID_AMOUNT',
    });
  });

  it('computes October: children roll up, transfers and deleted rows are ignored', async () => {
    const status = await asUser(alice, () => getBudgetStatus('2026-10'));
    expect(status).toMatchObject({ month: '2026-10', currency: 'VND', days_in_month: 31 });
    expect(status.items).toEqual([
      {
        category: expect.objectContaining({ name: 'Mua sắm' }),
        effective_from: '2026-10',
        limit: '800000',
        spent: '1000000',
        remaining: '-200000',
        percent: 125,
        status: 'over',
      },
      {
        category: expect.objectContaining({ name: 'Ăn uống' }),
        effective_from: '2026-09',
        limit: '2500000',
        spent: '2000000',
        remaining: '500000',
        percent: 80,
        status: 'warning',
      },
    ]);
    expect(status.total).toEqual({ limit: '3300000', spent: '3000000', remaining: '300000', percent: 90.9, status: 'warning' });
  });

  it('a budget applies only from its month on', async () => {
    const status = await asUser(alice, () => getBudgetStatus('2026-09'));
    expect(status.items.map((i) => [i.category.name, i.spent, i.status])).toEqual([['Ăn uống', '3000000', 'over']]);
    expect(status.days_elapsed).toBe(30);
  });

  it('null removes a budget from a month on, earlier months keep it', async () => {
    await asUser(alice, () => setBudget({ category: 'Ăn uống', amount: null, fromMonth: '2026-11' }));
    const november = await asUser(alice, () => getBudgetStatus('2026-11'));
    expect(november.items.map((i) => i.category.name)).toEqual(['Mua sắm']);
    expect(november.items[0]).toMatchObject({ spent: '0', percent: 0, status: 'ok' });
    const october = await asUser(alice, () => getBudgetStatus('2026-10'));
    expect(october.items).toHaveLength(2);
  });

  it('setting the same month twice updates instead of duplicating', async () => {
    await asUser(alice, () => setBudget({ category: 'Mua sắm', amount: '900000', fromMonth: '2026-10' }));
    const status = await asUser(alice, () => getBudgetStatus('2026-10'));
    expect(status.items.find((i) => i.category.name === 'Mua sắm')?.limit).toBe('900000');
  });

  it('a child budget is shown but not double counted in the total when its parent has one', async () => {
    await asUser(alice, () => setBudget({ category: 'Cà phê', amount: '400000', fromMonth: '2026-10' }));
    const status = await asUser(alice, () => getBudgetStatus('2026-10'));
    expect(status.items.find((i) => i.category.name === 'Cà phê')).toMatchObject({ spent: '500000', status: 'over' });
    // Tổng = Ăn uống 2.500.000 + Mua sắm 900.000; Cà phê nằm trong Ăn uống nên không cộng thêm.
    expect(status.total).toMatchObject({ limit: '3400000', spent: '3000000' });
  });

  it('returns no total when there are no budgets', async () => {
    const bob = await createTestUser();
    const status = await asUser(bob, () => getBudgetStatus('2026-10'));
    expect(status.items).toEqual([]);
    expect(status.total).toBeNull();
  });
});
```

(Tháng 10: Ăn uống = 1.500.000 + Cà phê 500.000 = 2.000.000 / 2.500.000 = 80% → warning; Mua sắm = 1.000.000 (dòng 999.000 đã xoá) / 800.000 = 125% → over; tổng 3.000.000 / 3.300.000 = 90,9%. Chuyển khoản 700.000 không tính.)

- [ ] **Step 2: `src/ledger/budgets.ts`**

```ts
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
```

- [ ] **Step 3: Chạy** — `bun run test:int` → PASS (thêm 8 test). `bun run typecheck && bun run lint` sạch.

- [ ] **Step 4: Commit** — `src/ledger/budgets.ts`, `src/ledger/budgets.int-spec.ts`:

```
feat(ledger): add monthly category budgets with carry-forward and status
```

---

### Task 4: Báo cáo cashflow

**Files:**
- Create: `src/ledger/cashflow.ts`, `src/ledger/cashflow.int-spec.ts`

- [ ] **Step 1: Integration test thất bại** — `src/ledger/cashflow.int-spec.ts`:

```ts
import { pool } from '../db/index.js';
import { asUser, createTestUser } from '../../test/fixtures.js';
import { createAccount } from './accounts.js';
import { createCategory } from './categories.js';
import { cashflowSummary } from './cashflow.js';
import { reconcileAccount, recordTransactions, recordTransfer } from './transactions.js';

describe('cashflowSummary', () => {
  let alice: string;

  beforeAll(async () => {
    alice = await createTestUser();
    await asUser(alice, async () => {
      await createAccount({ type: 'bank', name: 'VCB' });
      await createAccount({ type: 'cash', name: 'Tiền mặt' });
      await createAccount({ type: 'bank', name: 'Wise', currency: 'USD' });
      await createCategory({ name: 'Cà phê', kind: 'expense', parent: 'Ăn uống' });
      await recordTransactions([
        { amount: '20000000', type: 'income', account: 'VCB', category: 'Lương', occurredOn: '2026-09-01' },
        { amount: '3000000', type: 'expense', account: 'VCB', category: 'Ăn uống', occurredOn: '2026-09-10' },
        { amount: '500000', type: 'expense', account: 'VCB', category: 'Đi lại', occurredOn: '2026-09-12' },
        { amount: '25000000', type: 'income', account: 'VCB', category: 'Lương', occurredOn: '2026-10-01' },
        { amount: '1500000', type: 'expense', account: 'VCB', category: 'Ăn uống', occurredOn: '2026-10-05' },
        { amount: '500000', type: 'expense', account: 'Tiền mặt', category: 'Cà phê', occurredOn: '2026-10-06', merchant: 'Highlands' },
        { amount: '1000000', type: 'expense', account: 'VCB', occurredOn: '2026-10-07' },
        { amount: '12.5', type: 'expense', account: 'Wise', category: 'Mua sắm', occurredOn: '2026-10-08' },
      ]);
      // Không phải thu/chi: chuyển khoản và điều chỉnh đối soát.
      await recordTransfer({ fromAccount: 'VCB', toAccount: 'Tiền mặt', amount: '2000000', occurredOn: '2026-10-09' });
      await reconcileAccount({ account: 'Tiền mặt', actualBalance: '1000000', asOf: '2026-10-10' });
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  const october = { from: '2026-10-01', to: '2026-10-31' };

  it('totals per currency with net and savings rate, excluding transfers and adjustments', async () => {
    const result = await asUser(alice, () => cashflowSummary(october));
    expect(result).toMatchObject({ ...october, type: 'all', group_by: null, groups: [], previous: null, comparison: null });
    expect(result.totals).toEqual([
      { currency: 'USD', income: '0.00', expense: '12.50', net: '-12.50', savings_rate: null, count: 1 },
      { currency: 'VND', income: '25000000', expense: '3000000', net: '22000000', savings_rate: 0.88, count: 4 },
    ]);
  });

  it('groups by top-level category (children roll up), largest spending first', async () => {
    const result = await asUser(alice, () => cashflowSummary({ ...october, groupBy: 'category' }));
    expect(result.groups.map((g) => [g.currency, g.label, g.expense, g.income])).toEqual([
      ['VND', 'Ăn uống', '2000000', '0'],
      ['VND', '(chưa phân loại)', '1000000', '0'],
      ['USD', 'Mua sắm', '12.50', '0.00'],
      ['VND', 'Lương', '0', '25000000'],
    ]);
  });

  it('groups by merchant and by account', async () => {
    const merchants = await asUser(alice, () => cashflowSummary({ ...october, type: 'expense', groupBy: 'merchant' }));
    expect(merchants.groups.filter((g) => g.currency === 'VND').map((g) => [g.label, g.expense])).toEqual([
      ['(không rõ)', '2500000'],
      ['Highlands', '500000'],
    ]);
    const accounts = await asUser(alice, () => cashflowSummary({ ...october, type: 'expense', groupBy: 'account' }));
    expect(accounts.groups.map((g) => [g.label, g.expense])).toEqual([
      ['VCB', '2500000'],
      ['Tiền mặt', '500000'],
      ['Wise', '12.50'],
    ]);
  });

  it('groups by month in chronological order', async () => {
    const result = await asUser(alice, () =>
      cashflowSummary({ from: '2026-09-01', to: '2026-10-31', type: 'expense', groupBy: 'month' }),
    );
    expect(result.groups.filter((g) => g.currency === 'VND').map((g) => [g.key, g.expense])).toEqual([
      ['2026-09', '3500000'],
      ['2026-10', '3000000'],
    ]);
  });

  it('compares with the previous whole month', async () => {
    const result = await asUser(alice, () => cashflowSummary({ ...october, groupBy: 'category', comparePrevious: true }));
    expect(result.previous).toMatchObject({ from: '2026-09-01', to: '2026-09-30' });
    expect(result.previous!.totals).toEqual([
      { currency: 'VND', income: '20000000', expense: '3500000', net: '16500000', savings_rate: 0.825, count: 3 },
    ]);
    expect(result.comparison).toEqual([
      { currency: 'USD', income_change: '0.00', expense_change: '12.50', net_change: '-12.50' },
      { currency: 'VND', income_change: '5000000', expense_change: '-500000', net_change: '5500000' },
    ]);
  });

  it('validates the date range', async () => {
    await expect(asUser(alice, () => cashflowSummary({ from: '2026-10-31', to: '2026-10-01' }))).rejects.toMatchObject({
      code: 'INVALID_DATE_RANGE',
    });
  });
});
```

(Tháng 10 VND: thu 25.000.000; chi 1.500.000 + 500.000 + 1.000.000 = 3.000.000; ròng 22.000.000; tiết kiệm 22/25 = 0,88. Tháng 9: chi 3.500.000, tiết kiệm 16,5/20 = 0,825. Chuyển khoản 2.000.000 và dòng điều chỉnh không tính.)

- [ ] **Step 2: `src/ledger/cashflow.ts`**

```ts
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
```

- [ ] **Step 3: Chạy** — `bun run test:int` → PASS (thêm 6 test). `bun run typecheck && bun run lint` sạch.

Nếu Postgres báo `column … must appear in the GROUP BY clause`: một biểu thức khoá đang có tham số — kiểm tra lại `groupKey` theo quy ước đầu plan.

- [ ] **Step 4: Commit** — `src/ledger/cashflow.ts`, `src/ledger/cashflow.int-spec.ts`:

```
feat(ledger): add cashflow summary with grouping and previous-period comparison
```

---

### Task 5: Đối soát an toàn khi gọi song song

**Files:**
- Create: `src/ledger/reconcile-concurrency.int-spec.ts`
- Modify: `src/ledger/transactions.ts` (hàm `reconcileAccount`)

- [ ] **Step 1: Test** — `src/ledger/reconcile-concurrency.int-spec.ts`:

```ts
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
```

Run: `bun run test:int src/ledger/reconcile-concurrency.int-spec.ts` → kỳ vọng FAIL (nhiều hơn 1 dòng điều chỉnh). Race có thể không xảy ra mỗi lần; nếu test pass trước khi sửa, vẫn làm Step 2 và ghi lại trong báo cáo.

- [ ] **Step 2: Khoá dòng ví** — trong `reconcileAccount` (`src/ledger/transactions.ts`), ngay sau dòng

```ts
  const account = await resolveAccount(input.account);
```

thêm:

```ts
  // Khoá dòng ví tới hết transaction: lần đối soát song song phải chờ và đọc số dư đã có điều chỉnh.
  await tx.execute(sql`select 1 from ledger_account where id = ${account.id} for update`);
```

(`sql` đã được import trong file.)

- [ ] **Step 3: Chạy** — `bun run test:int` → PASS (tất cả, kể cả test mới, chạy 3 lần liên tiếp: `for i in 1 2 3; do bun run test:int src/ledger/reconcile-concurrency.int-spec.ts || break; done`).

- [ ] **Step 4: Commit**:

```
fix(ledger): lock the account row while reconciling to avoid duplicate adjustments
```

---

### Task 6: Tóm tắt ngân sách trong `get_overview`

**Files:**
- Modify: `src/ledger/overview.ts`, `src/ledger/overview.int-spec.ts`

- [ ] **Step 1: Test thất bại** — thay toàn bộ `src/ledger/overview.int-spec.ts` (test cũ giữ nguyên số liệu; hai khoản chi VCB nay thuộc danh mục "Khác" có ngân sách):

```ts
import { pool } from '../db/index.js';
import { asUser, createTestUser } from '../../test/fixtures.js';
import { createAccount, updateAccount } from './accounts.js';
import { setBudget } from './budgets.js';
import { getOverview } from './overview.js';
import { recordTransactions } from './transactions.js';

describe('getOverview', () => {
  let alice: string;

  beforeAll(async () => {
    alice = await createTestUser();
    await asUser(alice, async () => {
      await createAccount({ type: 'bank', name: 'VCB', openingBalance: '1000000' });
      await createAccount({ type: 'cash', name: 'Tiền mặt', openingBalance: '200000' });
      await createAccount({ type: 'bank', name: 'Wise', currency: 'USD', openingBalance: '10.5' });
      await createAccount({ type: 'cash', name: 'Ví cũ', openingBalance: '999' });
      await updateAccount('Ví cũ', { archived: true });
      await recordTransactions([
        { amount: '300000', type: 'expense', account: 'VCB', category: 'Khác', occurredOn: '2026-10-05' },
        { amount: '100000', type: 'expense', account: 'VCB', category: 'Khác', occurredOn: '2026-10-20' },
      ]);
      await setBudget({ category: 'Khác', amount: '350000', fromMonth: '2026-10' });
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  it('returns balances as of a date, net worth per currency and the category tree', async () => {
    const overview = await asUser(alice, () => getOverview('2026-10-10'));
    expect(overview.as_of).toBe('2026-10-10');
    expect(overview.timezone).toBe('Asia/Ho_Chi_Minh');
    expect(overview.base_currency).toBe('VND');
    expect(overview.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(overview.accounts.map((a) => [a.name, a.balance])).toEqual([
      ['VCB', '700000'],
      ['Tiền mặt', '200000'],
      ['Wise', '10.50'],
    ]);
    expect(overview.net_worth).toEqual([
      { currency: 'USD', total: '10.50' },
      { currency: 'VND', total: '900000' },
    ]);
    expect(overview.categories).toHaveLength(15);
  });

  it('summarises the budget of the as_of month', async () => {
    const overview = await asUser(alice, () => getOverview('2026-10-10'));
    // Tháng 10: 300.000 + 100.000 = 400.000 / 350.000 → vượt.
    expect(overview.budget).toEqual({
      month: '2026-10',
      currency: 'VND',
      limit: '350000',
      spent: '400000',
      remaining: '-50000',
      percent: 114.3,
      over_count: 1,
      warning_count: 0,
    });
    expect((await asUser(alice, () => getOverview('2026-09-10'))).budget).toBeNull();
  });
});
```

Run: `bun run test:int src/ledger/overview.int-spec.ts` → FAIL.

- [ ] **Step 2: Thay `src/ledger/overview.ts`**

```ts
import { Decimal } from 'decimal.js';
import { parseIsoDate, todayIn } from '../common/dates.js';
import { monthOf } from '../common/periods.js';
import { type Currency, parseCurrency } from '../money/currency.js';
import { formatAmount } from '../money/money.js';
import { accountBalances, loadAccounts, toAccountView } from './accounts.js';
import { getBudgetStatus } from './budgets.js';
import { categoryTree } from './categories.js';
import { getUserSettings } from './user-settings.js';
import type { AccountView, CategoryNode } from './views.js';

export type BudgetSummary = {
  month: string;
  currency: string;
  limit: string;
  spent: string;
  remaining: string;
  percent: number;
  over_count: number;
  warning_count: number;
};

export type Overview = {
  today: string;
  as_of: string;
  timezone: string;
  base_currency: string;
  accounts: AccountView[];
  net_worth: Array<{ currency: string; total: string }>;
  categories: CategoryNode[];
  /** Ngân sách của tháng chứa as_of; null nếu tháng đó không có ngân sách. */
  budget: BudgetSummary | null;
};

export async function getOverview(asOf?: string): Promise<Overview> {
  const settings = await getUserSettings();
  const today = todayIn(settings.timezone);
  const date = asOf ? parseIsoDate(asOf, 'as_of') : today;
  const balances = await accountBalances(date);
  const accounts = (await loadAccounts()).map((row) => toAccountView(row, balances.get(row.id) ?? row.openingBalance));

  const totals = new Map<Currency, Decimal>();
  for (const account of accounts) {
    const currency = parseCurrency(account.currency);
    totals.set(currency, (totals.get(currency) ?? new Decimal(0)).plus(account.balance));
  }

  const status = await getBudgetStatus(monthOf(date));
  const budget: BudgetSummary | null = status.total
    ? {
        month: status.month,
        currency: status.currency,
        limit: status.total.limit,
        spent: status.total.spent,
        remaining: status.total.remaining,
        percent: status.total.percent,
        over_count: status.items.filter((item) => item.status === 'over').length,
        warning_count: status.items.filter((item) => item.status === 'warning').length,
      }
    : null;

  return {
    today,
    as_of: date,
    timezone: settings.timezone,
    base_currency: settings.baseCurrency,
    accounts,
    net_worth: [...totals.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([currency, total]) => ({ currency, total: formatAmount(total, currency) })),
    categories: await categoryTree(),
    budget,
  };
}
```

(400.000 / 350.000 = 114,28…% → làm tròn 1 chữ số = 114,3.)

- [ ] **Step 3: Chạy** — `bun run test:int` → PASS. `bun run typecheck && bun run lint` sạch.

- [ ] **Step 4: Commit**:

```
feat(ledger): include the month's budget summary in the overview
```

---

### Task 7: MCP tools ngân sách, cashflow; overview có budget

**Files:**
- Create: `src/mcp/tools/budget.tools.ts`, `src/mcp/tools/cashflow.tool.ts`
- Modify: `src/mcp/tools/overview.tool.ts`

- [ ] **Step 1: `src/mcp/tools/budget.tools.ts`**

```ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { FINANCE_READ, FINANCE_WRITE } from '../../auth/constants.js';
import { getBudgetStatus, setBudget } from '../../ledger/budgets.js';
import { runTool } from '../tool-kit.js';
import { amountInput, categoryRef, READ_ONLY, WRITE } from './schemas.js';

const monthInput = z.string().describe('Tháng dạng YYYY-MM; bỏ trống = tháng hiện tại theo múi giờ người dùng');

const measure = {
  limit: z.string(),
  spent: z.string(),
  remaining: z.string(),
  percent: z.number(),
  status: z.enum(['ok', 'warning', 'over']),
};

export function registerBudgetTools(server: McpServer): void {
  server.registerTool(
    'set_budget',
    {
      title: 'Đặt ngân sách',
      description:
        'Đặt hạn mức chi hằng tháng cho một danh mục chi (tính cả danh mục con), áp dụng từ from_month cho các tháng sau cho tới khi đặt lại. amount=null để bỏ hạn mức từ tháng đó. Hỏi người dùng trước khi đặt.',
      inputSchema: {
        category: categoryRef,
        amount: amountInput.nullable().describe('Hạn mức tháng; null để bỏ'),
        from_month: monthInput.optional(),
      },
      outputSchema: {
        category: z.object({ id: z.string(), name: z.string() }),
        effective_from: z.string(),
        limit: z.string().nullable(),
        currency: z.string(),
      },
      annotations: WRITE,
    },
    async ({ category, amount, from_month }) =>
      runTool(
        FINANCE_WRITE,
        () => setBudget({ category, amount, fromMonth: from_month }),
        (d) =>
          d.limit === null
            ? `Đã bỏ ngân sách "${d.category.name}" từ ${d.effective_from}.`
            : `Ngân sách "${d.category.name}": ${d.limit} ${d.currency}/tháng từ ${d.effective_from}.`,
      ),
  );

  server.registerTool(
    'get_budget_status',
    {
      title: 'Tình hình ngân sách',
      description:
        'Với mỗi danh mục có ngân sách trong tháng: hạn mức, đã chi, còn lại, % và trạng thái (ok, warning từ 80%, over). Kèm số ngày đã qua trong tháng để đánh giá tốc độ chi. Dùng đúng số liệu trả về.',
      inputSchema: { month: monthInput.optional() },
      outputSchema: {
        month: z.string(),
        currency: z.string(),
        days_in_month: z.number(),
        days_elapsed: z.number(),
        items: z.array(
          z.object({
            ...measure,
            category: z.object({ id: z.string(), name: z.string() }),
            effective_from: z.string(),
          }),
        ),
        total: z.object(measure).nullable(),
      },
      annotations: READ_ONLY,
    },
    async ({ month }) =>
      runTool(FINANCE_READ, () => getBudgetStatus(month), (d) =>
        d.total
          ? `Tháng ${d.month}: đã chi ${d.total.spent}/${d.total.limit} ${d.currency} (${d.total.percent}%).`
          : `Tháng ${d.month} chưa có ngân sách nào.`,
      ),
  );
}
```

- [ ] **Step 2: `src/mcp/tools/cashflow.tool.ts`**

```ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { FINANCE_READ } from '../../auth/constants.js';
import { CASHFLOW_GROUPS, cashflowSummary } from '../../ledger/cashflow.js';
import { runTool } from '../tool-kit.js';
import { READ_ONLY } from './schemas.js';

const totals = z.object({
  currency: z.string(),
  income: z.string(),
  expense: z.string(),
  net: z.string(),
  savings_rate: z.number().nullable(),
  count: z.number(),
});

const group = z.object({
  currency: z.string(),
  key: z.string().nullable(),
  label: z.string(),
  income: z.string(),
  expense: z.string(),
  net: z.string(),
  count: z.number(),
});

const period = { from: z.string(), to: z.string(), totals: z.array(totals), groups: z.array(group) };

export function registerCashflowTool(server: McpServer): void {
  server.registerTool(
    'cashflow_summary',
    {
      title: 'Báo cáo thu chi',
      description:
        'Tổng thu, tổng chi, chênh lệch (net) và tỷ lệ tiết kiệm (savings_rate = net/income) trong khoảng from..to, tách theo tiền tệ; không tính chuyển khoản và điều chỉnh. group_by để chia theo danh mục cấp 1 (gồm con), ví, merchant, tháng, tuần hoặc ngày. compare_previous=true so với kỳ liền trước (tháng trọn → tháng trước). Dùng đúng số liệu trả về, không tự cộng trừ lại.',
      inputSchema: {
        from: z.string().describe('YYYY-MM-DD'),
        to: z.string().describe('YYYY-MM-DD'),
        type: z.enum(['all', 'expense', 'income']).optional().describe('Mặc định all'),
        group_by: z.enum(CASHFLOW_GROUPS).optional(),
        compare_previous: z.boolean().optional(),
      },
      outputSchema: {
        ...period,
        type: z.enum(['all', 'expense', 'income']),
        group_by: z.enum(CASHFLOW_GROUPS).nullable(),
        previous: z.object(period).nullable(),
        comparison: z
          .array(
            z.object({
              currency: z.string(),
              income_change: z.string(),
              expense_change: z.string(),
              net_change: z.string(),
            }),
          )
          .nullable(),
      },
      annotations: READ_ONLY,
    },
    async ({ from, to, type, group_by, compare_previous }) =>
      runTool(
        FINANCE_READ,
        () => cashflowSummary({ from, to, type, groupBy: group_by, comparePrevious: compare_previous }),
        (d) =>
          d.totals.length === 0
            ? `Không có khoản thu/chi nào từ ${d.from} đến ${d.to}.`
            : d.totals.map((x) => `${x.currency}: thu ${x.income}, chi ${x.expense}, còn ${x.net}`).join('; '),
      ),
  );
}
```

- [ ] **Step 3: Thay `src/mcp/tools/overview.tool.ts`**

```ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { FINANCE_READ } from '../../auth/constants.js';
import { getOverview } from '../../ledger/overview.js';
import { runTool } from '../tool-kit.js';
import { accountView, categoryNode, dateInput, READ_ONLY } from './schemas.js';

export function registerOverviewTool(server: McpServer): void {
  server.registerTool(
    'get_overview',
    {
      title: 'Tổng quan tài chính',
      description:
        'Gọi đầu mỗi cuộc trò chuyện. Trả về ngày hôm nay theo múi giờ người dùng, tiền tệ mặc định, các ví và số dư (tại as_of), tổng tài sản theo tiền tệ, cây danh mục, và tóm tắt ngân sách của tháng chứa as_of (null nếu chưa đặt).',
      inputSchema: { as_of: dateInput.optional() },
      outputSchema: {
        today: z.string(),
        as_of: z.string(),
        timezone: z.string(),
        base_currency: z.string(),
        accounts: z.array(accountView),
        net_worth: z.array(z.object({ currency: z.string(), total: z.string() })),
        categories: z.array(categoryNode),
        budget: z
          .object({
            month: z.string(),
            currency: z.string(),
            limit: z.string(),
            spent: z.string(),
            remaining: z.string(),
            percent: z.number(),
            over_count: z.number(),
            warning_count: z.number(),
          })
          .nullable(),
      },
      annotations: READ_ONLY,
    },
    async ({ as_of }) =>
      runTool(FINANCE_READ, () => getOverview(as_of), (d) => {
        const worth = d.net_worth.map((n) => `${n.total} ${n.currency}`).join(', ') || '0';
        const budget = d.budget ? ` Ngân sách ${d.budget.month}: ${d.budget.spent}/${d.budget.limit} (${d.budget.percent}%).` : '';
        return `Hôm nay ${d.today}. ${d.accounts.length} ví; tổng tài sản: ${worth}.${budget}`;
      }),
  );
}
```

- [ ] **Step 4: Typecheck** — `bun run typecheck && bun run lint` → sạch (tool chưa được đăng ký; Task 8 làm).

- [ ] **Step 5: Commit**:

```
feat(mcp): add budget and cashflow tools and budget summary in overview
```

---

### Task 8: Prompt tổng kết tháng, đăng ký tool, version 0.3.0

**Files:**
- Create: `src/mcp/prompts/month-end-review.prompt.ts`, `src/mcp/prompts/month-end-review.prompt.spec.ts`
- Modify: `src/mcp/mcp-server.factory.ts`, `package.json`

- [ ] **Step 1: Test thất bại** — `src/mcp/prompts/month-end-review.prompt.spec.ts`:

```ts
import { buildReviewScript } from './month-end-review.prompt.js';

describe('buildReviewScript', () => {
  it('names the month range and every tool the review uses', () => {
    const script = buildReviewScript('2026-10');
    expect(script).toContain('2026-10-01');
    expect(script).toContain('2026-10-31');
    for (const tool of ['get_overview', 'reconcile_account', 'cashflow_summary', 'get_budget_status', 'search_transactions', 'set_budget']) {
      expect(script).toContain(tool);
    }
  });
});
```

Run: `bun run test src/mcp/prompts` → FAIL.

- [ ] **Step 2: `src/mcp/prompts/month-end-review.prompt.ts`**

```ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { todayIn } from '../../common/dates.js';
import { monthRange, parseMonth, reviewMonth } from '../../common/periods.js';
import { getUserSettings } from '../../ledger/user-settings.js';

export function buildReviewScript(month: string): string {
  const { from, to } = monthRange(month);
  return [
    `Hãy cùng tôi tổng kết tài chính tháng ${month} (${from} → ${to}). Làm lần lượt:`,
    '1. Gọi get_overview. Liệt kê các ví đang dùng và hỏi tôi số dư thực tế của chúng trong một câu hỏi. Ví nào tôi trả lời thì gọi reconcile_account; bỏ qua ví tôi không trả lời.',
    `2. Gọi cashflow_summary với from=${from}, to=${to}, group_by=category, compare_previous=true. Trình bày tổng thu, tổng chi, phần để dành và tỷ lệ tiết kiệm; 5 danh mục chi lớn nhất; danh mục tăng/giảm nhiều nhất so với kỳ trước.`,
    `3. Gọi get_budget_status với month=${month}. Nêu các danh mục vượt (over) hoặc sắp vượt (warning) ngân sách.`,
    `4. Gọi search_transactions với from=${from}, to=${to}, type=expense, sort=amount_desc, limit=5 để nêu 5 khoản chi lớn nhất.`,
    '5. Nhận xét ngắn gọn và đề xuất 1–3 điều chỉnh. Nếu đề xuất ngân sách cho tháng sau, chỉ gọi set_budget khi tôi đồng ý.',
    'Dùng đúng số liệu tool trả về, không tự cộng trừ lại.',
  ].join('\n');
}

export function registerMonthEndReviewPrompt(server: McpServer): void {
  server.registerPrompt(
    'month_end_review',
    {
      title: 'Tổng kết tháng',
      description: 'Kịch bản tổng kết tài chính một tháng: đối soát ví, thu chi so với tháng trước, ngân sách, khoản chi lớn, nhận xét.',
      argsSchema: {
        month: z
          .string()
          .optional()
          .describe('Tháng YYYY-MM; bỏ trống = tháng trước nếu đang ở 7 ngày đầu tháng, ngược lại là tháng này'),
      },
    },
    async ({ month }) => {
      // Prompt chạy trong ngữ cảnh request đã xác thực (runAsUser), nên đọc được timezone của user.
      const target = month ? parseMonth(month) : reviewMonth(todayIn((await getUserSettings()).timezone));
      return {
        description: `Tổng kết tháng ${target}`,
        messages: [{ role: 'user' as const, content: { type: 'text' as const, text: buildReviewScript(target) } }],
      };
    },
  );
}
```

- [ ] **Step 3: Thay `src/mcp/mcp-server.factory.ts`**

```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerMonthEndReviewPrompt } from './prompts/month-end-review.prompt.js';
import { registerAccountTools } from './tools/account.tools.js';
import { registerBudgetTools } from './tools/budget.tools.js';
import { registerCashflowTool } from './tools/cashflow.tool.js';
import { registerCategoryTools } from './tools/category.tools.js';
import { registerOverviewTool } from './tools/overview.tool.js';
import { registerReconcileTool } from './tools/reconcile.tool.js';
import { registerTransactionTools } from './tools/transaction.tools.js';
import { registerWhoamiTool } from './tools/whoami.tool.js';

/** Khớp `version` trong package.json và CHANGELOG.md. */
export const SERVER_VERSION = '0.3.0';

export const SERVER_INSTRUCTIONS = [
  'Đây là sổ thu chi cá nhân của người dùng.',
  'Trả lời người dùng bằng ngôn ngữ họ dùng.',
  'Đầu mỗi cuộc trò chuyện, gọi get_overview để biết ngày hôm nay theo múi giờ người dùng, các ví, danh mục và ngân sách tháng.',
  'Số tiền luôn là chuỗi số dương với dấu chấm thập phân ("85000", "12.5"); chiều thu/chi do tham số type quyết định. Đổi "85k" thành "85000", "2tr" thành "2000000".',
  'Ghi nhiều khoản trong một lần gọi record_transactions.',
  'Chi tiêu bằng thẻ tín dụng ghi vào ví thẻ; trả nợ thẻ, rút tiền ATM, nạp ví điện tử là record_transfer.',
  'Hỏi về hạn mức, "còn bao nhiêu cho …" → get_budget_status. Tổng kết, so sánh thu chi giữa các kỳ → cashflow_summary. Tổng kết cuối tháng có thể theo prompt month_end_review.',
  'Dùng đúng số liệu tool trả về; không tự cộng trừ lại.',
  'Không tự tạo ví, danh mục hay ngân sách khi chưa hỏi người dùng.',
  'Khi một tool trả lỗi dạng JSON {code, message}, đọc message để sửa tham số rồi gọi lại; với AMBIGUOUS_* hoặc *_NOT_FOUND thì hỏi người dùng chọn trong candidates/suggestions.',
].join('\n');

/** Tạo server mới cho mỗi request (transport stateless không dùng lại được). */
export function createMcpServer(): McpServer {
  const server = new McpServer({ name: 'personal-finance', version: SERVER_VERSION }, { instructions: SERVER_INSTRUCTIONS });
  registerWhoamiTool(server);
  registerOverviewTool(server);
  registerAccountTools(server);
  registerCategoryTools(server);
  registerTransactionTools(server);
  registerReconcileTool(server);
  registerBudgetTools(server);
  registerCashflowTool(server);
  registerMonthEndReviewPrompt(server);
  return server;
}
```

- [ ] **Step 4: Version** — trong `package.json` đổi `"version": "0.2.0"` thành `"version": "0.3.0"`.

- [ ] **Step 5: Chạy** — `bun run test && bun run typecheck && bun run lint` → PASS. `bun run test:e2e` sẽ FAIL ở `ledger-mcp.e2e-spec.ts` (danh sách tool cố định 12) — Task 9 sửa.

- [ ] **Step 6: Commit**:

```
feat(mcp): register budget, cashflow and month-end review prompt (0.3.0)
```

---

### Task 9: E2E ngân sách + báo cáo, CHANGELOG

**Files:**
- Modify: `test/mcp-client.ts`, `test/ledger-mcp.e2e-spec.ts`, `.env.test`, `CHANGELOG.md`
- Create: `test/report-mcp.e2e-spec.ts`

- [ ] **Step 1: Danh sách tool dùng chung** — thêm vào cuối `test/mcp-client.ts`:

```ts
/** Mọi tool server phải công bố (so khớp chính xác trong e2e). */
export const ALL_TOOLS = [
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
  'set_budget',
  'get_budget_status',
  'cashflow_summary',
];
```

Trong `test/ledger-mcp.e2e-spec.ts`: xoá hằng `LEDGER_TOOLS`, thêm `ALL_TOOLS` vào dòng import từ `./mcp-client.js`, và đổi `[...LEDGER_TOOLS].sort()` thành `[...ALL_TOOLS].sort()`.

- [ ] **Step 2: Email e2e** — `.env.test`:

```dotenv
ALLOWED_EMAILS=allowed@example.com,oauth-e2e@example.com,ledger-e2e@example.com,report-e2e@example.com
```

- [ ] **Step 3: `test/report-mcp.e2e-spec.ts`**

```ts
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
```

(Tháng 10: Ăn uống 1.500.000 + Cà phê 500.000 = 2.000.000; Mua sắm 1.000.000; chi 3.000.000, thu 25.000.000, tiết kiệm 0,88; tháng 9 chi 3.500.000, ròng 16.500.000; chuyển khoản không tính.)

- [ ] **Step 4: CHANGELOG** — trong `CHANGELOG.md`, thay `## [Unreleased]` bằng:

```markdown
## [Unreleased]

## [0.3.0] - 2026-10-20

Ngân sách, báo cáo thu chi và kịch bản tổng kết tháng.

### Added
- MCP tool `set_budget`, `get_budget_status`, `cashflow_summary`.
- MCP prompt `month_end_review` (đối soát → thu chi so với tháng trước → ngân sách → khoản chi lớn → nhận xét).
- Bảng `budget` (RLS): hạn mức tháng theo danh mục chi, áp dụng từ một tháng cho tới khi đặt lại; danh mục con tính vào danh mục cha.
- `get_overview` có thêm trường `budget` (tóm tắt ngân sách tháng chứa `as_of`, `null` nếu chưa đặt).

### Fixed
- `reconcile_account` khoá dòng ví khi đối soát: gọi song song không còn tạo nhiều dòng điều chỉnh.

### Migration
- `bun run db:migrate` (thêm `0005_budget`, `0006_budget_rls`).
- Client lấy lại danh sách tool: Claude — cuộc trò chuyện mới; ChatGPT — refresh/scan lại MCP server.
```

- [ ] **Step 5: Chạy toàn bộ, kể cả trên runtime Bun**

```bash
bun run test && bun run test:int && bun run test:e2e && bun run test:e2e:bun && bun run typecheck && bun run lint
```

Expected: tất cả PASS.

- [ ] **Step 6: Commit** — `test/mcp-client.ts`, `test/ledger-mcp.e2e-spec.ts`, `test/report-mcp.e2e-spec.ts`, `.env.test`, `CHANGELOG.md`:

```
test(e2e): cover budgets, cashflow and the month-end prompt over MCP
```

---

## Hoàn tất Plan 3

- Tất cả lệnh ở Task 9 Step 5 pass.
- Kiểm tra thủ công (cùng người dùng): `bun run db:migrate`; trong Claude/ChatGPT: "đặt ngân sách ăn uống 3tr/tháng", "tháng này ăn uống còn bao nhiêu?", "so sánh chi tiêu tháng này với tháng trước theo danh mục", và (Claude) chạy prompt `month_end_review`.
