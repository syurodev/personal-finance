import { DomainError } from '../common/domain-error.js';
import { normalizeName } from './normalize.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value.trim());
}

export type Named = { id: string; name: string };
export type ResolvableEntity = 'ACCOUNT' | 'CATEGORY';

const LABEL: Record<ResolvableEntity, string> = { ACCOUNT: 'ví', CATEGORY: 'danh mục' };

/**
 * Tìm bản ghi theo id hoặc tên. Thứ tự: id → tên khớp hẳn → tiền tố duy nhất → chuỗi con duy nhất.
 * Nhiều kết quả → AMBIGUOUS_*; không có → *_NOT_FOUND kèm gợi ý.
 */
export function resolveByName<T extends Named>(items: readonly T[], ref: string, entity: ResolvableEntity): T {
  const trimmed = ref.trim();
  if (isUuid(trimmed)) {
    const byId = items.find((item) => item.id === trimmed);
    if (byId) return byId;
  }

  const needle = normalizeName(trimmed);
  const matchers: Array<(name: string) => boolean> = [
    (name) => name === needle,
    (name) => name.startsWith(needle),
    (name) => name.includes(needle),
  ];
  for (const matches of matchers) {
    const found = items.filter((item) => matches(normalizeName(item.name)));
    if (found.length === 1) return found[0]!;
    if (found.length > 1) {
      throw new DomainError(`AMBIGUOUS_${entity}`, `"${ref}" khớp nhiều ${LABEL[entity]}; hỏi người dùng chọn một rồi truyền id.`, {
        candidates: found.map(({ id, name }) => ({ id, name })),
      });
    }
  }

  throw new DomainError(`${entity}_NOT_FOUND`, `Không tìm thấy ${LABEL[entity]} "${ref}".`, {
    suggestions: suggest(items, needle),
  });
}

function suggest(items: readonly Named[], needle: string): string[] {
  return [...items]
    .map((item) => ({ name: item.name, distance: levenshtein(normalizeName(item.name), needle) }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 5)
    .map((item) => item.name);
}

function levenshtein(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = row[j]!;
      row[j] = Math.min(above + 1, row[j - 1]! + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return row[b.length]!;
}
