import { buildReviewScript } from './month-end-review.prompt.js';

describe('buildReviewScript', () => {
  it('names the month range and every tool the review uses', () => {
    const script = buildReviewScript('2026-10');
    expect(script).toContain('2026-10-01');
    expect(script).toContain('2026-10-31');
    for (const tool of ['get_overview', 'reconcile_account', 'cashflow_summary', 'get_budget_status', 'search_transactions', 'set_budget', 'list_upcoming_payments']) {
      expect(script).toContain(tool);
    }
  });
});
