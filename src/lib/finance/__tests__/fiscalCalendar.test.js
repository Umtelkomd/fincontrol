import { describe, expect, it } from 'vitest';
import {
  netWagesDate,
  socialSecurityDueDate,
  vatDueDate,
  wageTaxDueDate,
} from '../fiscalCalendar.js';

// ─── socialSecurityDueDate — third-to-last bank business day of month M ───────

describe('socialSecurityDueDate', () => {
  it('matches the real SV Faelligkeit dates', () => {
    expect(socialSecurityDueDate('2026-05')).toBe('2026-05-27');
    expect(socialSecurityDueDate('2026-06')).toBe('2026-06-26');
    expect(socialSecurityDueDate('2026-04')).toBe('2026-04-28');
  });

  it('honors December bank closures', () => {
    expect(socialSecurityDueDate('2026-12')).toBe('2026-12-28');
  });

  it('returns null for invalid month keys', () => {
    expect(socialSecurityDueDate('2026-13')).toBeNull();
    expect(socialSecurityDueDate(null)).toBeNull();
  });
});

// ─── vatDueDate — Dauerfristverlaengerung: 10th of M+2, shifted forward ───────

describe('vatDueDate', () => {
  it('is due the 10th two months later (May 2026 VAT → 2026-07-10)', () => {
    expect(vatDueDate('2026-05')).toBe('2026-07-10');
  });

  it('shifts to the next bank business day when the 10th is not one', () => {
    // March 2026 VAT → 2026-05-10 is a Sunday → Monday 2026-05-11.
    expect(vatDueDate('2026-03')).toBe('2026-05-11');
  });

  it('rolls into the next year', () => {
    // November 2026 VAT → 2027-01-10 is a Sunday → Monday 2027-01-11.
    expect(vatDueDate('2026-11')).toBe('2027-01-11');
  });

  it('returns null for invalid month keys', () => {
    expect(vatDueDate('')).toBeNull();
    expect(vatDueDate('2026-00')).toBeNull();
  });
});

// ─── wageTaxDueDate — Lohnsteuer: 10th of M+1, shifted forward ────────────────

describe('wageTaxDueDate', () => {
  it('is due the 10th of the following month when that is a business day', () => {
    expect(wageTaxDueDate('2026-01')).toBe('2026-02-10');
  });

  it('shifts to the next bank business day when the 10th is not one', () => {
    // April 2026 wage tax → 2026-05-10 is a Sunday → Monday 2026-05-11.
    expect(wageTaxDueDate('2026-04')).toBe('2026-05-11');
  });

  it('rolls a December period into the next year', () => {
    expect(wageTaxDueDate('2026-12')).toBe('2027-01-11');
  });

  it('returns null for invalid month keys', () => {
    expect(wageTaxDueDate(undefined)).toBeNull();
  });
});

// ─── netWagesDate — last bank business day of month M ─────────────────────────

describe('netWagesDate', () => {
  it('returns the last bank business day of the wage month', () => {
    expect(netWagesDate('2026-04')).toBe('2026-04-30');
    expect(netWagesDate('2026-05')).toBe('2026-05-29'); // 30/31 May 2026 = weekend
  });

  it('returns null for invalid month keys', () => {
    expect(netWagesDate('nope')).toBeNull();
  });
});
