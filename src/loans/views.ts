import type { LoanDirection, LoanStatus } from '../db/schema/index.js';

export type InstallmentView = {
  seq: number;
  due_date: string;
  amount: string;
  status: 'due' | 'paid' | 'overdue';
  paid_on: string | null;
};

export type LoanSummary = {
  id: string;
  name: string;
  direction: LoanDirection;
  status: LoanStatus;
  currency: string;
  total_payable: string;
  term_months: number;
  start_date: string;
  first_due_date: string;
  account: { id: string; name: string };
  payment_account: { id: string; name: string } | null;
  remaining_amount: string;
  paid_amount: string;
  paid_periods: number;
  remaining_periods: number;
  next_due: InstallmentView | null;
};

export type LoanDetail = LoanSummary & { schedule: InstallmentView[] };

export type UpcomingPayment = InstallmentView & {
  loan: { id: string; name: string };
  direction: LoanDirection;
  currency: string;
};

export type UpcomingPayments = {
  as_of: string;
  until: string;
  items: UpcomingPayment[];
  totals: Array<{ currency: string; direction: LoanDirection; amount: string }>;
  overdue_count: number;
};

export type DebtSummary = {
  items: Array<{ currency: string; borrowed: string; lent: string }>;
  next_due: { loan: string; direction: LoanDirection; due_date: string; amount: string; currency: string } | null;
  overdue_count: number;
};
