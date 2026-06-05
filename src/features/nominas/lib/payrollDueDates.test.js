import { describe, expect, it } from 'vitest';
import {
  krankenkassenDueDate,
  lohnsteuerDueDate,
  netWagesDueDate,
  resolvePayrollDueDates,
} from './payrollDueDates.js';

// ─── krankenkassenDueDate = drittletzter Bankarbeitstag of the period month ────

describe('krankenkassenDueDate', () => {
  it('returns the 3rd-to-last banking day of April 2026', () => {
    expect(krankenkassenDueDate('2026-04')).toBe('2026-04-28');
  });
  it('skips the trailing weekend for May 2026', () => {
    expect(krankenkassenDueDate('2026-05')).toBe('2026-05-27');
  });
  it('skips Silvester, Weihnachten + weekend for December 2026', () => {
    // 24.12 + 31.12 are bank-closed → drittletzter Bankarbeitstag = 2026-12-28.
    expect(krankenkassenDueDate('2026-12')).toBe('2026-12-28');
  });
});

// ─── lohnsteuerDueDate = 10th of the FOLLOWING month, shifted to banking day ───

describe('lohnsteuerDueDate', () => {
  it('returns 2026-05-11 for April 2026 (10th is Sunday → next banking day)', () => {
    // 2026-05-10 is a Sunday → next banking day is Monday 2026-05-11.
    expect(lohnsteuerDueDate('2026-04')).toBe('2026-05-11');
  });
  it('returns the 10th itself when it is a banking day', () => {
    // 2026-02-10 is a Tuesday for January 2026 period.
    expect(lohnsteuerDueDate('2026-01')).toBe('2026-02-10');
  });
  it('rolls a December period into the next year', () => {
    // Jan 10 2027 is a Sunday → next banking day Monday 2027-01-11.
    expect(lohnsteuerDueDate('2026-12')).toBe('2027-01-11');
  });
});

// ─── netWagesDueDate ──────────────────────────────────────────────────────────

describe('netWagesDueDate', () => {
  it('returns the provided transfer date verbatim', () => {
    expect(netWagesDueDate('2026-04', { transferDate: '2026-04-29' })).toBe('2026-04-29');
  });
  it('falls back to the last banking day of the period when no transfer date', () => {
    expect(netWagesDueDate('2026-04')).toBe('2026-04-30');
  });
  it('falls back across a trailing weekend (May 2026 last banking day = Fri 29)', () => {
    expect(netWagesDueDate('2026-05')).toBe('2026-05-29');
  });
});

// ─── resolvePayrollDueDates — PREFERS parsed Fälligkeit, computes only gaps ────

describe('resolvePayrollDueDates', () => {
  it('keeps parsed kk and tax dates untouched, computes only net wages', () => {
    const parsed = {
      krankenkassen: [{ payee: 'BARMER', amount: 100, dueDate: '2026-04-27' }],
      tax: { payee: 'FA', amount: 50, dueDate: '2026-05-11' },
      netWages: { amount: 1000, dueDate: null },
    };
    const out = resolvePayrollDueDates({ period: '2026-04', parsed });
    expect(out.kk).toBe('2026-04-27'); // parsed survives
    expect(out.tax).toBe('2026-05-11'); // parsed survives
    expect(out.netWages).toBe('2026-04-30'); // computed (last banking day)
  });

  it('computes kk and tax when the parsed dates are missing', () => {
    const parsed = {
      krankenkassen: [{ payee: 'BARMER', amount: 100, dueDate: null }],
      tax: { payee: 'FA', amount: 50, dueDate: null },
      netWages: { amount: 1000, dueDate: null },
    };
    const out = resolvePayrollDueDates({ period: '2026-04', parsed });
    expect(out.kk).toBe('2026-04-28'); // drittletzter Bankarbeitstag
    expect(out.tax).toBe('2026-05-11'); // 10th-of-next shifted
    expect(out.netWages).toBe('2026-04-30');
  });

  it('uses an explicit net-wages transfer date when provided', () => {
    const parsed = {
      krankenkassen: [{ payee: 'BARMER', amount: 100, dueDate: '2026-04-27' }],
      tax: { payee: 'FA', amount: 50, dueDate: '2026-05-11' },
      netWages: { amount: 1000, dueDate: '2026-04-29' },
    };
    const out = resolvePayrollDueDates({ period: '2026-04', parsed });
    expect(out.netWages).toBe('2026-04-29');
  });
});
