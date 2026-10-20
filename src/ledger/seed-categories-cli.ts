import { db, pool } from '../db/index.js';
import { runAsUser } from '../db/run-as-user.js';
import { user } from '../db/schema/index.js';
import { seedDefaultCategories } from './categories.js';

const users = await db.select({ id: user.id, email: user.email }).from(user);
for (const { id, email } of users) {
  const created = await runAsUser(db, { userId: id, clientId: null, scopes: [] }, () => seedDefaultCategories());
  console.log(`${email}: ${created} categories created`);
}
await pool.end();
