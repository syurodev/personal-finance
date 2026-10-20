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
