import { normalizeName } from './normalize.js';
import { isUuid, resolveByName } from './resolver.js';

const items = [
  { id: '01900000-0000-7000-8000-000000000001', name: 'Tiền mặt' },
  { id: '01900000-0000-7000-8000-000000000002', name: 'Momo' },
  { id: '01900000-0000-7000-8000-000000000003', name: 'Vietcombank' },
  { id: '01900000-0000-7000-8000-000000000004', name: 'Vietinbank' },
];

describe('normalizeName', () => {
  it('strips diacritics, maps đ and collapses whitespace', () => {
    expect(normalizeName('  Đi   Lại ')).toBe('di lai');
    expect(normalizeName('Hoá đơn & Tiện ích')).toBe('hoa don & tien ich');
  });
});

describe('resolveByName', () => {
  it('matches by id', () => {
    expect(resolveByName(items, items[1]!.id, 'ACCOUNT')).toBe(items[1]);
  });

  it('matches exact names without diacritics or case', () => {
    expect(resolveByName(items, 'tien mat', 'ACCOUNT')).toBe(items[0]);
    expect(resolveByName(items, 'MOMO', 'ACCOUNT')).toBe(items[1]);
  });

  it('matches a unique prefix, then a unique substring', () => {
    expect(resolveByName(items, 'vietc', 'ACCOUNT')).toBe(items[2]);
    expect(resolveByName(items, 'tinbank', 'ACCOUNT')).toBe(items[3]);
  });

  it('reports ambiguity with candidates', () => {
    expect(() => resolveByName(items, 'viet', 'ACCOUNT')).toThrow(
      expect.objectContaining({
        code: 'AMBIGUOUS_ACCOUNT',
        details: { candidates: [items[2], items[3]] },
      }),
    );
  });

  it('reports not found with up to 5 suggestions', () => {
    let error: any;
    try {
      resolveByName(items, 'acb', 'CATEGORY');
    } catch (e) {
      error = e;
    }
    expect(error.code).toBe('CATEGORY_NOT_FOUND');
    expect(error.details.suggestions.length).toBeLessThanOrEqual(5);
  });
});

describe('isUuid', () => {
  it('recognises uuids', () => {
    expect(isUuid(items[0]!.id)).toBe(true);
    expect(isUuid('momo')).toBe(false);
  });
});
