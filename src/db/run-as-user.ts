import { sql } from 'drizzle-orm';
import type { Db } from './client.js';
import { type Actor, runInContext } from './request-context.js';

/**
 * Chạy `fn` trong một transaction mà RLS thấy `app.user_id = actor.userId`.
 * Mọi truy vấn domain phải lấy `tx` từ currentContext().
 */
export function runAsUser<T>(db: Db, actor: Actor, fn: () => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.user_id', ${actor.userId}, true)`);
    return runInContext({ ...actor, tx }, fn);
  });
}
