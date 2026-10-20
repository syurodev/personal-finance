/** Khoá so khớp tên: bỏ dấu tiếng Việt, đ→d, lowercase, gộp khoảng trắng. */
export function normalizeName(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}
