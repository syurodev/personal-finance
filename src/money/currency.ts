import { DomainError } from '../common/domain-error.js';

/** Số chữ số thập phân (ISO 4217) của các currency hỗ trợ trong MVP. */
export const CURRENCY_SCALE = { VND: 0, USD: 2, EUR: 2, JPY: 0, SGD: 2, THB: 2 } as const;

export type Currency = keyof typeof CURRENCY_SCALE;

export function parseCurrency(code: string): Currency {
  const upper = code.trim().toUpperCase();
  if (!Object.hasOwn(CURRENCY_SCALE, upper)) {
    throw new DomainError(
      'UNSUPPORTED_CURRENCY',
      `Chưa hỗ trợ tiền tệ "${code}". Hỗ trợ: ${Object.keys(CURRENCY_SCALE).join(', ')}.`,
    );
  }
  return upper as Currency;
}

export function currencyScale(currency: Currency): number {
  return CURRENCY_SCALE[currency];
}
