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
  // Khoá dòng ví tới hết transaction: lần đối soát song song phải chờ và đọc số dư đã có điều chỉnh.
  await tx.execute(sql`select 1 from ledger_account where id = ${account.id} for update`);
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
