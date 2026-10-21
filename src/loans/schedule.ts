import { Decimal } from 'decimal.js';
import { addMonths, daysInMonth, monthOf } from '../common/periods.js';
import { type Currency, currencyScale } from '../money/currency.js';

/** Chia `total` thành `count` kỳ bằng nhau (làm tròn xuống theo currency); kỳ cuối nhận phần dư. */
export function splitEvenly(total: Decimal.Value, count: number, currency: Currency): Decimal[] {
  const amount = new Decimal(total);
  const each = amount.div(count).toDecimalPlaces(currencyScale(currency), Decimal.ROUND_DOWN);
  return Array.from({ length: count }, (_, index) => (index === count - 1 ? amount.minus(each.times(count - 1)) : each));
}

/** Ngày đến hạn của `count` kỳ: cùng ngày trong tháng với kỳ đầu, kẹp về ngày cuối tháng. */
export function dueDates(firstDue: string, count: number): string[] {
  const day = Number(firstDue.slice(8, 10));
  return Array.from({ length: count }, (_, index) => {
    const month = addMonths(monthOf(firstDue), index);
    return `${month}-${String(Math.min(day, daysInMonth(month))).padStart(2, '0')}`;
  });
}

export function addOneMonth(date: string): string {
  return dueDates(date, 2)[1]!;
}
