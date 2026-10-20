import { count } from 'drizzle-orm';
import { currentContext } from '../db/request-context.js';
import { category, type CategoryKind } from '../db/schema/index.js';

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
