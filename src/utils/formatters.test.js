import { describe, expect, it } from 'vitest';
import { computeNetFromGross, computeTaxFromGross } from './formatters';

describe('computeNetFromGross', () => {
  it('returns exact 100 for gross=119 at 19% (no floating-point drift)', () => {
    expect(computeNetFromGross(119, 0.19)).toBe(100);
  });

  it('handles 7% VAT', () => {
    expect(computeNetFromGross(107, 0.07)).toBe(100);
  });

  it('returns grossAmount unchanged when rate is 0', () => {
    expect(computeNetFromGross(100, 0)).toBe(100);
  });

  it('defaults to 19% when taxRate is null', () => {
    expect(computeNetFromGross(119, null)).toBe(100);
  });

  it('defaults to 19% when taxRate is undefined', () => {
    expect(computeNetFromGross(119, undefined)).toBe(100);
  });

  it('rounds to 2 decimal places', () => {
    // 50 / 1.19 = 42.0168… → 42.02
    expect(computeNetFromGross(50, 0.19)).toBe(42.02);
  });
});

describe('computeTaxFromGross', () => {
  it('returns exact 19 for gross=119 at 19%', () => {
    expect(computeTaxFromGross(119, 0.19)).toBe(19);
  });

  it('returns exact 7 for gross=107 at 7%', () => {
    expect(computeTaxFromGross(107, 0.07)).toBe(7);
  });

  it('returns 0 when rate is 0', () => {
    expect(computeTaxFromGross(100, 0)).toBe(0);
  });

  it('defaults to 19% when taxRate is null', () => {
    expect(computeTaxFromGross(119, null)).toBe(19);
  });

  it('rounds to 2 decimal places', () => {
    // gross=50, net=42.02, tax=7.98
    expect(computeTaxFromGross(50, 0.19)).toBe(7.98);
  });
});
