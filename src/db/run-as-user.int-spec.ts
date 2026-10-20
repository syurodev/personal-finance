import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { db, pool } from './index.js';
import { currentContext } from './request-context.js';
import { runAsUser } from './run-as-user.js';
import { auditLog, user } from './schema/index.js';

async function createUser(): Promise<string> {
  const id = randomUUID();
  // Bảng user không bật RLS: tạo trực tiếp cho test.
  await db.insert(user).values({
    id,
    name: 'Test',
    email: `${id}@example.com`,
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return id;
}

const actor = (userId: string) => ({ userId, clientId: 'test-client', scopes: [] as string[] });

describe('runAsUser + RLS', () => {
  let alice: string;
  let bob: string;

  beforeAll(async () => {
    alice = await createUser();
    bob = await createUser();
    await runAsUser(db, actor(alice), async () => {
      await currentContext().tx.insert(auditLog).values({ userId: alice, action: 'test', entity: 'probe' });
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  it('exposes the actor and sets app.user_id inside the transaction', async () => {
    await runAsUser(db, actor(alice), async () => {
      const { tx, userId } = currentContext();
      const result = await tx.execute<{ value: string }>(sql`select current_setting('app.user_id', true) as value`);
      expect(userId).toBe(alice);
      expect(result.rows[0]?.value).toBe(alice);
    });
  });

  it('lets a user read their own rows', async () => {
    const rows = await runAsUser(db, actor(alice), () => currentContext().tx.select().from(auditLog));
    expect(rows.map((r) => r.userId)).toEqual([alice]);
  });

  it('hides other users rows even without a WHERE clause', async () => {
    const rows = await runAsUser(db, actor(bob), () => currentContext().tx.select().from(auditLog));
    expect(rows).toEqual([]);
  });

  it('returns no rows when no user context is set (fail closed)', async () => {
    const rows = await db.select().from(auditLog);
    expect(rows).toEqual([]);
  });

  it('rejects writing a row for another user', async () => {
    // Drizzle bọc lỗi của Postgres trong "Failed query: …", nội dung thật nằm ở `cause`.
    await expect(
      runAsUser(db, actor(bob), async () => {
        await currentContext().tx.insert(auditLog).values({ userId: alice, action: 'x', entity: 'probe' });
      }),
    ).rejects.toMatchObject({
      cause: { message: expect.stringMatching(/row-level security/) },
    });
  });
});
