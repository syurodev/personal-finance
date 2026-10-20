import { DomainError } from './domain-error.js';

/** Trim; chuỗi rỗng/undefined/null → null; giới hạn độ dài. */
export function cleanText(value: string | null | undefined, field: string, max = 500): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  if (trimmed.length > max) throw new DomainError('VALIDATION_ERROR', `${field} dài tối đa ${max} ký tự.`);
  return trimmed;
}

export function requireName(value: string, field = 'name', max = 100): string {
  const name = value.trim().replace(/\s+/g, ' ');
  if (name === '') throw new DomainError('VALIDATION_ERROR', `${field} không được để trống.`);
  if (name.length > max) throw new DomainError('VALIDATION_ERROR', `${field} dài tối đa ${max} ký tự.`);
  return name;
}
