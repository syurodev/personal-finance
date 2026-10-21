import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  check,
  date,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { user } from './auth.js';

export const ACCOUNT_TYPES = ['cash', 'bank', 'credit_card', 'ewallet', 'loan'] as const;
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
    check('ledger_account_type_check', sql`${t.type} in ('cash', 'bank', 'credit_card', 'ewallet', 'loan')`),
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

export const LOAN_DIRECTIONS = ['borrow', 'lend'] as const;
export type LoanDirection = (typeof LOAN_DIRECTIONS)[number];

export const LOAN_STATUSES = ['active', 'closed', 'cancelled'] as const;
export type LoanStatus = (typeof LOAN_STATUSES)[number];

export const INSTALLMENT_STATUSES = ['due', 'paid'] as const;

export const loan = pgTable(
  'loan',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    userId: ownerId(),
    name: text('name').notNull(),
    direction: text('direction', { enum: LOAN_DIRECTIONS }).notNull(),
    /** Tổng phải trả ban đầu (đã gồm lãi và phí). */
    totalPayable: numeric('total_payable').notNull(),
    currency: text('currency').notNull(),
    termMonths: integer('term_months').notNull(),
    startDate: date('start_date', { mode: 'string' }).notNull(),
    firstDueDate: date('first_due_date', { mode: 'string' }).notNull(),
    /** Ví nợ (vay: số dư âm) hoặc ví phải thu (cho vay: số dư dương), tự tạo cùng khoản vay. */
    accountId: uuid('account_id')
      .notNull()
      .references(() => ledgerAccount.id, { onDelete: 'restrict' }),
    paymentAccountId: uuid('payment_account_id').references(() => ledgerAccount.id, { onDelete: 'restrict' }),
    disbursementTransactionId: uuid('disbursement_transaction_id').references(() => ledgerTransaction.id, {
      onDelete: 'set null',
    }),
    /** Khoản chi/thu "Lãi & phí vay"/"Lãi cho vay" ghi lúc tạo (tổng phải trả − tiền thực nhận/đưa). */
    costTransactionId: uuid('cost_transaction_id').references(() => ledgerTransaction.id, { onDelete: 'set null' }),
    status: text('status', { enum: LOAN_STATUSES }).notNull().default('active'),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    check('loan_direction_check', sql`${t.direction} in ('borrow', 'lend')`),
    check('loan_status_check', sql`${t.status} in ('active', 'closed', 'cancelled')`),
    check('loan_total_positive', sql`${t.totalPayable} > 0`),
    check('loan_term_range', sql`${t.termMonths} between 1 and 600`),
    uniqueIndex('loan_user_name_uidx')
      .on(t.userId, sql`lower(${t.name})`)
      .where(sql`${t.status} = 'active'`),
  ],
);

export const loanInstallment = pgTable(
  'loan_installment',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    userId: ownerId(),
    loanId: uuid('loan_id')
      .notNull()
      .references(() => loan.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    dueDate: date('due_date', { mode: 'string' }).notNull(),
    amountDue: numeric('amount_due').notNull(),
    status: text('status', { enum: INSTALLMENT_STATUSES }).notNull().default('due'),
    paidOn: date('paid_on', { mode: 'string' }),
    amountPaid: numeric('amount_paid'),
    transferGroupId: uuid('transfer_group_id'),
    ...timestamps(),
  },
  (t) => [
    check('loan_installment_status_check', sql`${t.status} in ('due', 'paid')`),
    check('loan_installment_amount_positive', sql`${t.amountDue} > 0`),
    uniqueIndex('loan_installment_loan_seq_uidx').on(t.loanId, t.seq),
    index('loan_installment_user_due_idx').on(t.userId, t.status, t.dueDate),
  ],
);
