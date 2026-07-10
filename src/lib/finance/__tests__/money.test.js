import { describe, expect, it } from 'vitest';
import { OPEN_AMOUNT_EPSILON, isOpenAmount, openAmountOf, roundEur } from '../money.js';

// ─── roundEur — 2 decimals, half-up (away from zero), presentation-only ───────

describe('roundEur', () => {
  it('rounds to 2 decimals', () => {
    expect(roundEur(12.344)).toBe(12.34);
    expect(roundEur(70810.891)).toBe(70810.89);
    expect(roundEur(10)).toBe(10);
  });

  it('rounds half up despite binary float representation', () => {
    // Naive Math.round(n * 100) fails on these: 1.005 * 100 === 100.49999…
    expect(roundEur(1.005)).toBe(1.01);
    expect(roundEur(2.675)).toBe(2.68);
    expect(roundEur(12345.675)).toBe(12345.68);
  });

  it('rounds negative halves away from zero (kaufmaennisch)', () => {
    expect(roundEur(-1.005)).toBe(-1.01);
    expect(roundEur(-2.675)).toBe(-2.68);
    expect(roundEur(-4.444)).toBe(-4.44);
  });

  it('keeps clearly-below-half values down', () => {
    expect(roundEur(1.0049)).toBe(1);
    expect(roundEur(-1.0049)).toBe(-1);
  });

  it('normalizes non-finite and non-number input to 0', () => {
    expect(roundEur(NaN)).toBe(0);
    expect(roundEur(Infinity)).toBe(0);
    expect(roundEur(-Infinity)).toBe(0);
    expect(roundEur(undefined)).toBe(0);
    expect(roundEur('12.50')).toBe(0);
  });

  it('never returns negative zero', () => {
    expect(Object.is(roundEur(-0.001), 0)).toBe(true);
    expect(Object.is(roundEur(-0), 0)).toBe(true);
  });
});

// ─── isOpenAmount — floating dust below OPEN_AMOUNT_EPSILON is not open ───────

describe('isOpenAmount', () => {
  it('exposes the shared epsilon used across the engine', () => {
    expect(OPEN_AMOUNT_EPSILON).toBe(0.005);
  });

  it('treats amounts above the epsilon as open', () => {
    expect(isOpenAmount(0.0051)).toBe(true);
    expect(isOpenAmount(1)).toBe(true);
    expect(isOpenAmount(118910.5)).toBe(true);
  });

  it('treats dust, zero, negatives and invalid values as not open', () => {
    expect(isOpenAmount(0.005)).toBe(false);
    expect(isOpenAmount(0.004)).toBe(false);
    expect(isOpenAmount(0)).toBe(false);
    expect(isOpenAmount(-3)).toBe(false);
    expect(isOpenAmount(NaN)).toBe(false);
    expect(isOpenAmount(undefined)).toBe(false);
  });
});

// ─── openAmountOf — default open-amount reader for receivable/payable docs ────

describe('openAmountOf', () => {
  it('reads a finite openAmount', () => {
    expect(openAmountOf({ openAmount: 70.81 })).toBe(70.81);
    expect(openAmountOf({ openAmount: 0 })).toBe(0);
  });

  it('falls back to 0 for missing or invalid openAmount', () => {
    expect(openAmountOf({})).toBe(0);
    expect(openAmountOf({ openAmount: null })).toBe(0);
    expect(openAmountOf({ openAmount: '5' })).toBe(0);
    expect(openAmountOf(null)).toBe(0);
    expect(openAmountOf(undefined)).toBe(0);
  });
});
