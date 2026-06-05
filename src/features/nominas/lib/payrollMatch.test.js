import { describe, expect, it } from 'vitest';
import { scorePayrollMatch, PAYROLL_MATCH_THRESHOLD } from './payrollMatch.js';

const outMovement = (over = {}) => ({
  direction: 'out',
  amount: 7721.08,
  postedDate: '2026-04-28',
  ...over,
});

const kkPayable = (over = {}) => ({
  payrollKind: 'krankenkasse',
  amount: 7721.08,
  openAmount: 7721.08,
  dueDate: '2026-04-28',
  ...over,
});

describe('scorePayrollMatch', () => {
  it('boosts an out-movement matching a payroll payable within the due window to >= threshold', () => {
    const bonus = scorePayrollMatch({ movement: outMovement(), payable: kkPayable() });
    expect(bonus).toBeGreaterThanOrEqual(PAYROLL_MATCH_THRESHOLD - 100);
    // The boost alone, added to the base amount score (100), must reach >= 130.
    expect(100 + bonus).toBeGreaterThanOrEqual(PAYROLL_MATCH_THRESHOLD);
  });

  it('gives no payroll bonus when the amount does not match', () => {
    const bonus = scorePayrollMatch({
      movement: outMovement({ amount: 9999 }),
      payable: kkPayable(),
    });
    expect(bonus).toBe(0);
  });

  it('gives no payroll bonus outside the due window', () => {
    // postedDate far from dueDate (more than the banking-day window)
    const bonus = scorePayrollMatch({
      movement: outMovement({ postedDate: '2026-06-15' }),
      payable: kkPayable(),
    });
    expect(bonus).toBe(0);
  });

  it('gives no bonus for a non-payroll payable', () => {
    const bonus = scorePayrollMatch({
      movement: outMovement(),
      payable: { amount: 7721.08, openAmount: 7721.08, dueDate: '2026-04-28' },
    });
    expect(bonus).toBe(0);
  });

  it('never boosts an in-movement', () => {
    const bonus = scorePayrollMatch({
      movement: outMovement({ direction: 'in' }),
      payable: kkPayable(),
    });
    expect(bonus).toBe(0);
  });

  it('boosts within the window when posted a few banking days before due', () => {
    const bonus = scorePayrollMatch({
      movement: outMovement({ postedDate: '2026-04-24' }),
      payable: kkPayable({ dueDate: '2026-04-28' }),
    });
    expect(bonus).toBeGreaterThan(0);
  });
});
