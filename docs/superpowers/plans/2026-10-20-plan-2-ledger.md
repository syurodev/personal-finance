# Plan 2 — Ledger: ví, danh mục, giao dịch, đối soát + MCP tools: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agent (Claude/ChatGPT) quản lý được ví, danh mục và giao dịch thu/chi/chuyển khoản/đối soát qua 11 tool MCP mới, dữ liệu cách ly theo user bằng RLS.

**Architecture:** Domain thuần trong `src/ledger/*` (hàm, không DI) đọc transaction hiện tại từ `currentContext()`; mọi số tiền là `numeric` ở DB và `decimal.js` ở app; lỗi nghiệp vụ là `DomainError` có mã ổn định. Tầng MCP (`src/mcp/tools/*`) chỉ map tham số snake_case → domain, kiểm tra scope, chạy tool ghi trong savepoint, và trả `structuredContent` khớp `outputSchema`.

**Tech Stack:** Bun 1.4, NestJS 12, Drizzle 0.45 (node-postgres), PostgreSQL 18 (`uuidv7()`, `unaccent`), decimal.js 10.6, zod 4, @modelcontextprotocol/sdk 1.32.1, vitest 4.

**Spec:** `docs/superpowers/specs/2026-10-20-personal-finance-mcp-design.md` (§4, §6). **Plan 1** đã xong: auth/OAuth, RLS cho `audit_log`, `/mcp` + `whoami`.

**Ngoài plan này (Plan 3):** `set_budget`, `get_budget_status`, `cashflow_summary`, prompt `month_end_review`, tóm tắt ngân sách trong `get_overview`.

---

## Quy ước cho người thực thi

- **Chỉ dùng Bun:** `bun <file.ts>`, `bun run <script>`, `bun add`, `bunx --bun`. Không `node`, `npm`, `npx`, `tsx`. Nếu `bun` không có trên PATH: `/home/ptvu3/.bun/bin/bun`.
- **Git:** chỉ dùng DevKit tools (`mcp__devkit__git_stage`, `mcp__devkit__git_commit`, `mcp__devkit__git_branch_create`); commit message kết thúc bằng dòng `Co-Authored-By` theo hướng dẫn phiên. Không push.
- **Import nội bộ** có hậu tố `.js`.
- **Postgres** phải chạy (`bun run db:up`, cổng 5433). e2e dùng cổng 3101.
- **Ba bộ test:** `bun run test` (unit `*.spec.ts`), `bun run test:int` (`*.int-spec.ts`), `bun run test:e2e` (`*.e2e-spec.ts`). Plan này thêm `bun run test:e2e:bun` (e2e chạy trên runtime Bun — app thật chạy bằng Bun).
- **Không nới assertion** để test pass. Nếu code trong plan sai, sửa code tối thiểu và ghi lại lý do trong commit message + báo cáo.
- Bảng giao dịch tên `ledger_transaction` (tránh từ khoá SQL `transaction`).

## File structure

```
src/common/domain-error.ts         DomainError(code, message, details)
src/common/dates.ts                todayIn, parseIsoDate, assertDateRange
src/common/text.ts                 cleanText, requireName
src/money/currency.ts              currency hỗ trợ + số chữ số thập phân
src/money/money.ts                 parseAmount, parsePositiveDecimal, formatAmount
src/ledger/normalize.ts            normalizeName (bỏ dấu, đ→d, lowercase)
src/ledger/resolver.ts             resolveByName (id/tên → bản ghi, lỗi AMBIGUOUS/NOT_FOUND), isUuid
src/ledger/views.ts                kiểu dữ liệu trả về (snake_case = hợp đồng API)
src/ledger/user-settings.ts        timezone, base currency của user hiện tại
src/ledger/accounts.ts             ví: load/resolve/create/update/balances
src/ledger/categories.ts           danh mục: seed/load/resolve/create/update/tree
src/ledger/transactions.ts         ghi/chuyển/sửa/xoá/tìm/đối soát
src/ledger/overview.ts             get_overview
src/ledger/seed-categories-cli.ts  seed danh mục cho user đã tồn tại
src/audit/audit.ts                 recordAudit
src/db/schema/ledger.ts            ledger_account, category, ledger_transaction
src/mcp/tool-kit.ts                (sửa) runTool + savepoint + INTERNAL_ERROR
src/mcp/tools/schemas.ts           zod schema input/output dùng chung
src/mcp/tools/overview.tool.ts     get_overview
src/mcp/tools/account.tools.ts     create_account, update_account
src/mcp/tools/category.tools.ts    create_category, update_category
src/mcp/tools/transaction.tools.ts record_transactions, record_transfer, update_transaction,
                                   delete_transaction, search_transactions
src/mcp/tools/reconcile.tool.ts    reconcile_account
src/mcp/mcp-server.factory.ts      (sửa) đăng ký tool + instructions
test/fixtures.ts                   createTestUser, asUser
test/mcp-client.ts                 connectMcp, callOk, callError
test/ledger-mcp.e2e-spec.ts        kịch bản một tháng qua MCP client
```

---

### Task 1: Dependency, scripts, DomainError

**Files:**
- Modify: `package.json`, `src/mcp/tool-kit.ts`
- Create: `src/common/domain-error.ts`

- [ ] **Step 1: Cài decimal.js**

```bash
bun add decimal.js@10.6.0
```

- [ ] **Step 2: Thêm scripts vào `package.json`** (giữ nguyên các script cũ, thêm hai dòng này vào khối `"scripts"`):

```json
    "test:e2e:bun": "bun --bun vitest run --config ./vitest.config.e2e.ts",
    "db:seed-categories": "bun src/ledger/seed-categories-cli.ts",
```

- [ ] **Step 3: `src/common/domain-error.ts`**

```ts
/** Lỗi nghiệp vụ có mã ổn định. Tầng MCP chuyển nó thành kết quả isError cho agent. */
export class DomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}
```

- [ ] **Step 4: Cho `ToolError` dùng chung lớp `DomainError`**

Trong `src/mcp/tool-kit.ts`, xoá khối `export class ToolError extends Error { … }` và thay bằng:

```ts
import { DomainError } from '../common/domain-error.js';

/** Giữ tên ToolError cho code MCP hiện có; domain dùng DomainError. */
export { DomainError as ToolError };
```

Đổi điều kiện trong `toolError` từ `error instanceof ToolError` thành `error instanceof DomainError`.

- [ ] **Step 5: Chạy test**

Run: `bun run test && bun run typecheck`
Expected: PASS (11 tests), không lỗi type.

- [ ] **Step 6: Commit** — stage `package.json`, `bun.lock`, `src/common/domain-error.ts`, `src/mcp/tool-kit.ts`:

```
chore: add decimal.js and shared DomainError for ledger domain
```

---

### Task 2: Tiền tệ và số tiền

**Files:**
- Create: `src/money/currency.ts`, `src/money/money.ts`, `src/money/money.spec.ts`

- [ ] **Step 1: Test thất bại** — `src/money/money.spec.ts`:

```ts
import { parseCurrency } from './currency.js';
import { formatAmount, parseAmount, parsePositiveDecimal } from './money.js';

describe('parseCurrency', () => {
  it('normalises case', () => {
    expect(parseCurrency(' usd ')).toBe('USD');
  });

  it.each(['XYZ', 'toString', ''])('rejects %j', (code) => {
    expect(() => parseCurrency(code)).toThrow(expect.objectContaining({ code: 'UNSUPPORTED_CURRENCY' }));
  });
});

describe('parseAmount', () => {
  it('parses whole VND and decimal USD', () => {
    expect(parseAmount('85000', 'VND').toFixed()).toBe('85000');
    expect(parseAmount(' 12.34 ', 'USD').toFixed()).toBe('12.34');
  });

  it.each([
    ['85.5', 'VND'],
    ['12.345', 'USD'],
  ] as const)('rejects %s %s with too many decimals', (input, currency) => {
    expect(() => parseAmount(input, currency)).toThrow(expect.objectContaining({ code: 'INVALID_AMOUNT_SCALE' }));
  });

  it.each(['85,000', '85k', 'abc', '', '1e5', '-5', '0'])('rejects %j', (input) => {
    expect(() => parseAmount(input, 'VND')).toThrow(expect.objectContaining({ code: 'INVALID_AMOUNT' }));
  });

  it('accepts negative and zero only when allowed', () => {
    expect(parseAmount('-500', 'VND', { allowNegative: true }).toFixed()).toBe('-500');
    expect(parseAmount('0', 'VND', { allowZero: true }).toFixed()).toBe('0');
  });
});

describe('formatAmount', () => {
  it('pads to the currency scale', () => {
    expect(formatAmount('12.3', 'USD')).toBe('12.30');
    expect(formatAmount('-85000', 'VND')).toBe('-85000');
  });
});

describe('parsePositiveDecimal', () => {
  it('accepts a positive decimal and rejects junk', () => {
    expect(parsePositiveDecimal('100.5', 'min_amount').toFixed()).toBe('100.5');
    expect(() => parsePositiveDecimal('abc', 'min_amount')).toThrow(
      expect.objectContaining({ code: 'VALIDATION_ERROR' }),
    );
  });
});
```

Run: `bun run test src/money` → FAIL (module không tồn tại).

- [ ] **Step 2: `src/money/currency.ts`**

```ts
import { DomainError } from '../common/domain-error.js';

/** Số chữ số thập phân (ISO 4217) của các currency hỗ trợ trong MVP. */
export const CURRENCY_SCALE = { VND: 0, USD: 2, EUR: 2, JPY: 0, SGD: 2, THB: 2 } as const;

export type Currency = keyof typeof CURRENCY_SCALE;

export function parseCurrency(code: string): Currency {
  const upper = code.trim().toUpperCase();
  if (!Object.hasOwn(CURRENCY_SCALE, upper)) {
    throw new DomainError(
      'UNSUPPORTED_CURRENCY',
      `Chưa hỗ trợ tiền tệ "${code}". Hỗ trợ: ${Object.keys(CURRENCY_SCALE).join(', ')}.`,
    );
  }
  return upper as Currency;
}

export function currencyScale(currency: Currency): number {
  return CURRENCY_SCALE[currency];
}
```

- [ ] **Step 3: `src/money/money.ts`**

```ts
import { Decimal } from 'decimal.js';
import { DomainError } from '../common/domain-error.js';
import { type Currency, currencyScale } from './currency.js';

const DECIMAL_PATTERN = /^-?\d+(\.\d+)?$/;

export interface AmountOptions {
  allowNegative?: boolean;
  allowZero?: boolean;
}

/** Parse số tiền dạng chuỗi ("85000", "12.34"). Không nhận dấu phẩy, "k", ký hiệu tiền hay số mũ. */
export function parseAmount(input: string, currency: Currency, options: AmountOptions = {}): Decimal {
  const text = input.trim();
  if (!DECIMAL_PATTERN.test(text)) {
    throw new DomainError(
      'INVALID_AMOUNT',
      `Số tiền "${input}" không hợp lệ. Dùng chữ số và dấu chấm thập phân, ví dụ "85000" hoặc "12.34".`,
    );
  }
  const value = new Decimal(text);
  if (value.isZero()) {
    if (!options.allowZero) throw new DomainError('INVALID_AMOUNT', 'Số tiền phải khác 0.');
  } else if (value.isNegative() && !options.allowNegative) {
    throw new DomainError('INVALID_AMOUNT', 'Số tiền phải là số dương; chiều thu/chi do tham số type quyết định.');
  }
  const scale = currencyScale(currency);
  if (value.decimalPlaces() > scale) {
    throw new DomainError(
      'INVALID_AMOUNT_SCALE',
      `${currency} chỉ cho phép ${scale} chữ số thập phân (nhận "${input}").`,
      { currency, max_decimals: scale },
    );
  }
  return value;
}

/** Số dương không gắn currency (dùng cho bộ lọc min/max). */
export function parsePositiveDecimal(input: string, field: string): Decimal {
  const text = input.trim();
  if (!DECIMAL_PATTERN.test(text) || new Decimal(text).isNegative()) {
    throw new DomainError('VALIDATION_ERROR', `${field} phải là số không âm dạng "100000" hoặc "12.5".`);
  }
  return new Decimal(text);
}

export function formatAmount(value: Decimal.Value, currency: Currency): string {
  return new Decimal(value).toFixed(currencyScale(currency));
}
```

- [ ] **Step 4: Chạy test** — `bun run test src/money` → PASS.

- [ ] **Step 5: Commit** — `src/money/*`:

```
feat(money): add currency scales and decimal amount parsing
```

---

### Task 3: Chuẩn hoá tên và resolver

**Files:**
- Create: `src/ledger/normalize.ts`, `src/ledger/resolver.ts`, `src/ledger/resolver.spec.ts`

- [ ] **Step 1: Test thất bại** — `src/ledger/resolver.spec.ts`:

```ts
import { normalizeName } from './normalize.js';
import { isUuid, resolveByName } from './resolver.js';

const items = [
  { id: '01900000-0000-7000-8000-000000000001', name: 'Tiền mặt' },
  { id: '01900000-0000-7000-8000-000000000002', name: 'Momo' },
  { id: '01900000-0000-7000-8000-000000000003', name: 'Vietcombank' },
  { id: '01900000-0000-7000-8000-000000000004', name: 'Vietinbank' },
];

describe('normalizeName', () => {
  it('strips diacritics, maps đ and collapses whitespace', () => {
    expect(normalizeName('  Đi   Lại ')).toBe('di lai');
    expect(normalizeName('Hoá đơn & Tiện ích')).toBe('hoa don & tien ich');
  });
});

describe('resolveByName', () => {
  it('matches by id', () => {
    expect(resolveByName(items, items[1]!.id, 'ACCOUNT')).toBe(items[1]);
  });

  it('matches exact names without diacritics or case', () => {
    expect(resolveByName(items, 'tien mat', 'ACCOUNT')).toBe(items[0]);
    expect(resolveByName(items, 'MOMO', 'ACCOUNT')).toBe(items[1]);
  });

  it('matches a unique prefix, then a unique substring', () => {
    expect(resolveByName(items, 'vietc', 'ACCOUNT')).toBe(items[2]);
    expect(resolveByName(items, 'tinbank', 'ACCOUNT')).toBe(items[3]);
  });

  it('reports ambiguity with candidates', () => {
    expect(() => resolveByName(items, 'viet', 'ACCOUNT')).toThrow(
      expect.objectContaining({
        code: 'AMBIGUOUS_ACCOUNT',
        details: { candidates: [items[2], items[3]] },
      }),
    );
  });

  it('reports not found with up to 5 suggestions', () => {
    let error: any;
    try {
      resolveByName(items, 'acb', 'CATEGORY');
    } catch (e) {
      error = e;
    }
    expect(error.code).toBe('CATEGORY_NOT_FOUND');
    expect(error.details.suggestions.length).toBeLessThanOrEqual(5);
  });
});

describe('isUuid', () => {
  it('recognises uuids', () => {
    expect(isUuid(items[0]!.id)).toBe(true);
    expect(isUuid('momo')).toBe(false);
  });
});
```

Run: `bun run test src/ledger` → FAIL.

- [ ] **Step 2: `src/ledger/normalize.ts`**

```ts
/** Khoá so khớp tên: bỏ dấu tiếng Việt, đ→d, lowercase, gộp khoảng trắng. */
export function normalizeName(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}
```

- [ ] **Step 3: `src/ledger/resolver.ts`**

```ts
import { DomainError } from '../common/domain-error.js';
import { normalizeName } from './normalize.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value.trim());
}

export type Named = { id: string; name: string };
export type ResolvableEntity = 'ACCOUNT' | 'CATEGORY';

const LABEL: Record<ResolvableEntity, string> = { ACCOUNT: 'ví', CATEGORY: 'danh mục' };

/**
 * Tìm bản ghi theo id hoặc tên. Thứ tự: id → tên khớp hẳn → tiền tố duy nhất → chuỗi con duy nhất.
 * Nhiều kết quả → AMBIGUOUS_*; không có → *_NOT_FOUND kèm gợi ý.
 */
export function resolveByName<T extends Named>(items: readonly T[], ref: string, entity: ResolvableEntity): T {
  const trimmed = ref.trim();
  if (isUuid(trimmed)) {
    const byId = items.find((item) => item.id === trimmed);
    if (byId) return byId;
  }

  const needle = normalizeName(trimmed);
  const matchers: Array<(name: string) => boolean> = [
    (name) => name === needle,
    (name) => name.startsWith(needle),
    (name) => name.includes(needle),
  ];
  for (const matches of matchers) {
    const found = items.filter((item) => matches(normalizeName(item.name)));
    if (found.length === 1) return found[0]!;
    if (found.length > 1) {
      throw new DomainError(
        `AMBIGUOUS_${entity}`,
        `"${ref}" khớp nhiều ${LABEL[entity]}; hỏi người dùng chọn một rồi truyền id.`,
        { candidates: found.map(({ id, name }) => ({ id, name })) },
      );
    }
  }

  throw new DomainError(`${entity}_NOT_FOUND`, `Không tìm thấy ${LABEL[entity]} "${ref}".`, {
    suggestions: suggest(items, needle),
  });
}

function suggest(items: readonly Named[], needle: string): string[] {
  return [...items]
    .map((item) => ({ name: item.name, distance: levenshtein(normalizeName(item.name), needle) }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 5)
    .map((item) => item.name);
}

function levenshtein(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = row[j]!;
      row[j] = Math.min(above + 1, row[j - 1]! + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return row[b.length]!;
}
```

- [ ] **Step 4: Chạy test** — `bun run test src/ledger` → PASS.

- [ ] **Step 5: Commit** — `src/ledger/normalize.ts`, `src/ledger/resolver.ts`, `src/ledger/resolver.spec.ts`:

```
feat(ledger): resolve accounts and categories by id or accent-insensitive name
```

---

### Task 4: Ngày và text

**Files:**
- Create: `src/common/dates.ts`, `src/common/text.ts`, `src/common/common.spec.ts`

- [ ] **Step 1: Test thất bại** — `src/common/common.spec.ts`:

```ts
import { assertDateRange, parseIsoDate, todayIn } from './dates.js';
import { cleanText, requireName } from './text.js';

describe('todayIn', () => {
  const instant = new Date('2026-10-19T18:30:00Z');

  it('uses the given time zone', () => {
    expect(todayIn('Asia/Ho_Chi_Minh', instant)).toBe('2026-10-20');
    expect(todayIn('UTC', instant)).toBe('2026-10-19');
  });
});

describe('parseIsoDate', () => {
  it('accepts a real date', () => {
    expect(parseIsoDate('2026-02-28', 'occurred_on')).toBe('2026-02-28');
  });

  it.each(['2026-02-30', '2026-1-5', '20/10/2026', ''])('rejects %j', (input) => {
    expect(() => parseIsoDate(input, 'occurred_on')).toThrow(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
  });
});

describe('assertDateRange', () => {
  it('rejects from after to', () => {
    expect(() => assertDateRange('2026-10-02', '2026-10-01')).toThrow(
      expect.objectContaining({ code: 'INVALID_DATE_RANGE' }),
    );
    expect(() => assertDateRange('2026-10-01', undefined)).not.toThrow();
  });
});

describe('text helpers', () => {
  it('cleanText trims and maps blank to null', () => {
    expect(cleanText('  Phở  ', 'description')).toBe('Phở');
    expect(cleanText('   ', 'description')).toBeNull();
    expect(cleanText(undefined, 'description')).toBeNull();
    expect(() => cleanText('x'.repeat(501), 'description')).toThrow(
      expect.objectContaining({ code: 'VALIDATION_ERROR' }),
    );
  });

  it('requireName collapses whitespace and rejects blank', () => {
    expect(requireName('  Ví   Momo ')).toBe('Ví Momo');
    expect(() => requireName('  ')).toThrow(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
  });
});
```

Run: `bun run test src/common` → FAIL.

- [ ] **Step 2: `src/common/dates.ts`**

```ts
import { DomainError } from './domain-error.js';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Ngày hiện tại (YYYY-MM-DD) theo múi giờ IANA. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function parseIsoDate(input: string, field: string): string {
  const parsed = new Date(`${input}T00:00:00Z`);
  if (!ISO_DATE.test(input) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== input) {
    throw new DomainError('VALIDATION_ERROR', `${field} phải là ngày có thật dạng YYYY-MM-DD (nhận "${input}").`);
  }
  return input;
}

export function assertDateRange(from: string | undefined, to: string | undefined): void {
  if (from && to && from > to) {
    throw new DomainError('INVALID_DATE_RANGE', `Khoảng ngày không hợp lệ: from (${from}) sau to (${to}).`);
  }
}
```

- [ ] **Step 3: `src/common/text.ts`**

```ts
import { DomainError } from './domain-error.js';

/** Trim; chuỗi rỗng/undefined/null → null; giới hạn độ dài. */
export function cleanText(value: string | null | undefined, field: string, max = 500): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  if (trimmed.length > max) throw new DomainError('VALIDATION_ERROR', `${field} dài tối đa ${max} ký tự.`);
  return trimmed;
}

export function requireName(value: string, field = 'name', max = 100): string {
  const name = value.trim().replace(/\s+/g, ' ');
  if (name === '') throw new DomainError('VALIDATION_ERROR', `${field} không được để trống.`);
  if (name.length > max) throw new DomainError('VALIDATION_ERROR', `${field} dài tối đa ${max} ký tự.`);
  return name;
}
```

- [ ] **Step 4: Chạy** — `bun run test && bun run typecheck` → PASS.

- [ ] **Step 5: Commit** — `src/common/*`:

```
feat(common): add timezone-aware dates and text helpers
```

---

### Task 5: Schema ledger, RLS, unaccent

**Files:**
- Create: `src/db/schema/ledger.ts`
- Modify: `src/db/schema/index.ts`
- Generate: `drizzle/0003_ledger.sql`, `drizzle/0004_ledger_rls.sql` (custom)

- [ ] **Step 1: `src/db/schema/ledger.ts`**

```ts
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  check,
  date,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { user } from './auth.js';

export const ACCOUNT_TYPES = ['cash', 'bank', 'credit_card', 'ewallet'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const CATEGORY_KINDS = ['expense', 'income'] as const;
export type CategoryKind = (typeof CATEGORY_KINDS)[number];

export const TRANSACTION_KINDS = ['standard', 'transfer', 'adjustment'] as const;
export type TransactionKind = (typeof TRANSACTION_KINDS)[number];

const timestamps = () => ({
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

const ownerId = () =>
  text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' });

export const ledgerAccount = pgTable(
  'ledger_account',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    userId: ownerId(),
    type: text('type', { enum: ACCOUNT_TYPES }).notNull(),
    name: text('name').notNull(),
    currency: text('currency').notNull(),
    openingBalance: numeric('opening_balance').notNull().default('0'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    check('ledger_account_type_check', sql`${t.type} in ('cash', 'bank', 'credit_card', 'ewallet')`),
    uniqueIndex('ledger_account_user_name_uidx')
      .on(t.userId, sql`lower(${t.name})`)
      .where(sql`${t.archivedAt} is null`),
  ],
);

export const category = pgTable(
  'category',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    userId: ownerId(),
    parentId: uuid('parent_id').references((): AnyPgColumn => category.id, { onDelete: 'restrict' }),
    kind: text('kind', { enum: CATEGORY_KINDS }).notNull(),
    name: text('name').notNull(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    check('category_kind_check', sql`${t.kind} in ('expense', 'income')`),
    uniqueIndex('category_user_kind_parent_name_uidx')
      .on(
        t.userId,
        t.kind,
        sql`coalesce(${t.parentId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
        sql`lower(${t.name})`,
      )
      .where(sql`${t.archivedAt} is null`),
  ],
);

export const ledgerTransaction = pgTable(
  'ledger_transaction',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    userId: ownerId(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => ledgerAccount.id, { onDelete: 'restrict' }),
    kind: text('kind', { enum: TRANSACTION_KINDS }).notNull(),
    categoryId: uuid('category_id').references(() => category.id, { onDelete: 'restrict' }),
    /** Có dấu: âm = tiền ra khỏi ví. */
    amount: numeric('amount').notNull(),
    currency: text('currency').notNull(),
    occurredOn: date('occurred_on', { mode: 'string' }).notNull(),
    transferGroupId: uuid('transfer_group_id'),
    description: text('description'),
    merchant: text('merchant'),
    note: text('note'),
    sourceClientId: text('source_client_id'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    check('ledger_transaction_kind_check', sql`${t.kind} in ('standard', 'transfer', 'adjustment')`),
    check('ledger_transaction_amount_nonzero', sql`${t.amount} <> 0`),
    check('ledger_transaction_category_only_standard', sql`${t.categoryId} is null or ${t.kind} = 'standard'`),
    check('ledger_transaction_transfer_group', sql`(${t.kind} = 'transfer') = (${t.transferGroupId} is not null)`),
    index('ledger_transaction_user_date_idx').on(t.userId, t.occurredOn),
    index('ledger_transaction_account_date_idx').on(t.userId, t.accountId, t.occurredOn),
    index('ledger_transaction_category_date_idx').on(t.userId, t.categoryId, t.occurredOn),
    index('ledger_transaction_transfer_group_idx').on(t.transferGroupId),
  ],
);
```

`src/db/schema/index.ts`:

```ts
export * from './auth.js';
export * from './audit.js';
export * from './ledger.js';
```

- [ ] **Step 2: Sinh migration bảng**

```bash
bun run db:generate --name=ledger
```

Expected: `drizzle/0003_ledger.sql` có `CREATE TABLE "ledger_account"`, `"category"`, `"ledger_transaction"`, các `CHECK`, index và FK.

- [ ] **Step 3: Migration custom RLS + unaccent**

```bash
bun run db:generate --custom --name=ledger_rls
```

Ghi vào `drizzle/0004_ledger_rls.sql`:

```sql
CREATE EXTENSION IF NOT EXISTS unaccent;
--> statement-breakpoint
ALTER TABLE "ledger_account" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "ledger_account" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "ledger_account_owner" ON "ledger_account" TO pf_app
  USING ("user_id" = current_setting('app.user_id', true))
  WITH CHECK ("user_id" = current_setting('app.user_id', true));
--> statement-breakpoint
ALTER TABLE "category" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "category" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "category_owner" ON "category" TO pf_app
  USING ("user_id" = current_setting('app.user_id', true))
  WITH CHECK ("user_id" = current_setting('app.user_id', true));
--> statement-breakpoint
ALTER TABLE "ledger_transaction" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "ledger_transaction" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "ledger_transaction_owner" ON "ledger_transaction" TO pf_app
  USING ("user_id" = current_setting('app.user_id', true))
  WITH CHECK ("user_id" = current_setting('app.user_id', true));
```

- [ ] **Step 4: Áp dụng lên DB dev và kiểm tra**

```bash
bun run db:migrate
docker compose exec -T db psql -U postgres -d personal_finance -c '\dp ledger_transaction' -c '\dx unaccent'
```

Expected: `Migrations applied`; policy `ledger_transaction_owner`; extension `unaccent` có mặt.

- [ ] **Step 5: Chạy** — `bun run test:int && bun run typecheck` → PASS (7 tests cũ; global setup tự reset + migrate DB test).

- [ ] **Step 6: Commit** — `src/db/schema/ledger.ts`, `src/db/schema/index.ts`, `drizzle/`:

```
feat(db): add ledger tables with row level security
```

---

### Task 6: User settings, audit, seed danh mục, test fixtures

**Files:**
- Create: `src/ledger/views.ts`, `src/ledger/user-settings.ts`, `src/audit/audit.ts`, `src/ledger/categories.ts` (phần seed), `src/ledger/seed-categories-cli.ts`, `test/fixtures.ts`
- Modify: `src/auth/auth.ts`, `src/auth/sign-up.int-spec.ts`

- [ ] **Step 1: `src/ledger/views.ts`** (hợp đồng dữ liệu trả về cho agent, snake_case)

```ts
import type { AccountType, CategoryKind, TransactionKind } from '../db/schema/index.js';

export type EntryType = CategoryKind;
export type TransactionType = 'expense' | 'income' | 'transfer_out' | 'transfer_in' | 'adjustment';

export type AccountView = {
  id: string;
  name: string;
  type: AccountType;
  currency: string;
  balance: string;
  archived: boolean;
};

export type AccountBalanceView = { account_id: string; name: string; currency: string; balance: string };

export type CategoryView = {
  id: string;
  name: string;
  kind: CategoryKind;
  parent_id: string | null;
  archived: boolean;
};

export type CategoryNode = {
  id: string;
  name: string;
  kind: CategoryKind;
  children: Array<{ id: string; name: string }>;
};

export type TransactionView = {
  id: string;
  kind: TransactionKind;
  type: TransactionType;
  amount: string;
  signed_amount: string;
  currency: string;
  account: { id: string; name: string };
  category: { id: string; name: string } | null;
  occurred_on: string;
  description: string | null;
  merchant: string | null;
  note: string | null;
  transfer_group_id: string | null;
  deleted: boolean;
};
```

- [ ] **Step 2: `src/ledger/user-settings.ts`**

```ts
import { eq } from 'drizzle-orm';
import { currentContext } from '../db/request-context.js';
import { user } from '../db/schema/index.js';
import { type Currency, parseCurrency } from '../money/currency.js';

export type UserSettings = { timezone: string; baseCurrency: Currency };

export async function getUserSettings(): Promise<UserSettings> {
  const { tx, userId } = currentContext();
  const [row] = await tx
    .select({ timezone: user.timezone, baseCurrency: user.baseCurrency })
    .from(user)
    .where(eq(user.id, userId));
  if (!row) throw new Error(`User ${userId} not found`);
  return {
    timezone: row.timezone ?? 'Asia/Ho_Chi_Minh',
    baseCurrency: parseCurrency(row.baseCurrency ?? 'VND'),
  };
}
```

- [ ] **Step 3: `src/audit/audit.ts`**

```ts
import { currentContext } from '../db/request-context.js';
import { auditLog } from '../db/schema/index.js';

/** Ghi một dòng audit cho mỗi entity bị thay đổi, trong transaction hiện tại. Không lưu payload. */
export async function recordAudit(action: string, entity: string, entityIds: readonly string[]): Promise<void> {
  if (entityIds.length === 0) return;
  const { tx, userId, clientId } = currentContext();
  await tx
    .insert(auditLog)
    .values(entityIds.map((entityId) => ({ userId, actorClientId: clientId, action, entity, entityId })));
}
```

- [ ] **Step 4: `src/ledger/categories.ts` — phần seed (Task 7 bổ sung phần còn lại vào cùng file)**

```ts
import { count } from 'drizzle-orm';
import { currentContext } from '../db/request-context.js';
import { category, type CategoryKind } from '../db/schema/index.js';

export const DEFAULT_CATEGORIES: Record<CategoryKind, readonly string[]> = {
  expense: [
    'Ăn uống',
    'Đi lại',
    'Nhà ở',
    'Hoá đơn & tiện ích',
    'Mua sắm',
    'Giải trí',
    'Sức khoẻ',
    'Giáo dục',
    'Gia đình',
    'Quà tặng & từ thiện',
    'Khác',
  ],
  income: ['Lương', 'Thưởng', 'Lãi & đầu tư', 'Thu khác'],
};

/** Tạo danh mục mặc định nếu user chưa có danh mục nào. Trả về số danh mục đã tạo. */
export async function seedDefaultCategories(): Promise<number> {
  const { tx, userId } = currentContext();
  const [existing] = await tx.select({ value: count() }).from(category);
  if ((existing?.value ?? 0) > 0) return 0;
  const rows = (Object.entries(DEFAULT_CATEGORIES) as Array<[CategoryKind, readonly string[]]>).flatMap(
    ([kind, names]) => names.map((name) => ({ userId, kind, name })),
  );
  await tx.insert(category).values(rows);
  return rows.length;
}
```

- [ ] **Step 5: Seed khi tạo user** — trong `src/auth/auth.ts` thêm import:

```ts
import { runAsUser } from '../db/run-as-user.js';
import { seedDefaultCategories } from '../ledger/categories.js';
```

và thêm vào object truyền cho `betterAuth({ … })` (cạnh `hooks`):

```ts
  databaseHooks: {
    user: {
      create: {
        // Chạy sau khi transaction tạo user commit; seed trong ngữ cảnh RLS của chính user đó.
        after: async (createdUser) => {
          await runAsUser(db, { userId: createdUser.id, clientId: null, scopes: [] }, () => seedDefaultCategories());
        },
      },
    },
  },
```

- [ ] **Step 6: CLI cho user đã tồn tại** — `src/ledger/seed-categories-cli.ts`:

```ts
import { db, pool } from '../db/index.js';
import { runAsUser } from '../db/run-as-user.js';
import { user } from '../db/schema/index.js';
import { seedDefaultCategories } from './categories.js';

const users = await db.select({ id: user.id, email: user.email }).from(user);
for (const { id, email } of users) {
  const created = await runAsUser(db, { userId: id, clientId: null, scopes: [] }, () => seedDefaultCategories());
  console.log(`${email}: ${created} categories created`);
}
await pool.end();
```

- [ ] **Step 7: `test/fixtures.ts`**

```ts
import { randomUUID } from 'node:crypto';
import { FINANCE_READ, FINANCE_WRITE } from '../src/auth/constants.js';
import { db } from '../src/db/index.js';
import { runAsUser } from '../src/db/run-as-user.js';
import { user } from '../src/db/schema/index.js';
import { seedDefaultCategories } from '../src/ledger/categories.js';

/** Chạy fn như một request MCP của user (có cả quyền đọc và ghi). */
export function asUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  return runAsUser(db, { userId, clientId: 'test-client', scopes: [FINANCE_READ, FINANCE_WRITE] }, fn);
}

/** Tạo user trực tiếp trong DB (bỏ qua better-auth), mặc định seed danh mục. */
export async function createTestUser(options: { seed?: boolean } = {}): Promise<string> {
  const id = randomUUID();
  await db.insert(user).values({
    id,
    name: 'Test',
    email: `${id}@example.com`,
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  if (options.seed !== false) await asUser(id, () => seedDefaultCategories());
  return id;
}
```

- [ ] **Step 8: Kiểm tra seed khi đăng ký** — trong `src/auth/sign-up.int-spec.ts`, thêm import:

```ts
import { count } from 'drizzle-orm';
import { category } from '../db/schema/index.js';
import { asUser } from '../../test/fixtures.js';
```

và cuối test `'creates an allowlisted user with default currency and timezone'` thêm:

```ts
    const [categories] = await asUser(row!.id, () =>
      currentContext().tx.select({ value: count() }).from(category),
    );
    expect(categories?.value).toBe(15);
```

(thêm `import { currentContext } from '../db/request-context.js';`).

- [ ] **Step 9: Chạy** — `bun run test:int && bun run typecheck && bun run lint` → PASS.

Nếu test đếm được 0 danh mục vì hook `after` của better-auth chưa chạy xong khi `signUpEmail` trả về: không thêm `sleep`; báo lại trong task để quyết định (ví dụ seed lười trong `get_overview`).

- [ ] **Step 10: Seed cho user đã có trên DB dev**

```bash
bun run db:seed-categories
```

Expected: mỗi user một dòng `…: 15 categories created` (lần chạy lại in `0`).

- [ ] **Step 11: Commit** — các file trên:

```
feat(ledger): seed default categories per user and add audit helper
```

---

### Task 7: Ví và danh mục (domain + integration tests)

**Files:**
- Create: `src/ledger/accounts.ts`, `src/ledger/accounts.int-spec.ts`, `src/ledger/categories.int-spec.ts`
- Modify: `src/ledger/categories.ts`

- [ ] **Step 1: Integration test thất bại cho ví** — `src/ledger/accounts.int-spec.ts`:

```ts
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
```

- [ ] **Step 2: `src/ledger/accounts.ts`**

```ts
import { Decimal } from 'decimal.js';
import { asc, eq, sql } from 'drizzle-orm';
import { recordAudit } from '../audit/audit.js';
import { DomainError } from '../common/domain-error.js';
import { requireName } from '../common/text.js';
import { currentContext } from '../db/request-context.js';
import { type AccountType, ledgerAccount } from '../db/schema/index.js';
import { parseCurrency } from '../money/currency.js';
import { formatAmount, parseAmount } from '../money/money.js';
import { normalizeName } from './normalize.js';
import { resolveByName } from './resolver.js';
import { getUserSettings } from './user-settings.js';
import type { AccountView } from './views.js';

export type AccountRow = typeof ledgerAccount.$inferSelect;

export async function loadAccounts(options: { includeArchived?: boolean } = {}): Promise<AccountRow[]> {
  const { tx } = currentContext();
  // created_at = now() của transaction nên trùng nhau trong một lô; uuidv7 giữ thứ tự tạo.
  const rows = await tx.select().from(ledgerAccount).orderBy(asc(ledgerAccount.createdAt), asc(ledgerAccount.id));
  return options.includeArchived ? rows : rows.filter((row) => row.archivedAt === null);
}

/** Tìm ví đang dùng theo id/tên; ví đã lưu trữ → ACCOUNT_ARCHIVED (hoặc trả về nếu allowArchived). */
export async function resolveAccount(ref: string, options: { allowArchived?: boolean } = {}): Promise<AccountRow> {
  const all = await loadAccounts({ includeArchived: true });
  const active = all.filter((row) => row.archivedAt === null);
  try {
    return resolveByName(active, ref, 'ACCOUNT');
  } catch (error) {
    const archived = all.filter((row) => row.archivedAt !== null);
    if (!(error instanceof DomainError) || error.code !== 'ACCOUNT_NOT_FOUND' || archived.length === 0) throw error;
    let match: AccountRow;
    try {
      match = resolveByName(archived, ref, 'ACCOUNT');
    } catch {
      throw error;
    }
    if (options.allowArchived) return match;
    throw new DomainError(
      'ACCOUNT_ARCHIVED',
      `Ví "${match.name}" đã được lưu trữ. Mở lại bằng update_account với archived=false nếu muốn dùng.`,
    );
  }
}

export async function accountById(id: string): Promise<AccountRow> {
  const row = (await loadAccounts({ includeArchived: true })).find((account) => account.id === id);
  if (!row) throw new Error(`Account ${id} not visible to current user`);
  return row;
}

/** Số dư mỗi ví = opening_balance + tổng giao dịch chưa xoá (đến hết ngày asOf nếu có). */
export async function accountBalances(asOf?: string): Promise<Map<string, string>> {
  const { tx } = currentContext();
  const dateFilter = asOf ? sql`and t.occurred_on <= ${asOf}` : sql``;
  const result = await tx.execute<{ id: string; balance: string }>(sql`
    select a.id, (a.opening_balance + coalesce(sum(t.amount), 0))::text as balance
    from ledger_account a
    left join ledger_transaction t
      on t.account_id = a.id and t.deleted_at is null ${dateFilter}
    group by a.id, a.opening_balance`);
  return new Map(result.rows.map((row) => [row.id, row.balance]));
}

export function toAccountView(row: AccountRow, balance: string): AccountView {
  const currency = parseCurrency(row.currency);
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    currency,
    balance: formatAmount(balance, currency),
    archived: row.archivedAt !== null,
  };
}

async function assertNameFree(name: string, exceptId?: string): Promise<void> {
  const key = normalizeName(name);
  const clash = (await loadAccounts()).find((row) => row.id !== exceptId && normalizeName(row.name) === key);
  if (clash) throw new DomainError('DUPLICATE_NAME', `Đã có ví tên "${clash.name}".`, { id: clash.id });
}

export async function createAccount(input: {
  type: AccountType;
  name: string;
  currency?: string;
  openingBalance?: string;
}): Promise<AccountView> {
  const { tx, userId } = currentContext();
  const name = requireName(input.name);
  const currency = input.currency ? parseCurrency(input.currency) : (await getUserSettings()).baseCurrency;
  const opening =
    input.openingBalance === undefined
      ? new Decimal(0)
      : parseAmount(input.openingBalance, currency, { allowNegative: true, allowZero: true });
  await assertNameFree(name);
  const [row] = await tx
    .insert(ledgerAccount)
    .values({ userId, type: input.type, name, currency, openingBalance: opening.toFixed() })
    .returning();
  await recordAudit('account.create', 'ledger_account', [row!.id]);
  return toAccountView(row!, row!.openingBalance);
}

export async function updateAccount(ref: string, patch: { name?: string; archived?: boolean }): Promise<AccountView> {
  const { tx } = currentContext();
  const current = await resolveAccount(ref, { allowArchived: true });
  const name = patch.name !== undefined ? requireName(patch.name) : current.name;
  const willBeActive = patch.archived === undefined ? current.archivedAt === null : !patch.archived;
  if (willBeActive) await assertNameFree(name, current.id);
  const [row] = await tx
    .update(ledgerAccount)
    .set({
      name,
      ...(patch.archived !== undefined ? { archivedAt: patch.archived ? new Date() : null } : {}),
    })
    .where(eq(ledgerAccount.id, current.id))
    .returning();
  await recordAudit('account.update', 'ledger_account', [row!.id]);
  const balances = await accountBalances();
  return toAccountView(row!, balances.get(row!.id) ?? row!.openingBalance);
}
```

- [ ] **Step 3: Integration test thất bại cho danh mục** — `src/ledger/categories.int-spec.ts`:

```ts
import { pool } from '../db/index.js';
import { asUser, createTestUser } from '../../test/fixtures.js';
import {
  categoryTree,
  createCategory,
  descendantIds,
  resolveCategory,
  seedDefaultCategories,
  updateCategory,
} from './categories.js';

describe('categories', () => {
  let alice: string;

  beforeAll(async () => {
    alice = await createTestUser();
  });

  afterAll(async () => {
    await pool.end();
  });

  it('seeds 15 defaults once', async () => {
    const tree = await asUser(alice, () => categoryTree());
    expect(tree).toHaveLength(15);
    expect(await asUser(alice, () => seedDefaultCategories())).toBe(0);
  });

  it('resolves by accent-insensitive name within a kind', async () => {
    const row = await asUser(alice, () => resolveCategory('an uong', 'expense'));
    expect(row.name).toBe('Ăn uống');
  });

  it('reports a kind mismatch instead of not found', async () => {
    await expect(asUser(alice, () => resolveCategory('Lương', 'expense'))).rejects.toMatchObject({
      code: 'CATEGORY_KIND_MISMATCH',
    });
  });

  it('creates a child category and includes it in descendants', async () => {
    const child = await asUser(alice, () => createCategory({ name: 'Cà phê', kind: 'expense', parent: 'Ăn uống' }));
    const parent = await asUser(alice, () => resolveCategory('Ăn uống', 'expense'));
    expect(child.parent_id).toBe(parent.id);
    const ids = await asUser(alice, () => descendantIds(parent.id));
    expect(ids).toEqual(expect.arrayContaining([parent.id, child.id]));
  });

  it('allows only two levels', async () => {
    await expect(
      asUser(alice, () => createCategory({ name: 'Espresso', kind: 'expense', parent: 'Cà phê' })),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('rejects a duplicate sibling name', async () => {
    await expect(asUser(alice, () => createCategory({ name: 'an uong', kind: 'expense' }))).rejects.toMatchObject({
      code: 'DUPLICATE_NAME',
    });
  });

  it('renames, moves to top level and archives', async () => {
    const moved = await asUser(alice, () => updateCategory('Cà phê', { name: 'Cafe', parent: null }));
    expect(moved).toMatchObject({ name: 'Cafe', parent_id: null });
    const archived = await asUser(alice, () => updateCategory('Cafe', { archived: true }));
    expect(archived.archived).toBe(true);
    await expect(asUser(alice, () => resolveCategory('Cafe'))).rejects.toMatchObject({ code: 'CATEGORY_NOT_FOUND' });
  });
});
```

- [ ] **Step 4: Bổ sung `src/ledger/categories.ts`** — thay toàn bộ file bằng (giữ nguyên `DEFAULT_CATEGORIES` và `seedDefaultCategories` từ Task 6):

```ts
import { asc, count, eq } from 'drizzle-orm';
import { recordAudit } from '../audit/audit.js';
import { DomainError } from '../common/domain-error.js';
import { requireName } from '../common/text.js';
import { currentContext } from '../db/request-context.js';
import { category, type CategoryKind } from '../db/schema/index.js';
import { normalizeName } from './normalize.js';
import { resolveByName } from './resolver.js';
import type { CategoryNode, CategoryView } from './views.js';

export type CategoryRow = typeof category.$inferSelect;

export const DEFAULT_CATEGORIES: Record<CategoryKind, readonly string[]> = {
  expense: [
    'Ăn uống',
    'Đi lại',
    'Nhà ở',
    'Hoá đơn & tiện ích',
    'Mua sắm',
    'Giải trí',
    'Sức khoẻ',
    'Giáo dục',
    'Gia đình',
    'Quà tặng & từ thiện',
    'Khác',
  ],
  income: ['Lương', 'Thưởng', 'Lãi & đầu tư', 'Thu khác'],
};

const KIND_LABEL: Record<CategoryKind, string> = { expense: 'chi', income: 'thu' };

/** Tạo danh mục mặc định nếu user chưa có danh mục nào. Trả về số danh mục đã tạo. */
export async function seedDefaultCategories(): Promise<number> {
  const { tx, userId } = currentContext();
  const [existing] = await tx.select({ value: count() }).from(category);
  if ((existing?.value ?? 0) > 0) return 0;
  const rows = (Object.entries(DEFAULT_CATEGORIES) as Array<[CategoryKind, readonly string[]]>).flatMap(
    ([kind, names]) => names.map((name) => ({ userId, kind, name })),
  );
  await tx.insert(category).values(rows);
  return rows.length;
}

export async function loadCategories(options: { includeArchived?: boolean } = {}): Promise<CategoryRow[]> {
  const { tx } = currentContext();
  const rows = await tx.select().from(category).orderBy(asc(category.createdAt), asc(category.id));
  return options.includeArchived ? rows : rows.filter((row) => row.archivedAt === null);
}

/** Tìm danh mục đang dùng; nếu biết kind mà tên thuộc kind kia → CATEGORY_KIND_MISMATCH. */
export async function resolveCategory(ref: string, kind?: CategoryKind): Promise<CategoryRow> {
  const all = await loadCategories();
  try {
    return resolveByName(
      all.filter((row) => !kind || row.kind === kind),
      ref,
      'CATEGORY',
    );
  } catch (error) {
    if (!kind || !(error instanceof DomainError) || error.code !== 'CATEGORY_NOT_FOUND') throw error;
    let other: CategoryRow;
    try {
      other = resolveByName(
        all.filter((row) => row.kind !== kind),
        ref,
        'CATEGORY',
      );
    } catch {
      throw error;
    }
    throw new DomainError(
      'CATEGORY_KIND_MISMATCH',
      `Danh mục "${other.name}" là danh mục ${KIND_LABEL[other.kind]}, không dùng cho khoản ${KIND_LABEL[kind]}.`,
    );
  }
}

export function toCategoryView(row: CategoryRow): CategoryView {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    parent_id: row.parentId,
    archived: row.archivedAt !== null,
  };
}

/** Danh mục cấp 1 (đang dùng) kèm danh mục con. */
export async function categoryTree(): Promise<CategoryNode[]> {
  const rows = await loadCategories();
  return rows
    .filter((row) => row.parentId === null)
    .map((parent) => ({
      id: parent.id,
      name: parent.name,
      kind: parent.kind,
      children: rows.filter((row) => row.parentId === parent.id).map(({ id, name }) => ({ id, name })),
    }));
}

/** Id của danh mục và các danh mục con (kể cả đã lưu trữ — giao dịch cũ vẫn thuộc về chúng). */
export async function descendantIds(categoryId: string): Promise<string[]> {
  const rows = await loadCategories({ includeArchived: true });
  return [categoryId, ...rows.filter((row) => row.parentId === categoryId).map((row) => row.id)];
}

async function resolveParent(ref: string, kind: CategoryKind, selfId?: string): Promise<CategoryRow> {
  const parent = await resolveCategory(ref, kind);
  if (parent.id === selfId) throw new DomainError('VALIDATION_ERROR', 'Danh mục không thể là cha của chính nó.');
  if (parent.parentId !== null) {
    throw new DomainError('VALIDATION_ERROR', 'Chỉ hỗ trợ 2 cấp danh mục: danh mục cha phải là danh mục cấp 1.');
  }
  return parent;
}

async function assertNameFree(name: string, kind: CategoryKind, parentId: string | null, exceptId?: string) {
  const key = normalizeName(name);
  const clash = (await loadCategories()).find(
    (row) => row.id !== exceptId && row.kind === kind && row.parentId === parentId && normalizeName(row.name) === key,
  );
  if (clash) throw new DomainError('DUPLICATE_NAME', `Đã có danh mục "${clash.name}" cùng cấp.`, { id: clash.id });
}

export async function createCategory(input: { name: string; kind: CategoryKind; parent?: string }): Promise<CategoryView> {
  const { tx, userId } = currentContext();
  const name = requireName(input.name);
  const parent = input.parent ? await resolveParent(input.parent, input.kind) : null;
  await assertNameFree(name, input.kind, parent?.id ?? null);
  const [row] = await tx
    .insert(category)
    .values({ userId, kind: input.kind, name, parentId: parent?.id ?? null })
    .returning();
  await recordAudit('category.create', 'category', [row!.id]);
  return toCategoryView(row!);
}

export async function updateCategory(
  ref: string,
  patch: { name?: string; parent?: string | null; archived?: boolean },
): Promise<CategoryView> {
  const { tx } = currentContext();
  const all = await loadCategories({ includeArchived: true });
  const current = resolveByName(all, ref, 'CATEGORY');
  const name = patch.name !== undefined ? requireName(patch.name) : current.name;

  let parentId = current.parentId;
  if (patch.parent === null) {
    parentId = null;
  } else if (patch.parent !== undefined) {
    if (all.some((row) => row.parentId === current.id)) {
      throw new DomainError('VALIDATION_ERROR', `"${current.name}" đang có danh mục con nên không thể làm danh mục con.`);
    }
    parentId = (await resolveParent(patch.parent, current.kind, current.id)).id;
  }

  const willBeActive = patch.archived === undefined ? current.archivedAt === null : !patch.archived;
  if (willBeActive) await assertNameFree(name, current.kind, parentId, current.id);

  const [row] = await tx
    .update(category)
    .set({
      name,
      parentId,
      ...(patch.archived !== undefined ? { archivedAt: patch.archived ? new Date() : null } : {}),
    })
    .where(eq(category.id, current.id))
    .returning();
  await recordAudit('category.update', 'category', [row!.id]);
  return toCategoryView(row!);
}
```

- [ ] **Step 5: Chạy** — `bun run test:int` → PASS (thêm 7 test ví + 7 test danh mục). `bun run typecheck && bun run lint` sạch.

- [ ] **Step 6: Commit** — `src/ledger/accounts.ts`, `src/ledger/categories.ts`, hai file int-spec:

```
feat(ledger): manage accounts and two-level categories
```

---

### Task 8: Giao dịch — ghi, chuyển khoản, sửa, xoá

**Files:**
- Create: `src/ledger/transactions.ts`, `src/ledger/transactions.int-spec.ts`

- [ ] **Step 1: Integration test thất bại** — `src/ledger/transactions.int-spec.ts`:

```ts
import { pool } from '../db/index.js';
import { asUser, createTestUser } from '../../test/fixtures.js';
import { createAccount } from './accounts.js';
import {
  deleteTransaction,
  reconcileAccount,
  recordTransactions,
  recordTransfer,
  searchTransactions,
  updateTransaction,
} from './transactions.js';

describe('transactions', () => {
  let alice: string;

  beforeAll(async () => {
    alice = await createTestUser();
    await asUser(alice, async () => {
      await createAccount({ type: 'bank', name: 'Vietcombank', openingBalance: '1000000' });
      await createAccount({ type: 'cash', name: 'Tiền mặt' });
      await createAccount({ type: 'ewallet', name: 'Momo' });
      await createAccount({ type: 'bank', name: 'Wise USD', currency: 'USD' });
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  const balanceOf = (balances: Array<{ name: string; balance: string }>, name: string) =>
    balances.find((b) => b.name === name)?.balance;

  it('records a batch of income and expenses and returns balances', async () => {
    const result = await asUser(alice, () =>
      recordTransactions([
        { amount: '25000000', type: 'income', account: 'vietcombank', category: 'luong', occurredOn: '2026-10-01' },
        { amount: '50000', type: 'expense', account: 'tien mat', category: 'an uong', occurredOn: '2026-10-02', description: 'Phở bò' },
        { amount: '85000', type: 'expense', account: 'momo', category: 'Ăn uống', occurredOn: '2026-10-02', merchant: 'Highlands' },
      ]),
    );
    expect(result.created).toHaveLength(3);
    expect(result.created[1]).toMatchObject({ type: 'expense', amount: '50000', signed_amount: '-50000', currency: 'VND' });
    expect(balanceOf(result.balances, 'Vietcombank')).toBe('26000000');
    expect(balanceOf(result.balances, 'Momo')).toBe('-85000');
  });

  it('writes nothing when one item in the batch is invalid', async () => {
    await expect(
      asUser(alice, () =>
        recordTransactions([
          { amount: '10000', type: 'expense', account: 'tien mat' },
          { amount: '1.5', type: 'expense', account: 'tien mat' },
        ]),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_AMOUNT_SCALE', details: expect.objectContaining({ index: 1 }) });
    const found = await asUser(alice, () => searchTransactions({ account: 'tien mat' }));
    expect(found.total_count).toBe(1);
  });

  it('rejects a category of the wrong kind', async () => {
    await expect(
      asUser(alice, () => recordTransactions([{ amount: '1000', type: 'expense', account: 'momo', category: 'Lương' }])),
    ).rejects.toMatchObject({ code: 'CATEGORY_KIND_MISMATCH' });
  });

  it('records a transfer as two linked rows', async () => {
    const result = await asUser(alice, () =>
      recordTransfer({ fromAccount: 'vietcombank', toAccount: 'tien mat', amount: '2000000', occurredOn: '2026-10-03' }),
    );
    expect(result.from).toMatchObject({ type: 'transfer_out', amount: '2000000' });
    expect(result.to).toMatchObject({ type: 'transfer_in', transfer_group_id: result.transfer_group_id });
    expect(balanceOf(result.balances, 'Vietcombank')).toBe('24000000');
    expect(balanceOf(result.balances, 'Tiền mặt')).toBe('1950000');
  });

  it('rejects transfers to the same account or across currencies', async () => {
    await expect(
      asUser(alice, () => recordTransfer({ fromAccount: 'momo', toAccount: 'momo', amount: '1000' })),
    ).rejects.toMatchObject({ code: 'SAME_ACCOUNT_TRANSFER' });
    await expect(
      asUser(alice, () => recordTransfer({ fromAccount: 'vietcombank', toAccount: 'wise usd', amount: '1000' })),
    ).rejects.toMatchObject({ code: 'CURRENCY_MISMATCH' });
  });

  it('records a transfer fee as a separate expense', async () => {
    const result = await asUser(alice, () =>
      recordTransfer({ fromAccount: 'vietcombank', toAccount: 'momo', amount: '500000', fee: '3300', occurredOn: '2026-10-04' }),
    );
    expect(result.fee).toMatchObject({ kind: 'standard', type: 'expense', amount: '3300' });
    expect(balanceOf(result.balances, 'Vietcombank')).toBe('23496700');
  });

  it('updates a standard transaction amount', async () => {
    const pho = (await asUser(alice, () => searchTransactions({ text: 'pho' }))).items[0]!;
    const result = await asUser(alice, () => updateTransaction(pho.id, { amount: '45000' }));
    expect(result.transactions[0]).toMatchObject({ amount: '45000', signed_amount: '-45000' });
  });

  it('requires a new category when switching type', async () => {
    const pho = (await asUser(alice, () => searchTransactions({ text: 'pho' }))).items[0]!;
    await expect(asUser(alice, () => updateTransaction(pho.id, { type: 'income' }))).rejects.toMatchObject({
      code: 'CATEGORY_KIND_MISMATCH',
    });
  });

  it('updates both rows of a transfer and blocks other fields', async () => {
    const transfer = (await asUser(alice, () => searchTransactions({ kind: 'transfer', account: 'tien mat' }))).items[0]!;
    const result = await asUser(alice, () => updateTransaction(transfer.id, { amount: '1500000' }));
    expect(result.transactions.map((t) => t.signed_amount).sort()).toEqual(['-1500000', '1500000']);
    await expect(asUser(alice, () => updateTransaction(transfer.id, { category: 'Khác' }))).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  it('soft deletes and restores', async () => {
    const coffee = (await asUser(alice, () => searchTransactions({ text: 'highlands' }))).items[0]!;
    const deleted = await asUser(alice, () => deleteTransaction(coffee.id));
    expect(deleted.deleted).toBe(true);
    expect((await asUser(alice, () => searchTransactions({ text: 'highlands' }))).total_count).toBe(0);
    const restored = await asUser(alice, () => deleteTransaction(coffee.id, true));
    expect(restored.transactions[0]!.deleted).toBe(false);
  });

  it('returns TRANSACTION_NOT_FOUND for unknown ids', async () => {
    await expect(asUser(alice, () => updateTransaction('not-an-id', { note: 'x' }))).rejects.toMatchObject({
      code: 'TRANSACTION_NOT_FOUND',
    });
  });

  it('searches with type, date range, totals and pagination', async () => {
    const page1 = await asUser(alice, () =>
      searchTransactions({ type: 'expense', from: '2026-10-01', to: '2026-10-31', sort: 'amount_desc', limit: 1 }),
    );
    expect(page1.total_count).toBe(3);
    expect(page1.items[0]!.amount).toBe('85000');
    expect(page1.totals).toEqual([{ currency: 'VND', count: 3, inflow: '0', outflow: '133300' }]);
    const page2 = await asUser(alice, () =>
      searchTransactions({ type: 'expense', from: '2026-10-01', to: '2026-10-31', sort: 'amount_desc', limit: 1, cursor: page1.next_cursor! }),
    );
    expect(page2.items[0]!.amount).toBe('45000');
  });

  it('searches by category including children and by amount range', async () => {
    const result = await asUser(alice, () => searchTransactions({ category: 'an uong', minAmount: '50000' }));
    expect(result.items.map((t) => t.amount)).toEqual(['85000']);
  });

  it('reconciles an account with an adjustment row', async () => {
    const result = await asUser(alice, () => reconcileAccount({ account: 'momo', actualBalance: '500000' }));
    expect(result.previous_balance).toBe('415000');
    expect(result.difference).toBe('85000');
    expect(result.adjustment).toMatchObject({ kind: 'adjustment', type: 'adjustment', signed_amount: '85000' });
    const again = await asUser(alice, () => reconcileAccount({ account: 'momo', actualBalance: '500000' }));
    expect(again.adjustment).toBeNull();
  });
});
```

(Số liệu kiểm tra: Momo = −85.000 + 500.000 (chuyển vào) = 415.000; đối soát về 500.000 → chênh 85.000. Tổng chi: 45.000 + 85.000 + 3.300 phí = 133.300.)

- [ ] **Step 2: `src/ledger/transactions.ts`**

```ts
import { randomUUID } from 'node:crypto';
import { Decimal } from 'decimal.js';
import { and, asc, desc, eq, gte, inArray, isNull, lte, type SQL, sql } from 'drizzle-orm';
import { recordAudit } from '../audit/audit.js';
import { assertDateRange, parseIsoDate, todayIn } from '../common/dates.js';
import { DomainError } from '../common/domain-error.js';
import { cleanText } from '../common/text.js';
import { currentContext } from '../db/request-context.js';
import { ledgerTransaction, type TransactionKind } from '../db/schema/index.js';
import { type Currency, parseCurrency } from '../money/currency.js';
import { formatAmount, parseAmount, parsePositiveDecimal } from '../money/money.js';
import { accountBalances, accountById, loadAccounts, resolveAccount } from './accounts.js';
import { descendantIds, loadCategories, resolveCategory } from './categories.js';
import { isUuid } from './resolver.js';
import { getUserSettings } from './user-settings.js';
import type { AccountBalanceView, EntryType, TransactionType, TransactionView } from './views.js';

export type TransactionRow = typeof ledgerTransaction.$inferSelect;
type NewTransaction = typeof ledgerTransaction.$inferInsert;

// ---------- view helpers ----------

function viewType(kind: TransactionKind, signed: Decimal): TransactionType {
  if (kind === 'transfer') return signed.isNegative() ? 'transfer_out' : 'transfer_in';
  if (kind === 'adjustment') return 'adjustment';
  return signed.isNegative() ? 'expense' : 'income';
}

async function toViews(rows: readonly TransactionRow[]): Promise<TransactionView[]> {
  const accounts = new Map((await loadAccounts({ includeArchived: true })).map((a) => [a.id, a]));
  const categories = new Map((await loadCategories({ includeArchived: true })).map((c) => [c.id, c]));
  return rows.map((row) => {
    const currency = parseCurrency(row.currency);
    const signed = new Decimal(row.amount);
    const category = row.categoryId ? categories.get(row.categoryId) : undefined;
    return {
      id: row.id,
      kind: row.kind,
      type: viewType(row.kind, signed),
      amount: formatAmount(signed.abs(), currency),
      signed_amount: formatAmount(signed, currency),
      currency,
      account: { id: row.accountId, name: accounts.get(row.accountId)?.name ?? '' },
      category: category ? { id: category.id, name: category.name } : null,
      occurred_on: row.occurredOn,
      description: row.description,
      merchant: row.merchant,
      note: row.note,
      transfer_group_id: row.transferGroupId,
      deleted: row.deletedAt !== null,
    };
  });
}

async function balancesFor(accountIds: readonly string[]): Promise<AccountBalanceView[]> {
  const accounts = await loadAccounts({ includeArchived: true });
  const balances = await accountBalances();
  return [...new Set(accountIds)].flatMap((id) => {
    const account = accounts.find((a) => a.id === id);
    if (!account) return [];
    const currency = parseCurrency(account.currency);
    return [
      {
        account_id: id,
        name: account.name,
        currency,
        balance: formatAmount(balances.get(id) ?? account.openingBalance, currency),
      },
    ];
  });
}

async function today(): Promise<string> {
  return todayIn((await getUserSettings()).timezone);
}

function notFound(id: string): DomainError {
  return new DomainError('TRANSACTION_NOT_FOUND', `Không tìm thấy giao dịch "${id}". Dùng search_transactions để lấy id.`);
}

async function findTransaction(id: string, includeDeleted = false): Promise<TransactionRow> {
  if (!isUuid(id)) throw notFound(id);
  const { tx } = currentContext();
  const [row] = await tx.select().from(ledgerTransaction).where(eq(ledgerTransaction.id, id));
  if (!row || (!includeDeleted && row.deletedAt !== null)) throw notFound(id);
  return row;
}

/** Dòng giao dịch và dòng đối ứng (với chuyển khoản). */
async function relatedRows(row: TransactionRow): Promise<TransactionRow[]> {
  if (!row.transferGroupId) return [row];
  const { tx } = currentContext();
  return tx.select().from(ledgerTransaction).where(eq(ledgerTransaction.transferGroupId, row.transferGroupId));
}

// ---------- record ----------

export type RecordItemInput = {
  amount: string;
  type: EntryType;
  account: string;
  category?: string;
  occurredOn?: string;
  description?: string;
  merchant?: string;
  note?: string;
};

export async function recordTransactions(
  items: readonly RecordItemInput[],
): Promise<{ created: TransactionView[]; balances: AccountBalanceView[] }> {
  if (items.length < 1 || items.length > 50) {
    throw new DomainError('VALIDATION_ERROR', 'Mỗi lần ghi từ 1 đến 50 giao dịch.');
  }
  const { tx, userId, clientId } = currentContext();
  const defaultDate = await today();
  const values: NewTransaction[] = [];

  for (const [index, item] of items.entries()) {
    try {
      const account = await resolveAccount(item.account);
      const currency = parseCurrency(account.currency);
      const amount = parseAmount(item.amount, currency);
      const category = item.category ? await resolveCategory(item.category, item.type) : null;
      values.push({
        userId,
        accountId: account.id,
        kind: 'standard',
        categoryId: category?.id ?? null,
        amount: (item.type === 'expense' ? amount.negated() : amount).toFixed(),
        currency,
        occurredOn: item.occurredOn ? parseIsoDate(item.occurredOn, 'occurred_on') : defaultDate,
        description: cleanText(item.description, 'description'),
        merchant: cleanText(item.merchant, 'merchant', 200),
        note: cleanText(item.note, 'note'),
        sourceClientId: clientId,
      });
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      throw new DomainError(error.code, `Dòng ${index + 1}: ${error.message}`, { ...error.details, index });
    }
  }

  const rows = await tx.insert(ledgerTransaction).values(values).returning();
  await recordAudit('transaction.create', 'ledger_transaction', rows.map((row) => row.id));
  return { created: await toViews(rows), balances: await balancesFor(rows.map((row) => row.accountId)) };
}

export type TransferInput = {
  fromAccount: string;
  toAccount: string;
  amount: string;
  occurredOn?: string;
  note?: string;
  fee?: string;
  feeCategory?: string;
};

export async function recordTransfer(input: TransferInput): Promise<{
  transfer_group_id: string;
  from: TransactionView;
  to: TransactionView;
  fee: TransactionView | null;
  balances: AccountBalanceView[];
}> {
  const { tx, userId, clientId } = currentContext();
  const from = await resolveAccount(input.fromAccount);
  const to = await resolveAccount(input.toAccount);
  if (from.id === to.id) throw new DomainError('SAME_ACCOUNT_TRANSFER', 'Ví nguồn và ví đích phải khác nhau.');
  if (from.currency !== to.currency) {
    throw new DomainError(
      'CURRENCY_MISMATCH',
      `Chưa hỗ trợ chuyển giữa ${from.currency} và ${to.currency}. Ghi thành một khoản chi và một khoản thu riêng.`,
    );
  }
  const currency = parseCurrency(from.currency);
  const amount = parseAmount(input.amount, currency);
  const occurredOn = input.occurredOn ? parseIsoDate(input.occurredOn, 'occurred_on') : await today();
  const note = cleanText(input.note, 'note');
  const transferGroupId = randomUUID();
  const base = { userId, currency, occurredOn, sourceClientId: clientId };

  const values: NewTransaction[] = [
    { ...base, accountId: from.id, kind: 'transfer', amount: amount.negated().toFixed(), transferGroupId, note },
    { ...base, accountId: to.id, kind: 'transfer', amount: amount.toFixed(), transferGroupId, note },
  ];
  if (input.fee !== undefined) {
    const fee = parseAmount(input.fee, currency);
    const feeCategory = input.feeCategory ? await resolveCategory(input.feeCategory, 'expense') : null;
    values.push({
      ...base,
      accountId: from.id,
      kind: 'standard',
      categoryId: feeCategory?.id ?? null,
      amount: fee.negated().toFixed(),
      description: 'Phí chuyển khoản',
    });
  }

  const rows = await tx.insert(ledgerTransaction).values(values).returning();
  await recordAudit('transfer.create', 'ledger_transaction', rows.map((row) => row.id));
  const views = await toViews(rows);
  return {
    transfer_group_id: transferGroupId,
    from: views.find((v) => v.type === 'transfer_out')!,
    to: views.find((v) => v.type === 'transfer_in')!,
    fee: views.find((v) => v.kind === 'standard') ?? null,
    balances: await balancesFor([from.id, to.id]),
  };
}

// ---------- update / delete ----------

export type TransactionPatch = {
  amount?: string;
  type?: EntryType;
  account?: string;
  category?: string | null;
  occurredOn?: string;
  description?: string | null;
  merchant?: string | null;
  note?: string | null;
};

const LIMITED_FIELDS: Record<Exclude<TransactionKind, 'standard'>, Array<keyof TransactionPatch>> = {
  transfer: ['amount', 'occurredOn', 'note'],
  adjustment: ['occurredOn', 'note'],
};

export async function updateTransaction(id: string, patch: TransactionPatch): Promise<{ transactions: TransactionView[] }> {
  const { tx } = currentContext();
  const row = await findTransaction(id);
  const provided = (Object.keys(patch) as Array<keyof TransactionPatch>).filter((key) => patch[key] !== undefined);
  if (provided.length === 0) throw new DomainError('VALIDATION_ERROR', 'Không có trường nào để sửa.');

  const textChanges = {
    ...(patch.description !== undefined ? { description: cleanText(patch.description, 'description') } : {}),
    ...(patch.merchant !== undefined ? { merchant: cleanText(patch.merchant, 'merchant', 200) } : {}),
    ...(patch.note !== undefined ? { note: cleanText(patch.note, 'note') } : {}),
    ...(patch.occurredOn !== undefined ? { occurredOn: parseIsoDate(patch.occurredOn, 'occurred_on') } : {}),
  };

  if (row.kind !== 'standard') {
    const allowed = LIMITED_FIELDS[row.kind];
    const invalid = provided.filter((key) => !allowed.includes(key));
    if (invalid.length > 0) {
      throw new DomainError('VALIDATION_ERROR', `Giao dịch loại ${row.kind} chỉ sửa được: ${allowed.join(', ')}.`, {
        invalid_fields: invalid,
      });
    }
    const magnitude = patch.amount !== undefined ? parseAmount(patch.amount, parseCurrency(row.currency)) : undefined;
    const updated: TransactionRow[] = [];
    for (const current of await relatedRows(row)) {
      const sign = new Decimal(current.amount).isNegative() ? -1 : 1;
      const [next] = await tx
        .update(ledgerTransaction)
        .set({ ...textChanges, ...(magnitude ? { amount: magnitude.times(sign).toFixed() } : {}) })
        .where(eq(ledgerTransaction.id, current.id))
        .returning();
      updated.push(next!);
    }
    await recordAudit('transaction.update', 'ledger_transaction', updated.map((r) => r.id));
    return { transactions: await toViews(updated) };
  }

  const account = patch.account !== undefined ? await resolveAccount(patch.account) : await accountById(row.accountId);
  const currency: Currency = parseCurrency(account.currency);
  const currentAmount = new Decimal(row.amount);
  const type: EntryType = patch.type ?? (currentAmount.isNegative() ? 'expense' : 'income');
  const magnitude = parseAmount(patch.amount ?? currentAmount.abs().toFixed(), currency);

  let categoryId = row.categoryId;
  if (patch.category === null) {
    categoryId = null;
  } else if (patch.category !== undefined) {
    categoryId = (await resolveCategory(patch.category, type)).id;
  } else if (categoryId) {
    const current = (await loadCategories({ includeArchived: true })).find((c) => c.id === categoryId);
    if (current && current.kind !== type) {
      throw new DomainError(
        'CATEGORY_KIND_MISMATCH',
        `Danh mục hiện tại "${current.name}" không hợp với loại ${type}; truyền category mới hoặc null.`,
      );
    }
  }

  const [next] = await tx
    .update(ledgerTransaction)
    .set({
      ...textChanges,
      accountId: account.id,
      currency,
      categoryId,
      amount: (type === 'expense' ? magnitude.negated() : magnitude).toFixed(),
    })
    .where(eq(ledgerTransaction.id, row.id))
    .returning();
  await recordAudit('transaction.update', 'ledger_transaction', [next!.id]);
  return { transactions: await toViews([next!]) };
}

export async function deleteTransaction(
  id: string,
  restore = false,
): Promise<{ deleted: boolean; transactions: TransactionView[]; balances: AccountBalanceView[] }> {
  const { tx } = currentContext();
  const row = await findTransaction(id, true);
  const ids = (await relatedRows(row)).map((r) => r.id);
  const updated = await tx
    .update(ledgerTransaction)
    .set({ deletedAt: restore ? null : new Date() })
    .where(inArray(ledgerTransaction.id, ids))
    .returning();
  await recordAudit(restore ? 'transaction.restore' : 'transaction.delete', 'ledger_transaction', ids);
  return {
    deleted: !restore,
    transactions: await toViews(updated),
    balances: await balancesFor(updated.map((r) => r.accountId)),
  };
}

// ---------- search ----------

export type SearchFilters = {
  from?: string;
  to?: string;
  account?: string;
  category?: string;
  type?: EntryType;
  kind?: TransactionKind;
  minAmount?: string;
  maxAmount?: string;
  text?: string;
  sort?: 'date_desc' | 'date_asc' | 'amount_desc' | 'amount_asc';
  limit?: number;
  cursor?: string;
  includeDeleted?: boolean;
};

export type SearchResult = {
  items: TransactionView[];
  next_cursor: string | null;
  total_count: number;
  totals: Array<{ currency: string; count: number; inflow: string; outflow: string }>;
};

function encodeCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ o: offset })).toString('base64url');
}

function decodeCursor(cursor: string): number {
  try {
    const { o } = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { o: unknown };
    if (typeof o === 'number' && Number.isInteger(o) && o >= 0) return o;
  } catch {
    // rơi xuống lỗi bên dưới
  }
  throw new DomainError('VALIDATION_ERROR', 'cursor không hợp lệ; dùng đúng next_cursor của lần gọi trước.');
}

function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (char) => `\\${char}`);
}

export async function searchTransactions(filters: SearchFilters): Promise<SearchResult> {
  const { tx } = currentContext();
  const t = ledgerTransaction;
  const conditions: SQL[] = [];

  if (!filters.includeDeleted) conditions.push(isNull(t.deletedAt));
  const from = filters.from ? parseIsoDate(filters.from, 'from') : undefined;
  const to = filters.to ? parseIsoDate(filters.to, 'to') : undefined;
  assertDateRange(from, to);
  if (from) conditions.push(gte(t.occurredOn, from));
  if (to) conditions.push(lte(t.occurredOn, to));
  if (filters.account) {
    conditions.push(eq(t.accountId, (await resolveAccount(filters.account, { allowArchived: true })).id));
  }
  if (filters.category) {
    conditions.push(inArray(t.categoryId, await descendantIds((await resolveCategory(filters.category)).id)));
  }
  if (filters.type) {
    conditions.push(eq(t.kind, 'standard'));
    conditions.push(filters.type === 'expense' ? sql`${t.amount} < 0` : sql`${t.amount} > 0`);
  }
  if (filters.kind) conditions.push(eq(t.kind, filters.kind));
  if (filters.minAmount) {
    conditions.push(sql`abs(${t.amount}) >= ${parsePositiveDecimal(filters.minAmount, 'min_amount').toFixed()}::numeric`);
  }
  if (filters.maxAmount) {
    conditions.push(sql`abs(${t.amount}) <= ${parsePositiveDecimal(filters.maxAmount, 'max_amount').toFixed()}::numeric`);
  }
  const text = filters.text?.trim();
  if (text) {
    const pattern = `%${escapeLike(text)}%`;
    conditions.push(
      sql`unaccent(lower(concat_ws(' ', ${t.description}, ${t.merchant}, ${t.note}))) like unaccent(lower(${pattern})) escape '\\'`,
    );
  }

  const limit = filters.limit ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    throw new DomainError('VALIDATION_ERROR', 'limit phải từ 1 đến 200.');
  }
  const offset = filters.cursor ? decodeCursor(filters.cursor) : 0;
  const order = {
    date_desc: [desc(t.occurredOn), desc(t.createdAt), desc(t.id)],
    date_asc: [asc(t.occurredOn), asc(t.createdAt), asc(t.id)],
    amount_desc: [sql`abs(${t.amount}) desc`, desc(t.occurredOn), desc(t.id)],
    amount_asc: [sql`abs(${t.amount}) asc`, desc(t.occurredOn), desc(t.id)],
  }[filters.sort ?? 'date_desc'];
  const where = and(...conditions);

  const rows = await tx
    .select()
    .from(t)
    .where(where)
    .orderBy(...order)
    .limit(limit + 1)
    .offset(offset);
  const totals = await tx
    .select({
      currency: t.currency,
      count: sql<number>`count(*)::int`,
      inflow: sql<string>`coalesce(sum(${t.amount}) filter (where ${t.amount} > 0), 0)::text`,
      outflow: sql<string>`coalesce(sum(-${t.amount}) filter (where ${t.amount} < 0), 0)::text`,
    })
    .from(t)
    .where(where)
    .groupBy(t.currency)
    .orderBy(t.currency);

  return {
    items: await toViews(rows.slice(0, limit)),
    next_cursor: rows.length > limit ? encodeCursor(offset + limit) : null,
    total_count: totals.reduce((sum, row) => sum + row.count, 0),
    totals: totals.map((row) => {
      const currency = parseCurrency(row.currency);
      return {
        currency,
        count: row.count,
        inflow: formatAmount(row.inflow, currency),
        outflow: formatAmount(row.outflow, currency),
      };
    }),
  };
}

// ---------- reconcile ----------

export async function reconcileAccount(input: { account: string; actualBalance: string; asOf?: string }): Promise<{
  account: { id: string; name: string; currency: string };
  as_of: string;
  previous_balance: string;
  actual_balance: string;
  difference: string;
  adjustment: TransactionView | null;
}> {
  const { tx, userId, clientId } = currentContext();
  const account = await resolveAccount(input.account);
  const currency = parseCurrency(account.currency);
  const actual = parseAmount(input.actualBalance, currency, { allowNegative: true, allowZero: true });
  const asOf = input.asOf ? parseIsoDate(input.asOf, 'as_of') : await today();
  const previous = new Decimal((await accountBalances(asOf)).get(account.id) ?? account.openingBalance);
  const difference = actual.minus(previous);

  let adjustment: TransactionView | null = null;
  if (!difference.isZero()) {
    const [row] = await tx
      .insert(ledgerTransaction)
      .values({
        userId,
        accountId: account.id,
        kind: 'adjustment',
        amount: difference.toFixed(),
        currency,
        occurredOn: asOf,
        note: 'Điều chỉnh số dư theo đối soát',
        sourceClientId: clientId,
      })
      .returning();
    await recordAudit('account.reconcile', 'ledger_transaction', [row!.id]);
    [adjustment] = await toViews([row!]);
  }

  return {
    account: { id: account.id, name: account.name, currency },
    as_of: asOf,
    previous_balance: formatAmount(previous, currency),
    actual_balance: formatAmount(actual, currency),
    difference: formatAmount(difference, currency),
    adjustment,
  };
}
```

- [ ] **Step 3: Chạy** — `bun run test:int` → PASS (thêm 14 test). `bun run typecheck && bun run lint` sạch.

Nếu `concat_ws` trả `NULL` cho dòng không có text nào — đúng ý (không khớp). Nếu tìm `pho` không ra "Phở bò": kiểm tra migration 0004 đã tạo `unaccent` trên DB test (global setup chạy migrations).

- [ ] **Step 4: Commit** — `src/ledger/transactions.ts`, `src/ledger/transactions.int-spec.ts`:

```
feat(ledger): record, transfer, edit, delete, search and reconcile transactions
```

---

### Task 9: Tổng quan (`get_overview`)

**Files:**
- Create: `src/ledger/overview.ts`, `src/ledger/overview.int-spec.ts`

- [ ] **Step 1: Test thất bại** — `src/ledger/overview.int-spec.ts`:

```ts
import { pool } from '../db/index.js';
import { asUser, createTestUser } from '../../test/fixtures.js';
import { createAccount, updateAccount } from './accounts.js';
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
        { amount: '300000', type: 'expense', account: 'VCB', occurredOn: '2026-10-05' },
        { amount: '100000', type: 'expense', account: 'VCB', occurredOn: '2026-10-20' },
      ]);
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
});
```

- [ ] **Step 2: `src/ledger/overview.ts`**

```ts
import { Decimal } from 'decimal.js';
import { parseIsoDate, todayIn } from '../common/dates.js';
import { type Currency, parseCurrency } from '../money/currency.js';
import { formatAmount } from '../money/money.js';
import { accountBalances, loadAccounts, toAccountView } from './accounts.js';
import { categoryTree } from './categories.js';
import { getUserSettings } from './user-settings.js';
import type { AccountView, CategoryNode } from './views.js';

export type Overview = {
  today: string;
  as_of: string;
  timezone: string;
  base_currency: string;
  accounts: AccountView[];
  net_worth: Array<{ currency: string; total: string }>;
  categories: CategoryNode[];
};

export async function getOverview(asOf?: string): Promise<Overview> {
  const settings = await getUserSettings();
  const today = todayIn(settings.timezone);
  const date = asOf ? parseIsoDate(asOf, 'as_of') : today;
  const balances = await accountBalances(date);
  const accounts = (await loadAccounts()).map((row) =>
    toAccountView(row, balances.get(row.id) ?? row.openingBalance),
  );

  const totals = new Map<Currency, Decimal>();
  for (const account of accounts) {
    const currency = parseCurrency(account.currency);
    totals.set(currency, (totals.get(currency) ?? new Decimal(0)).plus(account.balance));
  }

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
  };
}
```

- [ ] **Step 3: Chạy** — `bun run test:int` → PASS. `bun run typecheck && bun run lint` sạch.

- [ ] **Step 4: Commit**:

```
feat(ledger): add overview with balances as of a date and net worth
```

---

### Task 10: Tool kit — savepoint cho tool ghi, ẩn lỗi hệ thống

**Files:**
- Modify: `src/mcp/tool-kit.ts`, `src/mcp/tool-kit.spec.ts`

- [ ] **Step 1: Sửa test** — trong `src/mcp/tool-kit.spec.ts`, thay test `'toolError rethrows unexpected errors'` bằng:

```ts
  it('toolError hides unexpected errors behind INTERNAL_ERROR', () => {
    const result = toolError(new Error('connection reset by peer'));
    expect(result.isError).toBe(true);
    const body = JSON.parse((result.content[0] as { text: string }).text);
    expect(body.code).toBe('INTERNAL_ERROR');
    expect(body.message).not.toContain('connection reset');
    expect(body.details.ref).toMatch(/^[0-9a-f-]{36}$/);
  });
```

Run: `bun run test src/mcp` → FAIL.

- [ ] **Step 2: Thay toàn bộ `src/mcp/tool-kit.ts`**

```ts
import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { FINANCE_WRITE } from '../auth/constants.js';
import { DomainError } from '../common/domain-error.js';
import { currentContext, runInContext } from '../db/request-context.js';

/** Giữ tên ToolError cho code MCP hiện có; domain dùng DomainError. */
export { DomainError as ToolError };

const logger = new Logger('McpTool');

export function requireScope(scope: string): void {
  if (!currentContext().scopes.includes(scope)) {
    throw new DomainError('INSUFFICIENT_SCOPE', `Kết nối này chưa được cấp quyền ${scope}. Hãy kết nối lại và cấp quyền.`);
  }
}

export function toolResult(data: Record<string, unknown>, summary: string): CallToolResult {
  return { content: [{ type: 'text', text: summary }], structuredContent: data };
}

/**
 * Không gửi structuredContent khi lỗi: client SDK kiểm tra structuredContent theo outputSchema
 * kể cả khi isError, và sẽ ném lỗi nếu không khớp. Lỗi ngoài DomainError được log và che đi.
 */
export function toolError(error: unknown): CallToolResult {
  let body: { code: string; message: string; details?: Record<string, unknown> };
  if (error instanceof DomainError) {
    body = { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) };
  } else {
    const ref = randomUUID();
    logger.error(`Unexpected tool error ref=${ref}`, error instanceof Error ? error.stack : String(error));
    body = { code: 'INTERNAL_ERROR', message: 'Lỗi hệ thống, hãy thử lại sau.', details: { ref } };
  }
  return { isError: true, content: [{ type: 'text', text: JSON.stringify(body) }] };
}

/** Tool ghi chạy trong savepoint: lỗi giữa chừng không để lại dữ liệu ghi dở. */
async function inSavepoint<T>(fn: () => Promise<T>): Promise<T> {
  const context = currentContext();
  return context.tx.transaction((savepoint) => runInContext({ ...context, tx: savepoint }, fn));
}

export async function runTool<T extends object>(
  scope: string,
  fn: () => Promise<T>,
  summarize: (data: T) => string,
): Promise<CallToolResult> {
  try {
    requireScope(scope);
    const data = scope === FINANCE_WRITE ? await inSavepoint(fn) : await fn();
    return toolResult(data as unknown as Record<string, unknown>, summarize(data));
  } catch (error) {
    return toolError(error);
  }
}
```

- [ ] **Step 3: Chạy** — `bun run test && bun run typecheck` → PASS.

- [ ] **Step 4: Commit**:

```
feat(mcp): run write tools in savepoints and mask unexpected errors
```

---

### Task 11: Các MCP tool của ledger

**Files:**
- Create: `src/mcp/tools/schemas.ts`, `src/mcp/tools/overview.tool.ts`, `src/mcp/tools/account.tools.ts`, `src/mcp/tools/category.tools.ts`, `src/mcp/tools/transaction.tools.ts`, `src/mcp/tools/reconcile.tool.ts`
- Modify: `src/mcp/mcp-server.factory.ts`

- [ ] **Step 1: `src/mcp/tools/schemas.ts`**

```ts
import { z } from 'zod';
import { ACCOUNT_TYPES, CATEGORY_KINDS, TRANSACTION_KINDS } from '../../db/schema/index.js';

// ---------- input ----------

export const amountInput = z
  .string()
  .describe('Số tiền dương dạng chuỗi, dấu chấm thập phân: "85000", "12.5". Đổi "85k" thành "85000", "2tr" thành "2000000".');
export const signedAmountInput = z
  .string()
  .describe('Số tiền dạng chuỗi, có thể âm (ví dụ dư nợ thẻ tín dụng "-2000000").');
export const entryType = z.enum(['expense', 'income']).describe('expense = khoản chi, income = khoản thu');
export const accountRef = z.string().describe('Id hoặc tên ví; không cần dấu, không phân biệt hoa thường');
export const categoryRef = z.string().describe('Id hoặc tên danh mục; không cần dấu, không phân biệt hoa thường');
export const dateInput = z.string().describe('Ngày dạng YYYY-MM-DD; bỏ trống = hôm nay theo múi giờ người dùng');

// ---------- output ----------

export const accountView = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(ACCOUNT_TYPES),
  currency: z.string(),
  balance: z.string(),
  archived: z.boolean(),
});

export const balanceView = z.object({
  account_id: z.string(),
  name: z.string(),
  currency: z.string(),
  balance: z.string(),
});

export const categoryView = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(CATEGORY_KINDS),
  parent_id: z.string().nullable(),
  archived: z.boolean(),
});

export const categoryNode = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(CATEGORY_KINDS),
  children: z.array(z.object({ id: z.string(), name: z.string() })),
});

const ref = z.object({ id: z.string(), name: z.string() });

export const transactionView = z.object({
  id: z.string(),
  kind: z.enum(TRANSACTION_KINDS),
  type: z.enum(['expense', 'income', 'transfer_out', 'transfer_in', 'adjustment']),
  amount: z.string(),
  signed_amount: z.string(),
  currency: z.string(),
  account: ref,
  category: ref.nullable(),
  occurred_on: z.string(),
  description: z.string().nullable(),
  merchant: z.string().nullable(),
  note: z.string().nullable(),
  transfer_group_id: z.string().nullable(),
  deleted: z.boolean(),
});

export const READ_ONLY = { readOnlyHint: true, openWorldHint: false } as const;
export const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;
```

- [ ] **Step 2: `src/mcp/tools/overview.tool.ts`**

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
        'Gọi đầu mỗi cuộc trò chuyện. Trả về ngày hôm nay theo múi giờ người dùng, tiền tệ mặc định, các ví và số dư (tại as_of), tổng tài sản theo tiền tệ, và cây danh mục.',
      inputSchema: { as_of: dateInput.optional() },
      outputSchema: {
        today: z.string(),
        as_of: z.string(),
        timezone: z.string(),
        base_currency: z.string(),
        accounts: z.array(accountView),
        net_worth: z.array(z.object({ currency: z.string(), total: z.string() })),
        categories: z.array(categoryNode),
      },
      annotations: READ_ONLY,
    },
    async ({ as_of }) =>
      runTool(FINANCE_READ, () => getOverview(as_of), (d) =>
        `Hôm nay ${d.today}. ${d.accounts.length} ví; tổng tài sản: ${d.net_worth.map((n) => `${n.total} ${n.currency}`).join(', ') || '0'}.`,
      ),
  );
}
```

- [ ] **Step 3: `src/mcp/tools/account.tools.ts`**

```ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { FINANCE_WRITE } from '../../auth/constants.js';
import { ACCOUNT_TYPES } from '../../db/schema/index.js';
import { createAccount, updateAccount } from '../../ledger/accounts.js';
import { runTool } from '../tool-kit.js';
import { accountRef, accountView, signedAmountInput, WRITE } from './schemas.js';

export function registerAccountTools(server: McpServer): void {
  server.registerTool(
    'create_account',
    {
      title: 'Tạo ví',
      description:
        'Tạo ví/tài khoản mới (tiền mặt, ngân hàng, thẻ tín dụng, ví điện tử). Chỉ gọi khi người dùng đồng ý tạo ví.',
      inputSchema: {
        type: z.enum(ACCOUNT_TYPES).describe('cash | bank | credit_card | ewallet'),
        name: z.string().describe('Tên ví, ví dụ "Vietcombank", "Momo"'),
        currency: z.string().optional().describe('Mã tiền tệ (VND, USD, …); mặc định là tiền tệ của người dùng'),
        opening_balance: signedAmountInput.optional().describe('Số dư ban đầu; thẻ tín dụng đang nợ thì để số âm'),
      },
      outputSchema: accountView.shape,
      annotations: WRITE,
    },
    async (args) =>
      runTool(
        FINANCE_WRITE,
        () =>
          createAccount({ type: args.type, name: args.name, currency: args.currency, openingBalance: args.opening_balance }),
        (a) => `Đã tạo ví "${a.name}" (${a.currency}), số dư ${a.balance}.`,
      ),
  );

  server.registerTool(
    'update_account',
    {
      title: 'Sửa ví',
      description: 'Đổi tên ví, lưu trữ (archived=true) hoặc mở lại (archived=false).',
      inputSchema: {
        account: accountRef,
        name: z.string().optional(),
        archived: z.boolean().optional(),
      },
      outputSchema: accountView.shape,
      annotations: WRITE,
    },
    async ({ account, name, archived }) =>
      runTool(
        FINANCE_WRITE,
        () => updateAccount(account, { name, archived }),
        (a) => `Đã cập nhật ví "${a.name}"${a.archived ? ' (đã lưu trữ)' : ''}.`,
      ),
  );
}
```

- [ ] **Step 4: `src/mcp/tools/category.tools.ts`**

```ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { FINANCE_WRITE } from '../../auth/constants.js';
import { CATEGORY_KINDS } from '../../db/schema/index.js';
import { createCategory, updateCategory } from '../../ledger/categories.js';
import { runTool } from '../tool-kit.js';
import { categoryRef, categoryView, WRITE } from './schemas.js';

export function registerCategoryTools(server: McpServer): void {
  server.registerTool(
    'create_category',
    {
      title: 'Tạo danh mục',
      description: 'Tạo danh mục thu hoặc chi; có thể đặt dưới một danh mục cấp 1 (tối đa 2 cấp). Hỏi người dùng trước khi tạo.',
      inputSchema: {
        name: z.string(),
        kind: z.enum(CATEGORY_KINDS).describe('expense = danh mục chi, income = danh mục thu'),
        parent: categoryRef.optional().describe('Danh mục cha cấp 1, cùng loại'),
      },
      outputSchema: categoryView.shape,
      annotations: WRITE,
    },
    async ({ name, kind, parent }) =>
      runTool(FINANCE_WRITE, () => createCategory({ name, kind, parent }), (c) => `Đã tạo danh mục "${c.name}".`),
  );

  server.registerTool(
    'update_category',
    {
      title: 'Sửa danh mục',
      description: 'Đổi tên, đổi danh mục cha (parent=null để thành cấp 1), lưu trữ hoặc mở lại danh mục.',
      inputSchema: {
        category: categoryRef,
        name: z.string().optional(),
        parent: categoryRef.nullable().optional(),
        archived: z.boolean().optional(),
      },
      outputSchema: categoryView.shape,
      annotations: WRITE,
    },
    async ({ category, name, parent, archived }) =>
      runTool(
        FINANCE_WRITE,
        () => updateCategory(category, { name, parent, archived }),
        (c) => `Đã cập nhật danh mục "${c.name}".`,
      ),
  );
}
```

- [ ] **Step 5: `src/mcp/tools/transaction.tools.ts`**

```ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { FINANCE_READ, FINANCE_WRITE } from '../../auth/constants.js';
import { TRANSACTION_KINDS } from '../../db/schema/index.js';
import {
  deleteTransaction,
  recordTransactions,
  recordTransfer,
  searchTransactions,
  updateTransaction,
} from '../../ledger/transactions.js';
import { runTool } from '../tool-kit.js';
import {
  accountRef,
  amountInput,
  balanceView,
  categoryRef,
  dateInput,
  entryType,
  READ_ONLY,
  transactionView,
  WRITE,
} from './schemas.js';

export function registerTransactionTools(server: McpServer): void {
  server.registerTool(
    'record_transactions',
    {
      title: 'Ghi thu/chi',
      description:
        'Ghi 1–50 khoản thu hoặc chi trong một lần gọi. Cả lô ghi nguyên tử: một dòng lỗi thì không dòng nào được ghi (lỗi chỉ rõ dòng). Chuyển tiền giữa các ví dùng record_transfer.',
      inputSchema: {
        items: z
          .array(
            z.object({
              amount: amountInput,
              type: entryType,
              account: accountRef,
              category: categoryRef.optional(),
              occurred_on: dateInput.optional(),
              description: z.string().optional().describe('Mô tả ngắn, ví dụ "Phở bò"'),
              merchant: z.string().optional().describe('Nơi chi tiêu/nguồn thu, ví dụ "Highlands"'),
              note: z.string().optional(),
            }),
          )
          .min(1)
          .max(50),
      },
      outputSchema: { created: z.array(transactionView), balances: z.array(balanceView) },
      annotations: WRITE,
    },
    async ({ items }) =>
      runTool(
        FINANCE_WRITE,
        () =>
          recordTransactions(
            items.map((item) => ({
              amount: item.amount,
              type: item.type,
              account: item.account,
              category: item.category,
              occurredOn: item.occurred_on,
              description: item.description,
              merchant: item.merchant,
              note: item.note,
            })),
          ),
        (d) => `Đã ghi ${d.created.length} giao dịch.`,
      ),
  );

  server.registerTool(
    'record_transfer',
    {
      title: 'Chuyển tiền giữa ví',
      description:
        'Chuyển tiền giữa hai ví cùng tiền tệ: rút ATM, nạp ví điện tử, trả nợ thẻ tín dụng. Không tính là thu/chi. Phí (nếu có) được ghi thành một khoản chi riêng.',
      inputSchema: {
        from_account: accountRef,
        to_account: accountRef,
        amount: amountInput,
        occurred_on: dateInput.optional(),
        note: z.string().optional(),
        fee: amountInput.optional().describe('Phí chuyển khoản, trừ vào ví nguồn'),
        fee_category: categoryRef.optional().describe('Danh mục chi cho phí'),
      },
      outputSchema: {
        transfer_group_id: z.string(),
        from: transactionView,
        to: transactionView,
        fee: transactionView.nullable(),
        balances: z.array(balanceView),
      },
      annotations: WRITE,
    },
    async (a) =>
      runTool(
        FINANCE_WRITE,
        () =>
          recordTransfer({
            fromAccount: a.from_account,
            toAccount: a.to_account,
            amount: a.amount,
            occurredOn: a.occurred_on,
            note: a.note,
            fee: a.fee,
            feeCategory: a.fee_category,
          }),
        (d) => `Đã chuyển ${d.from.amount} ${d.from.currency} từ ${d.from.account.name} sang ${d.to.account.name}.`,
      ),
  );

  server.registerTool(
    'update_transaction',
    {
      title: 'Sửa giao dịch',
      description:
        'Sửa một giao dịch theo id (lấy id từ search_transactions). Chỉ truyền trường cần đổi; null để xoá category/description/merchant/note. Chuyển khoản chỉ sửa được amount, occurred_on, note (áp cho cả hai phía).',
      inputSchema: {
        id: z.string(),
        amount: amountInput.optional(),
        type: entryType.optional(),
        account: accountRef.optional(),
        category: categoryRef.nullable().optional(),
        occurred_on: dateInput.optional(),
        description: z.string().nullable().optional(),
        merchant: z.string().nullable().optional(),
        note: z.string().nullable().optional(),
      },
      outputSchema: { transactions: z.array(transactionView) },
      annotations: WRITE,
    },
    async ({ id, occurred_on, ...rest }) =>
      runTool(
        FINANCE_WRITE,
        () => updateTransaction(id, { ...rest, occurredOn: occurred_on }),
        (d) => `Đã sửa ${d.transactions.length} dòng giao dịch.`,
      ),
  );

  server.registerTool(
    'delete_transaction',
    {
      title: 'Xoá giao dịch',
      description: 'Xoá mềm một giao dịch (chuyển khoản: xoá cả hai phía). restore=true để khôi phục.',
      inputSchema: { id: z.string(), restore: z.boolean().optional() },
      outputSchema: {
        deleted: z.boolean(),
        transactions: z.array(transactionView),
        balances: z.array(balanceView),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    async ({ id, restore }) =>
      runTool(
        FINANCE_WRITE,
        () => deleteTransaction(id, restore ?? false),
        (d) => (d.deleted ? `Đã xoá ${d.transactions.length} dòng giao dịch.` : 'Đã khôi phục giao dịch.'),
      ),
  );

  server.registerTool(
    'search_transactions',
    {
      title: 'Tìm giao dịch',
      description:
        'Tìm và liệt kê giao dịch theo khoảng ngày, ví, danh mục (gồm danh mục con), loại, khoảng số tiền, từ khoá (không dấu) trong mô tả/merchant/ghi chú. Dùng sort=amount_desc + limit cho "khoản chi lớn nhất". totals là tổng của toàn bộ kết quả, không chỉ trang hiện tại.',
      inputSchema: {
        from: dateInput.optional(),
        to: dateInput.optional(),
        account: accountRef.optional(),
        category: categoryRef.optional(),
        type: entryType.optional().describe('Chỉ khoản thu hoặc chi thường (bỏ qua chuyển khoản, điều chỉnh)'),
        kind: z.enum(TRANSACTION_KINDS).optional(),
        min_amount: z.string().optional(),
        max_amount: z.string().optional(),
        text: z.string().optional(),
        sort: z.enum(['date_desc', 'date_asc', 'amount_desc', 'amount_asc']).optional(),
        limit: z.number().int().min(1).max(200).optional().describe('Mặc định 50'),
        cursor: z.string().optional().describe('next_cursor của lần gọi trước'),
        include_deleted: z.boolean().optional(),
      },
      outputSchema: {
        items: z.array(transactionView),
        next_cursor: z.string().nullable(),
        total_count: z.number(),
        totals: z.array(z.object({ currency: z.string(), count: z.number(), inflow: z.string(), outflow: z.string() })),
      },
      annotations: READ_ONLY,
    },
    async (a) =>
      runTool(
        FINANCE_READ,
        () =>
          searchTransactions({
            from: a.from,
            to: a.to,
            account: a.account,
            category: a.category,
            type: a.type,
            kind: a.kind,
            minAmount: a.min_amount,
            maxAmount: a.max_amount,
            text: a.text,
            sort: a.sort,
            limit: a.limit,
            cursor: a.cursor,
            includeDeleted: a.include_deleted,
          }),
        (d) => `Tìm thấy ${d.total_count} giao dịch, hiển thị ${d.items.length}.`,
      ),
  );
}
```

- [ ] **Step 6: `src/mcp/tools/reconcile.tool.ts`**

```ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { FINANCE_WRITE } from '../../auth/constants.js';
import { reconcileAccount } from '../../ledger/transactions.js';
import { runTool } from '../tool-kit.js';
import { accountRef, dateInput, signedAmountInput, transactionView, WRITE } from './schemas.js';

export function registerReconcileTool(server: McpServer): void {
  server.registerTool(
    'reconcile_account',
    {
      title: 'Đối soát số dư',
      description:
        'Khớp số dư ví với số dư thực tế người dùng báo. Tạo một dòng điều chỉnh cho phần chênh lệch (không tính vào thu/chi); không tạo gì nếu đã khớp.',
      inputSchema: {
        account: accountRef,
        actual_balance: signedAmountInput,
        as_of: dateInput.optional(),
      },
      outputSchema: {
        account: z.object({ id: z.string(), name: z.string(), currency: z.string() }),
        as_of: z.string(),
        previous_balance: z.string(),
        actual_balance: z.string(),
        difference: z.string(),
        adjustment: transactionView.nullable(),
      },
      annotations: WRITE,
    },
    async ({ account, actual_balance, as_of }) =>
      runTool(
        FINANCE_WRITE,
        () => reconcileAccount({ account, actualBalance: actual_balance, asOf: as_of }),
        (d) =>
          d.adjustment
            ? `Đã điều chỉnh ${d.account.name}: chênh lệch ${d.difference} ${d.account.currency}.`
            : `${d.account.name} đã khớp số dư.`,
      ),
  );
}
```

- [ ] **Step 7: Thay `src/mcp/mcp-server.factory.ts`**

```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAccountTools } from './tools/account.tools.js';
import { registerCategoryTools } from './tools/category.tools.js';
import { registerOverviewTool } from './tools/overview.tool.js';
import { registerReconcileTool } from './tools/reconcile.tool.js';
import { registerTransactionTools } from './tools/transaction.tools.js';
import { registerWhoamiTool } from './tools/whoami.tool.js';

export const SERVER_INSTRUCTIONS = [
  'Đây là sổ thu chi cá nhân của người dùng.',
  'Trả lời người dùng bằng ngôn ngữ họ dùng.',
  'Đầu mỗi cuộc trò chuyện, gọi get_overview để biết ngày hôm nay theo múi giờ người dùng, các ví và danh mục.',
  'Số tiền luôn là chuỗi số dương với dấu chấm thập phân ("85000", "12.5"); chiều thu/chi do tham số type quyết định. Đổi "85k" thành "85000", "2tr" thành "2000000".',
  'Ghi nhiều khoản trong một lần gọi record_transactions.',
  'Chi tiêu bằng thẻ tín dụng ghi vào ví thẻ; trả nợ thẻ, rút tiền ATM, nạp ví điện tử là record_transfer.',
  'Không tự tạo ví hay danh mục mới khi chưa hỏi người dùng.',
  'Khi một tool trả lỗi dạng JSON {code, message}, đọc message để sửa tham số rồi gọi lại; với AMBIGUOUS_* hoặc *_NOT_FOUND thì hỏi người dùng chọn trong candidates/suggestions.',
].join('\n');

/** Tạo server mới cho mỗi request (transport stateless không dùng lại được). */
export function createMcpServer(): McpServer {
  const server = new McpServer(
    { name: 'personal-finance', version: '0.2.0' },
    { instructions: SERVER_INSTRUCTIONS },
  );
  registerWhoamiTool(server);
  registerOverviewTool(server);
  registerAccountTools(server);
  registerCategoryTools(server);
  registerTransactionTools(server);
  registerReconcileTool(server);
  return server;
}
```

- [ ] **Step 8: Chạy** — `bun run typecheck && bun run lint && bun run test && bun run test:e2e` → PASS (e2e cũ vẫn 20; `sổ thu chi` vẫn có trong instructions).

- [ ] **Step 9: Commit**:

```
feat(mcp): expose ledger tools for accounts, categories, transactions and reconcile
```

---

### Task 12: E2E kịch bản một tháng qua MCP client + chạy trên Bun

**Files:**
- Create: `test/mcp-client.ts`, `test/ledger-mcp.e2e-spec.ts`
- Modify: `.env.test`, `test/oauth-mcp.e2e-spec.ts`

- [ ] **Step 1: Cho phép email e2e mới** — `.env.test`:

```dotenv
ALLOWED_EMAILS=allowed@example.com,oauth-e2e@example.com,ledger-e2e@example.com
```

- [ ] **Step 2: `test/mcp-client.ts`**

```ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

export async function connectMcp(baseUrl: string, accessToken: string): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
  const client = new Client({ name: 'e2e', version: '1.0.0' });
  await client.connect(transport);
  return client;
}

function firstText(result: { content?: unknown }): string {
  return (result.content as Array<{ text?: string }> | undefined)?.[0]?.text ?? '';
}

/** Gọi tool, ném lỗi nếu tool trả isError; trả về structuredContent. */
export async function callOk<T = any>(client: Client, name: string, args: Record<string, unknown> = {}): Promise<T> {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError) throw new Error(`${name} failed: ${firstText(result)}`);
  return result.structuredContent as T;
}

/** Gọi tool mong đợi lỗi nghiệp vụ; trả về body JSON {code, message, details}. */
export async function callError(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<{ code: string; message: string; details?: any }> {
  const result = await client.callTool({ name, arguments: args });
  if (!result.isError) throw new Error(`${name} unexpectedly succeeded`);
  return JSON.parse(firstText(result));
}
```

- [ ] **Step 3: Dùng helper trong test cũ** — trong `test/oauth-mcp.e2e-spec.ts`, xoá hàm `connectMcp` cục bộ và hai import `Client`/`StreamableHTTPClientTransport`, thêm:

```ts
import { connectMcp } from './mcp-client.js';
```

- [ ] **Step 4: `test/ledger-mcp.e2e-spec.ts`**

```ts
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
```

(Số liệu: VCB 1.000.000 + 25.000.000 − 2.000.000 = 24.000.000; Tiền mặt −50.000 + 2.000.000 → sửa phở 45.000 → 1.955.000; Momo −85.000 → đối soát 100.000 chênh 185.000; tổng 24.000.000 + 1.955.000 + 100.000 = 26.055.000.)

- [ ] **Step 5: Chạy toàn bộ, kể cả trên runtime Bun**

```bash
bun run test && bun run test:int && bun run test:e2e && bun run test:e2e:bun && bun run typecheck && bun run lint
```

Expected: tất cả PASS. `test:e2e:bun` chạy cùng bộ e2e trên runtime Bun (app production chạy bằng Bun).

- [ ] **Step 6: Commit** — `.env.test`, `test/mcp-client.ts`, `test/ledger-mcp.e2e-spec.ts`, `test/oauth-mcp.e2e-spec.ts`:

```
test(e2e): cover a month of ledger usage through the MCP client
```

---

## Hoàn tất Plan 2

- Tất cả lệnh ở Task 12 Step 5 pass.
- Kiểm tra thủ công (cùng người dùng): chạy `bun run db:migrate && bun run db:seed-categories`, khởi động app + tunnel, trong Claude/ChatGPT thử: "lương tháng 10 về 25tr vào VCB", "sáng phở 50k tiền mặt, trưa cà phê 45k momo", "rút 2tr từ VCB", "tháng này chi bao nhiêu cho ăn uống?", "Momo thực tế còn 100k, khớp lại".
