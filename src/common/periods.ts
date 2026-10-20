import { DomainError } from './domain-error.js';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const DAY_MS = 86_400_000;

export function parseMonth(input: string, field = 'month'): string {
  if (!MONTH.test(input)) throw new DomainError('VALIDATION_ERROR', `${field} phải có dạng YYYY-MM (nhận "${input}").`);
  return input;
}

export function monthOf(date: string): string {
  return date.slice(0, 7);
}

function splitMonth(month: string): [number, number] {
  const [year, monthNumber] = month.split('-').map(Number);
  return [year!, monthNumber!];
}

export function addMonths(month: string, delta: number): string {
  const [year, monthNumber] = splitMonth(month);
  return new Date(Date.UTC(year, monthNumber - 1 + delta, 1)).toISOString().slice(0, 7);
}

export function daysInMonth(month: string): number {
  const [year, monthNumber] = splitMonth(month);
  return new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
}

export function monthRange(month: string): { from: string; to: string } {
  return { from: `${month}-01`, to: `${month}-${String(daysInMonth(month)).padStart(2, '0')}` };
}

export function addDays(date: string, delta: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + delta * DAY_MS).toISOString().slice(0, 10);
}

function monthsBetween(from: string, to: string): number {
  const [fromYear, fromMonth] = splitMonth(from);
  const [toYear, toMonth] = splitMonth(to);
  return (toYear - fromYear) * 12 + (toMonth - fromMonth);
}

/** Kỳ liền trước: khoảng phủ trọn tháng → lùi đúng số tháng đó; khoảng bất kỳ → lùi cùng số ngày. */
export function previousPeriod(from: string, to: string): { from: string; to: string } {
  const wholeMonths = from.endsWith('-01') && to === monthRange(monthOf(to)).to;
  if (wholeMonths) {
    const span = monthsBetween(monthOf(from), monthOf(to)) + 1;
    return {
      from: `${addMonths(monthOf(from), -span)}-01`,
      to: monthRange(addMonths(monthOf(to), -span)).to,
    };
  }
  const length = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1;
  return { from: addDays(from, -length), to: addDays(from, -1) };
}

/** Tháng mặc định để tổng kết: 7 ngày đầu tháng → tháng trước, còn lại → tháng hiện tại. */
export function reviewMonth(today: string): string {
  return Number(today.slice(8, 10)) <= 7 ? addMonths(monthOf(today), -1) : monthOf(today);
}
