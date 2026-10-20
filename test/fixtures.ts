import { randomUUID } from 'node:crypto';
import { FINANCE_READ, FINANCE_WRITE } from '../src/auth/constants.js';
import { db } from '../src/db/index.js';
import { runAsUser } from '../src/db/run-as-user.js';
import { user } from '../src/db/schema/index.js';
import { seedDefaultCategories } from '../src/ledger/categories.js';

/** Chạy fn như một request MCP của user (có cả quyền đọc và ghi). */
export function asUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  return runAsUser(db, { userId, clientId: 'test-client', scopes: [FINANCE_READ, FINANCE_WRITE] }, fn);
}

/** Tạo user trực tiếp trong DB (bỏ qua better-auth), mặc định seed danh mục. */
export async function createTestUser(options: { seed?: boolean } = {}): Promise<string> {
  const id = randomUUID();
  await db.insert(user).values({
    id,
    name: 'Test',
    email: `${id}@example.com`,
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  if (options.seed !== false) await asUser(id, () => seedDefaultCategories());
  return id;
}
