import { Decimal } from 'decimal.js';
import { DomainError } from '../common/domain-error.js';
import { type Currency, currencyScale } from './currency.js';

const DECIMAL_PATTERN = /^-?\d+(\.\d+)?$/;

export interface AmountOptions {
  allowNegative?: boolean;
  allowZero?: boolean;
}

/** Parse số tiền dạng chuỗi ("85000", "12.34"). Không nhận dấu phẩy, "k", ký hiệu tiền hay số mũ. */
export function parseAmount(input: string, currency: Currency, options: AmountOptions = {}): Decimal {
  const text = input.trim();
  if (!DECIMAL_PATTERN.test(text)) {
    throw new DomainError(
      'INVALID_AMOUNT',
      `Số tiền "${input}" không hợp lệ. Dùng chữ số và dấu chấm thập phân, ví dụ "85000" hoặc "12.34".`,
    );
  }
  const value = new Decimal(text);
  if (value.isZero()) {
    if (!options.allowZero) throw new DomainError('INVALID_AMOUNT', 'Số tiền phải khác 0.');
  } else if (value.isNegative() && !options.allowNegative) {
    throw new DomainError('INVALID_AMOUNT', 'Số tiền phải là số dương; chiều thu/chi do tham số type quyết định.');
  }
  const scale = currencyScale(currency);
  if (value.decimalPlaces() > scale) {
    throw new DomainError(
      'INVALID_AMOUNT_SCALE',
      `${currency} chỉ cho phép ${scale} chữ số thập phân (nhận "${input}").`,
      { currency, max_decimals: scale },
    );
  }
  return value;
}

/** Số dương không gắn currency (dùng cho bộ lọc min/max). */
export function parsePositiveDecimal(input: string, field: string): Decimal {
  const text = input.trim();
  if (!DECIMAL_PATTERN.test(text) || new Decimal(text).isNegative()) {
    throw new DomainError('VALIDATION_ERROR', `${field} phải là số không âm dạng "100000" hoặc "12.5".`);
  }
  return new Decimal(text);
}

export function formatAmount(value: Decimal.Value, currency: Currency): string {
  return new Decimal(value).toFixed(currencyScale(currency));
}
