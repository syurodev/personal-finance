import { isEmailAllowed } from './allowlist.js';

describe('isEmailAllowed', () => {
  const allowed = new Set(['owner@example.com']);

  it('accepts an allowlisted email regardless of case and whitespace', () => {
    expect(isEmailAllowed('  Owner@Example.COM ', allowed)).toBe(true);
  });

  it('rejects other emails', () => {
    expect(isEmailAllowed('stranger@example.com', allowed)).toBe(false);
  });

  it('rejects everything when the allowlist is empty', () => {
    expect(isEmailAllowed('owner@example.com', new Set())).toBe(false);
  });
});
