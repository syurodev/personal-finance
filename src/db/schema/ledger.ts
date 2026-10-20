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
