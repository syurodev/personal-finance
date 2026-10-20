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
