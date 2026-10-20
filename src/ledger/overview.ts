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
