import { describe, expect, it } from 'vitest';
import { payrollAsPctOfRevenue, sumPayrollCash } from './payrollKpi.js';

describe('payrollAsPctOfRevenue', () => {
  it('computes payrollCost/revenue*100 for a known pair', () => {
    const out = payrollAsPctOfRevenue({ payrollCost: 30000, revenue: 100000 });
    expect(out.pct).toBeCloseTo(30, 5);
    expect(out.ratio).toBeCloseTo(0.3, 5);
  });

  it('returns pct null when revenue is 0 (no divide-by-zero)', () => {
    const out = payrollAsPctOfRevenue({ payrollCost: 30000, revenue: 0 });
    expect(out.pct).toBeNull();
    expect(out.ratio).toBeNull();
  });

  it('returns pct null when revenue is negative', () => {
    const out = payrollAsPctOfRevenue({ payrollCost: 30000, revenue: -5000 });
    expect(out.pct).toBeNull();
  });

  it('handles a zero payroll cost', () => {
    const out = payrollAsPctOfRevenue({ payrollCost: 0, revenue: 100000 });
    expect(out.pct).toBe(0);
  });
});

describe('sumPayrollCash', () => {
  it('totals cashTotal across all periods when no window is given', () => {
    const periods = [
      { period: '2026-01', cashTotal: 1000 },
      { period: '2026-02', cashTotal: 2000 },
    ];
    expect(sumPayrollCash(periods)).toBe(3000);
  });

  it('limits the total to the supplied month keys', () => {
    const periods = [
      { period: '2026-01', cashTotal: 1000 },
      { period: '2026-02', cashTotal: 2000 },
      { period: '2026-03', cashTotal: 4000 },
    ];
    expect(sumPayrollCash(periods, ['2026-02', '2026-03'])).toBe(6000);
  });

  it('returns 0 for empty/nullish input', () => {
    expect(sumPayrollCash([])).toBe(0);
    expect(sumPayrollCash(null)).toBe(0);
  });
});
