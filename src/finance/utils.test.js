import { describe, expect, it } from 'vitest';

import {
  clampMoney,
  compareIsoDate,
  deriveDocumentStage,
  deriveDocumentStatus,
  getAccountId,
  getCurrency,
  getGrossAmount,
  getOpenAmount,
  getPaidAmount,
  getSignedMovementAmount,
  isOpenDocument,
  isPostedMovement,
  isWithinRange,
  sumMoney,
  toISODate,
} from './utils.js';

describe('finance utils money normalization', () => {
  it('rounds numeric and string-like values to cents', () => {
    expect(clampMoney(12.345)).toBe(12.35);
    expect(clampMoney('19.995')).toBe(20);
    expect(clampMoney(-4.444)).toBe(-4.44);
  });

  it('normalizes nullish and invalid values to zero', () => {
    expect(clampMoney(null)).toBe(0);
    expect(clampMoney(undefined)).toBe(0);
    expect(clampMoney('not-a-number')).toBe(0);
  });
});

describe('finance utils ISO date handling', () => {
  it('keeps ISO date strings stable and trims date-time strings', () => {
    expect(toISODate('2026-04-15')).toBe('2026-04-15');
    expect(toISODate('2026-04-15T22:30:00.000Z')).toBe('2026-04-15');
  });

  it('returns null for empty or invalid dates', () => {
    expect(toISODate('')).toBeNull();
    expect(toISODate('not-a-date')).toBeNull();
    expect(toISODate(new Date('not-a-date'))).toBeNull();
  });

  it('compares and filters fixed ISO ranges deterministically', () => {
    expect(compareIsoDate('2026-04-10', '2026-04-09')).toBeGreaterThan(0);
    expect(isWithinRange('2026-04-15', '2026-04-01', '2026-04-30')).toBe(true);
    expect(isWithinRange('2026-05-01', '2026-04-01', '2026-04-30')).toBe(false);
  });
});

describe('finance utils document amounts', () => {
  it('prefers explicit gross, paid, and open amounts', () => {
    const row = { amount: 100, grossAmount: 119.999, paidAmount: 50.555, openAmount: 69.444 };

    expect(getGrossAmount(row)).toBe(120);
    expect(getPaidAmount(row)).toBe(50.56);
    expect(getOpenAmount(row)).toBe(69.44);
  });

  it('derives paid and open amounts from pending data when explicit values are absent', () => {
    const row = { grossAmount: 200, pendingAmount: 75.126 };

    expect(getPaidAmount(row)).toBe(124.87);
    expect(getOpenAmount(row)).toBe(75.13);
  });

  it('clamps derived open amounts at zero for overpaid documents', () => {
    expect(getOpenAmount({ grossAmount: 100, paidAmount: 140 })).toBe(0);
  });
});

describe('finance utils document stage and status', () => {
  it('settles cancelled, paid, completed, and zero-open documents by current rules', () => {
    expect(deriveDocumentStage('cancelled', 100)).toBe('cancelled');
    expect(deriveDocumentStage('paid', 100)).toBe('settled');
    expect(deriveDocumentStage('completed', 100)).toBe('settled');
    expect(deriveDocumentStage('issued', 0)).toBe('settled');
  });

  it('keeps partial documents partial and defaults open documents to issued', () => {
    expect(deriveDocumentStage('partial', 25)).toBe('partial');
    expect(deriveDocumentStage('', 25)).toBe('issued');
  });

  it('classifies cancelled, settled, overdue, partial, and issued statuses against a fixed date', () => {
    expect(deriveDocumentStatus('cancelled', '2026-04-01', '2026-04-15')).toBe('cancelled');
    expect(deriveDocumentStatus('settled', '2026-04-01', '2026-04-15')).toBe('settled');
    expect(deriveDocumentStatus('issued', '2026-04-01', '2026-04-15')).toBe('overdue');
    expect(deriveDocumentStatus('partial', '2026-04-30', '2026-04-15')).toBe('partial');
    expect(deriveDocumentStatus('issued', '2026-04-30', '2026-04-15')).toBe('issued');
  });

  it('treats only settled and cancelled document statuses as closed', () => {
    expect(isOpenDocument({ status: 'issued' })).toBe(true);
    expect(isOpenDocument({ status: 'overdue' })).toBe(true);
    expect(isOpenDocument({ status: 'settled' })).toBe(false);
    expect(isOpenDocument({ status: 'cancelled' })).toBe(false);
  });
});

describe('finance utils movement and sum helpers', () => {
  it('keeps inbound movement amounts positive and outbound amounts negative', () => {
    expect(getSignedMovementAmount({ direction: 'in', amount: 125.555 })).toBe(125.56);
    expect(getSignedMovementAmount({ direction: 'out', amount: 80.111 })).toBe(-80.11);
  });

  it('recognizes posted movements only', () => {
    expect(isPostedMovement({ status: 'posted' })).toBe(true);
    expect(isPostedMovement({ status: 'void' })).toBe(false);
  });

  it('sums selected money values with final cent rounding', () => {
    const total = sumMoney([
      { direction: 'in', amount: 100.105 },
      { direction: 'out', amount: 40.104 },
      { direction: 'in', amount: 10.005 },
    ], getSignedMovementAmount);

    expect(total).toBe(70.02);
  });

  it('falls back to default currency and main account identifiers', () => {
    expect(getCurrency()).toBe('EUR');
    expect(getCurrency('USD')).toBe('USD');
    expect(getAccountId()).toBe('main');
    expect(getAccountId('bank-2')).toBe('bank-2');
  });
});
