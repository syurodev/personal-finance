import { count, eq } from 'drizzle-orm';
import { asUser } from '../../test/fixtures.js';
import { db, pool } from '../db/index.js';
import { currentContext } from '../db/request-context.js';
import { category, user } from '../db/schema/index.js';
import { auth } from './auth.js';

describe('sign-up allowlist', () => {
  afterAll(async () => {
    await pool.end();
  });

  it('rejects an email that is not allowlisted', async () => {
    await expect(
      auth.api.signUpEmail({
        body: { name: 'Stranger', email: 'stranger@example.com', password: 'password-123' },
      }),
    ).rejects.toThrow(/không được phép/);
  });

  it('creates an allowlisted user with default currency and timezone', async () => {
    await auth.api.signUpEmail({
      body: { name: 'Owner', email: 'allowed@example.com', password: 'password-123' },
    });
    const [row] = await db.select().from(user).where(eq(user.email, 'allowed@example.com'));
    expect(row?.baseCurrency).toBe('VND');
    expect(row?.timezone).toBe('Asia/Ho_Chi_Minh');

    const [categories] = await asUser(row!.id, () =>
      currentContext().tx.select({ value: count() }).from(category),
    );
    expect(categories?.value).toBe(15);
  });
});
