import { describe, expect, it } from 'vitest';
import { buildPayrollTrend, momChange, rollingAverage } from './payrollTrend.js';

// ─── buildPayrollTrend ────────────────────────────────────────────────────────

describe('buildPayrollTrend', () => {
  it('sorts unordered periods ascending by YYYY-MM and computes delta', () => {
    const periods = [
      { period: '2026-03', cashTotal: 30000, employerCostTotal: 42000 },
      { period: '2026-01', cashTotal: 28000, employerCostTotal: 40000 },
      { period: '2026-02', cashTotal: 29000, employerCostTotal: 41000 },
    ];
    const out = buildPayrollTrend(periods);
    expect(out.map((p) => p.period)).toEqual(['2026-01', '2026-02', '2026-03']);
    // delta = employerCostTotal - cashTotal (the non-cash employer load)
    expect(out[0].delta).toBe(12000);
    expect(out[2].delta).toBe(12000);
  });

  it('carries a Spanish month label per point', () => {
    const out = buildPayrollTrend([{ period: '2026-04', cashTotal: 1, employerCostTotal: 2 }]);
    expect(out[0].label).toBe('Abril 2026');
  });

  it('yields a single point for a single-period array', () => {
    const out = buildPayrollTrend([{ period: '2026-05', cashTotal: 100, employerCostTotal: 150 }]);
    expect(out).toHaveLength(1);
    expect(out[0].delta).toBe(50);
  });

  it('returns an empty array for empty/nullish input', () => {
    expect(buildPayrollTrend([])).toEqual([]);
    expect(buildPayrollTrend(null)).toEqual([]);
    expect(buildPayrollTrend(undefined)).toEqual([]);
  });

  it('coerces missing totals to 0 (no NaN)', () => {
    const out = buildPayrollTrend([{ period: '2026-06' }]);
    expect(out[0].cashTotal).toBe(0);
    expect(out[0].employerCostTotal).toBe(0);
    expect(out[0].delta).toBe(0);
  });
});

// ─── momChange ────────────────────────────────────────────────────────────────

describe('momChange', () => {
  it('returns null for the first point', () => {
    const series = [
      { cashTotal: 100 },
      { cashTotal: 110 },
    ];
    const out = momChange(series, 'cashTotal');
    expect(out[0]).toBeNull();
  });

  it('computes ((curr-prev)/prev)*100 for a known pair', () => {
    const series = [
      { cashTotal: 100 },
      { cashTotal: 110 },
    ];
    const out = momChange(series, 'cashTotal');
    expect(out[1]).toBeCloseTo(10, 5);
  });

  it('returns a negative pct for a decrease', () => {
    const series = [{ cashTotal: 100 }, { cashTotal: 80 }];
    const out = momChange(series, 'cashTotal');
    expect(out[1]).toBeCloseTo(-20, 5);
  });

  it('returns 0 (not Infinity/NaN) when the previous value is 0', () => {
    const series = [{ cashTotal: 0 }, { cashTotal: 50 }];
    const out = momChange(series, 'cashTotal');
    expect(out[1]).toBe(0);
    expect(Number.isFinite(out[1])).toBe(true);
  });

  it('handles an empty series', () => {
    expect(momChange([], 'cashTotal')).toEqual([]);
  });
});

// ─── rollingAverage ───────────────────────────────────────────────────────────

describe('rollingAverage', () => {
  it('computes a 3-month trailing average over a 4-point series', () => {
    const series = [
      { cashTotal: 10 },
      { cashTotal: 20 },
      { cashTotal: 30 },
      { cashTotal: 60 },
    ];
    const out = rollingAverage(series, 'cashTotal', 3);
    // point 0: avg(10) = 10
    expect(out[0]).toBe(10);
    // point 1: avg(10,20) = 15
    expect(out[1]).toBe(15);
    // point 2: avg(10,20,30) = 20
    expect(out[2]).toBe(20);
    // point 3: avg(20,30,60) = 36.67
    expect(out[3]).toBeCloseTo(36.67, 2);
  });

  it('allows a partial window at the head', () => {
    const series = [{ cashTotal: 100 }, { cashTotal: 200 }];
    const out = rollingAverage(series, 'cashTotal', 3);
    expect(out[0]).toBe(100);
    expect(out[1]).toBe(150);
  });

  it('never throws when the window exceeds the series length', () => {
    const series = [{ cashTotal: 5 }];
    expect(() => rollingAverage(series, 'cashTotal', 12)).not.toThrow();
    expect(rollingAverage(series, 'cashTotal', 12)).toEqual([5]);
  });

  it('handles an empty series', () => {
    expect(rollingAverage([], 'cashTotal', 3)).toEqual([]);
  });
});
