import { currentContext } from '../db/request-context.js';
import { auditLog } from '../db/schema/index.js';

/** Ghi một dòng audit cho mỗi entity bị thay đổi, trong transaction hiện tại. Không lưu payload. */
export async function recordAudit(action: string, entity: string, entityIds: readonly string[]): Promise<void> {
  if (entityIds.length === 0) return;
  const { tx, userId, clientId } = currentContext();
  await tx
    .insert(auditLog)
    .values(entityIds.map((entityId) => ({ userId, actorClientId: clientId, action, entity, entityId })));
}
