import { addOneMonth, dueDates, splitEvenly } from './schedule.js';

const strings = (values: Array<{ toFixed(): string }>) => values.map((v) => v.toFixed());

describe('splitEvenly', () => {
  it('splits evenly and gives the remainder to the last period', () => {
    expect(strings(splitEvenly('24000000', 12, 'VND'))).toEqual(Array(12).fill('2000000'));
    expect(strings(splitEvenly('10000000', 3, 'VND'))).toEqual(['3333333', '3333333', '3333334']);
  });

  it('respects the currency scale', () => {
    expect(strings(splitEvenly('1000', 3, 'USD'))).toEqual(['333.33', '333.33', '333.34']);
  });

  it('handles a single period', () => {
    expect(strings(splitEvenly('5000000', 1, 'VND'))).toEqual(['5000000']);
  });
});

describe('due dates', () => {
  it('keeps the day of month and clamps to month end', () => {
    expect(dueDates('2026-01-31', 3)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
    expect(dueDates('2026-11-15', 3)).toEqual(['2026-11-15', '2026-12-15', '2027-01-15']);
    expect(addOneMonth('2026-07-15')).toBe('2026-08-15');
    expect(addOneMonth('2026-01-31')).toBe('2026-02-28');
  });
});
