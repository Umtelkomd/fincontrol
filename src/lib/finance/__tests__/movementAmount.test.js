import { describe, expect, it } from 'vitest';
import { isInternalTransfer, signedAmountOf } from '../movementAmount.js';

// ─── signedAmountOf — signedAmount wins only when it is a nonzero number ──────
// Movements imported before May 2026 have NO usable signedAmount (missing or 0)
// and must fall back to direction + amount.

describe('signedAmountOf', () => {
  it('uses a nonzero numeric signedAmount verbatim', () => {
    expect(signedAmountOf({ signedAmount: -250.5, direction: 'in', amount: 250.5 })).toBe(-250.5);
    expect(signedAmountOf({ signedAmount: 1200, direction: 'out', amount: 1200 })).toBe(1200);
  });

  it('falls back to direction+amount when signedAmount is 0 (legacy imports)', () => {
    expect(signedAmountOf({ signedAmount: 0, direction: 'out', amount: 99.9 })).toBe(-99.9);
    expect(signedAmountOf({ signedAmount: 0, direction: 'in', amount: 42 })).toBe(42);
  });

  it('falls back when signedAmount is missing or not a number', () => {
    expect(signedAmountOf({ direction: 'out', amount: 100 })).toBe(-100);
    expect(signedAmountOf({ signedAmount: NaN, direction: 'in', amount: 7 })).toBe(7);
    expect(signedAmountOf({ signedAmount: '-12', direction: 'in', amount: 12 })).toBe(12);
  });

  it('normalizes the fallback with Math.abs on amount', () => {
    expect(signedAmountOf({ direction: 'out', amount: -100 })).toBe(-100);
    expect(signedAmountOf({ direction: 'in', amount: -50 })).toBe(50);
  });

  it('treats any non-"out" direction as inflow (documented fallback rule)', () => {
    expect(signedAmountOf({ amount: 30 })).toBe(30);
    expect(signedAmountOf({ direction: 'unknown', amount: 30 })).toBe(30);
  });

  it('returns 0 for missing amounts or missing movement', () => {
    expect(signedAmountOf({ direction: 'out' })).toBe(0);
    expect(signedAmountOf({ direction: 'out', amount: 'x' })).toBe(0);
    expect(signedAmountOf(null)).toBe(0);
    expect(signedAmountOf(undefined)).toBe(0);
  });
});

// ─── isInternalTransfer — conservative heuristic used to exclude from burn ────

describe('isInternalTransfer', () => {
  it('matches kind === "transfer" (case-insensitive)', () => {
    expect(isInternalTransfer({ kind: 'transfer' })).toBe(true);
    expect(isInternalTransfer({ kind: 'Transfer' })).toBe(true);
  });

  it('matches the company itself as counterparty (own-account transfers)', () => {
    expect(isInternalTransfer({ counterpartyName: 'UMTELKOMD' })).toBe(true);
    expect(isInternalTransfer({ counterpartyName: 'Umtelkomd GmbH' })).toBe(true);
  });

  it('matches the German internal-rebooking keyword as a whole word', () => {
    expect(isInternalTransfer({ description: 'Umbuchung Tagesgeld' })).toBe(true);
    expect(isInternalTransfer({ counterpartyName: 'UMBUCHUNG' })).toBe(true);
  });

  it('stays conservative: ordinary payments never match', () => {
    expect(isInternalTransfer({ kind: 'sepa-credit', description: 'Ueberweisung Miete Juli' })).toBe(false);
    expect(isInternalTransfer({ description: 'Umbuchungsservice GmbH Rechnung' })).toBe(false); // not a whole word
    expect(isInternalTransfer({ counterpartyName: 'Musterkunde AG' })).toBe(false);
    expect(isInternalTransfer({})).toBe(false);
    expect(isInternalTransfer(null)).toBe(false);
  });
});
