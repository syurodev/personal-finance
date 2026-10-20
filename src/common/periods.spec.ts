import {
  addDays,
  addMonths,
  daysInMonth,
  monthOf,
  monthRange,
  parseMonth,
  previousPeriod,
  reviewMonth,
} from './periods.js';

describe('periods', () => {
  it('parses months', () => {
    expect(parseMonth('2026-10')).toBe('2026-10');
    expect(() => parseMonth('2026-13')).toThrow(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
    expect(() => parseMonth('2026-1')).toThrow(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
  });

  it('does month arithmetic across years', () => {
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(addMonths('2026-10', 3)).toBe('2027-01');
    expect(monthOf('2026-10-20')).toBe('2026-10');
  });

  it('knows month lengths including leap years', () => {
    expect(daysInMonth('2026-02')).toBe(28);
    expect(daysInMonth('2028-02')).toBe(29);
    expect(monthRange('2026-09')).toEqual({ from: '2026-09-01', to: '2026-09-30' });
  });

  it('adds days across month boundaries', () => {
    expect(addDays('2026-10-01', -1)).toBe('2026-09-30');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('previous period of whole months is the previous whole months', () => {
    expect(previousPeriod('2026-10-01', '2026-10-31')).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(previousPeriod('2026-03-01', '2026-03-31')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(previousPeriod('2026-09-01', '2026-10-31')).toEqual({ from: '2026-07-01', to: '2026-08-31' });
  });

  it('previous period of an arbitrary range has the same length', () => {
    expect(previousPeriod('2026-10-10', '2026-10-16')).toEqual({ from: '2026-10-03', to: '2026-10-09' });
  });

  it('review month is last month during the first week, otherwise this month', () => {
    expect(reviewMonth('2026-10-05')).toBe('2026-09');
    expect(reviewMonth('2026-10-20')).toBe('2026-10');
  });
});
