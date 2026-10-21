import { Decimal } from 'decimal.js';
import { parseIsoDate, todayIn } from '../common/dates.js';
import { monthOf } from '../common/periods.js';
import { type Currency, parseCurrency } from '../money/currency.js';
import { formatAmount } from '../money/money.js';
import { accountBalances, loadAccounts, toAccountView } from './accounts.js';
import { getBudgetStatus } from './budgets.js';
import { categoryTree } from './categories.js';
import { getUserSettings } from './user-settings.js';
import { debtSummary } from '../loans/loans.js';
import type { DebtSummary } from '../loans/views.js';
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
  /** Nợ và khoản cho vay đang chạy; null nếu không có khoản vay. */
  debts: DebtSummary | null;
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
    debts: await debtSummary(date),
  };
}
