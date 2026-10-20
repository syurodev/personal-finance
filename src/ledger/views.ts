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
