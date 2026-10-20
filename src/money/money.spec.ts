import { parseCurrency } from './currency.js';
import { formatAmount, parseAmount, parsePositiveDecimal } from './money.js';

describe('parseCurrency', () => {
  it('normalises case', () => {
    expect(parseCurrency(' usd ')).toBe('USD');
  });

  it.each(['XYZ', 'toString', ''])('rejects %j', (code) => {
    expect(() => parseCurrency(code)).toThrow(expect.objectContaining({ code: 'UNSUPPORTED_CURRENCY' }));
  });
});

describe('parseAmount', () => {
  it('parses whole VND and decimal USD', () => {
    expect(parseAmount('85000', 'VND').toFixed()).toBe('85000');
    expect(parseAmount(' 12.34 ', 'USD').toFixed()).toBe('12.34');
  });

  it.each([
    ['85.5', 'VND'],
    ['12.345', 'USD'],
  ] as const)('rejects %s %s with too many decimals', (input, currency) => {
    expect(() => parseAmount(input, currency)).toThrow(expect.objectContaining({ code: 'INVALID_AMOUNT_SCALE' }));
  });

  it.each(['85,000', '85k', 'abc', '', '1e5', '-5', '0'])('rejects %j', (input) => {
    expect(() => parseAmount(input, 'VND')).toThrow(expect.objectContaining({ code: 'INVALID_AMOUNT' }));
  });

  it('accepts negative and zero only when allowed', () => {
    expect(parseAmount('-500', 'VND', { allowNegative: true }).toFixed()).toBe('-500');
    expect(parseAmount('0', 'VND', { allowZero: true }).toFixed()).toBe('0');
  });
});

describe('formatAmount', () => {
  it('pads to the currency scale', () => {
    expect(formatAmount('12.3', 'USD')).toBe('12.30');
    expect(formatAmount('-85000', 'VND')).toBe('-85000');
  });
});

describe('parsePositiveDecimal', () => {
  it('accepts a positive decimal and rejects junk', () => {
    expect(parsePositiveDecimal('100.5', 'min_amount').toFixed()).toBe('100.5');
    expect(() => parsePositiveDecimal('abc', 'min_amount')).toThrow(
      expect.objectContaining({ code: 'VALIDATION_ERROR' }),
    );
  });
});
