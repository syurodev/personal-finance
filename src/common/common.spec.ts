import { assertDateRange, parseIsoDate, todayIn } from './dates.js';
import { cleanText, requireName } from './text.js';

describe('todayIn', () => {
  const instant = new Date('2026-10-19T18:30:00Z');

  it('uses the given time zone', () => {
    expect(todayIn('Asia/Ho_Chi_Minh', instant)).toBe('2026-10-20');
    expect(todayIn('UTC', instant)).toBe('2026-10-19');
  });
});

describe('parseIsoDate', () => {
  it('accepts a real date', () => {
    expect(parseIsoDate('2026-02-28', 'occurred_on')).toBe('2026-02-28');
  });

  it.each(['2026-02-30', '2026-1-5', '20/10/2026', ''])('rejects %j', (input) => {
    expect(() => parseIsoDate(input, 'occurred_on')).toThrow(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
  });
});

describe('assertDateRange', () => {
  it('rejects from after to', () => {
    expect(() => assertDateRange('2026-10-02', '2026-10-01')).toThrow(
      expect.objectContaining({ code: 'INVALID_DATE_RANGE' }),
    );
    expect(() => assertDateRange('2026-10-01', undefined)).not.toThrow();
  });
});

describe('text helpers', () => {
  it('cleanText trims and maps blank to null', () => {
    expect(cleanText('  Phở  ', 'description')).toBe('Phở');
    expect(cleanText('   ', 'description')).toBeNull();
    expect(cleanText(undefined, 'description')).toBeNull();
    expect(() => cleanText('x'.repeat(501), 'description')).toThrow(
      expect.objectContaining({ code: 'VALIDATION_ERROR' }),
    );
  });

  it('requireName collapses whitespace and rejects blank', () => {
    expect(requireName('  Ví   Momo ')).toBe('Ví Momo');
    expect(() => requireName('  ')).toThrow(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
  });
});
