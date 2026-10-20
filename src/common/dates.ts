import { DomainError } from './domain-error.js';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Ngày hiện tại (YYYY-MM-DD) theo múi giờ IANA. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function parseIsoDate(input: string, field: string): string {
  const parsed = new Date(`${input}T00:00:00Z`);
  if (!ISO_DATE.test(input) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== input) {
    throw new DomainError('VALIDATION_ERROR', `${field} phải là ngày có thật dạng YYYY-MM-DD (nhận "${input}").`);
  }
  return input;
}

export function assertDateRange(from: string | undefined, to: string | undefined): void {
  if (from && to && from > to) {
    throw new DomainError('INVALID_DATE_RANGE', `Khoảng ngày không hợp lệ: from (${from}) sau to (${to}).`);
  }
}
