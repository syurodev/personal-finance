import { asc, count, eq } from 'drizzle-orm';
import { recordAudit } from '../audit/audit.js';
import { DomainError } from '../common/domain-error.js';
import { requireName } from '../common/text.js';
import { currentContext } from '../db/request-context.js';
import { category, type CategoryKind } from '../db/schema/index.js';
import { normalizeName } from './normalize.js';
import { resolveByName } from './resolver.js';
import type { CategoryNode, CategoryView } from './views.js';

export type CategoryRow = typeof category.$inferSelect;

export const DEFAULT_CATEGORIES: Record<CategoryKind, readonly string[]> = {
  expense: [
    'Ăn uống',
    'Đi lại',
    'Nhà ở',
    'Hoá đơn & tiện ích',
    'Mua sắm',
    'Giải trí',
    'Sức khoẻ',
    'Giáo dục',
    'Gia đình',
    'Quà tặng & từ thiện',
    'Khác',
  ],
  income: ['Lương', 'Thưởng', 'Lãi & đầu tư', 'Thu khác'],
};

const KIND_LABEL: Record<CategoryKind, string> = { expense: 'chi', income: 'thu' };

/** Tạo danh mục mặc định nếu user chưa có danh mục nào. Trả về số danh mục đã tạo. */
export async function seedDefaultCategories(): Promise<number> {
  const { tx, userId } = currentContext();
  const [existing] = await tx.select({ value: count() }).from(category);
  if ((existing?.value ?? 0) > 0) return 0;
  const rows = (Object.entries(DEFAULT_CATEGORIES) as Array<[CategoryKind, readonly string[]]>).flatMap(
    ([kind, names]) => names.map((name) => ({ userId, kind, name })),
  );
  await tx.insert(category).values(rows);
  return rows.length;
}

export async function loadCategories(options: { includeArchived?: boolean } = {}): Promise<CategoryRow[]> {
  const { tx } = currentContext();
  const rows = await tx.select().from(category).orderBy(asc(category.createdAt), asc(category.id));
  return options.includeArchived ? rows : rows.filter((row) => row.archivedAt === null);
}

/** Tìm danh mục đang dùng; nếu biết kind mà tên thuộc kind kia → CATEGORY_KIND_MISMATCH. */
export async function resolveCategory(ref: string, kind?: CategoryKind): Promise<CategoryRow> {
  const all = await loadCategories();
  try {
    return resolveByName(
      all.filter((row) => !kind || row.kind === kind),
      ref,
      'CATEGORY',
    );
  } catch (error) {
    if (!kind || !(error instanceof DomainError) || error.code !== 'CATEGORY_NOT_FOUND') throw error;
    let other: CategoryRow;
    try {
      other = resolveByName(
        all.filter((row) => row.kind !== kind),
        ref,
        'CATEGORY',
      );
    } catch {
      throw error;
    }
    throw new DomainError(
      'CATEGORY_KIND_MISMATCH',
      `Danh mục "${other.name}" là danh mục ${KIND_LABEL[other.kind]}, không dùng cho khoản ${KIND_LABEL[kind]}.`,
    );
  }
}

export function toCategoryView(row: CategoryRow): CategoryView {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    parent_id: row.parentId,
    archived: row.archivedAt !== null,
  };
}

/** Danh mục cấp 1 (đang dùng) kèm danh mục con. */
export async function categoryTree(): Promise<CategoryNode[]> {
  const rows = await loadCategories();
  return rows
    .filter((row) => row.parentId === null)
    .map((parent) => ({
      id: parent.id,
      name: parent.name,
      kind: parent.kind,
      children: rows.filter((row) => row.parentId === parent.id).map(({ id, name }) => ({ id, name })),
    }));
}

/** Id của danh mục và các danh mục con (kể cả đã lưu trữ — giao dịch cũ vẫn thuộc về chúng). */
export async function descendantIds(categoryId: string): Promise<string[]> {
  const rows = await loadCategories({ includeArchived: true });
  return [categoryId, ...rows.filter((row) => row.parentId === categoryId).map((row) => row.id)];
}

async function resolveParent(ref: string, kind: CategoryKind, selfId?: string): Promise<CategoryRow> {
  const parent = await resolveCategory(ref, kind);
  if (parent.id === selfId) throw new DomainError('VALIDATION_ERROR', 'Danh mục không thể là cha của chính nó.');
  if (parent.parentId !== null) {
    throw new DomainError('VALIDATION_ERROR', 'Chỉ hỗ trợ 2 cấp danh mục: danh mục cha phải là danh mục cấp 1.');
  }
  return parent;
}

async function assertNameFree(name: string, kind: CategoryKind, parentId: string | null, exceptId?: string) {
  const key = normalizeName(name);
  const clash = (await loadCategories()).find(
    (row) => row.id !== exceptId && row.kind === kind && row.parentId === parentId && normalizeName(row.name) === key,
  );
  if (clash) throw new DomainError('DUPLICATE_NAME', `Đã có danh mục "${clash.name}" cùng cấp.`, { id: clash.id });
}

export async function createCategory(input: { name: string; kind: CategoryKind; parent?: string }): Promise<CategoryView> {
  const { tx, userId } = currentContext();
  const name = requireName(input.name);
  const parent = input.parent ? await resolveParent(input.parent, input.kind) : null;
  await assertNameFree(name, input.kind, parent?.id ?? null);
  const [row] = await tx
    .insert(category)
    .values({ userId, kind: input.kind, name, parentId: parent?.id ?? null })
    .returning();
  await recordAudit('category.create', 'category', [row!.id]);
  return toCategoryView(row!);
}

export async function updateCategory(
  ref: string,
  patch: { name?: string; parent?: string | null; archived?: boolean },
): Promise<CategoryView> {
  const { tx } = currentContext();
  const all = await loadCategories({ includeArchived: true });
  const current = resolveByName(all, ref, 'CATEGORY');
  const name = patch.name !== undefined ? requireName(patch.name) : current.name;

  let parentId = current.parentId;
  if (patch.parent === null) {
    parentId = null;
  } else if (patch.parent !== undefined) {
    if (all.some((row) => row.parentId === current.id)) {
      throw new DomainError('VALIDATION_ERROR', `"${current.name}" đang có danh mục con nên không thể làm danh mục con.`);
    }
    parentId = (await resolveParent(patch.parent, current.kind, current.id)).id;
  }

  const willBeActive = patch.archived === undefined ? current.archivedAt === null : !patch.archived;
  if (willBeActive) await assertNameFree(name, current.kind, parentId, current.id);

  const [row] = await tx
    .update(category)
    .set({
      name,
      parentId,
      ...(patch.archived !== undefined ? { archivedAt: patch.archived ? new Date() : null } : {}),
    })
    .where(eq(category.id, current.id))
    .returning();
  await recordAudit('category.update', 'category', [row!.id]);
  return toCategoryView(row!);
}
