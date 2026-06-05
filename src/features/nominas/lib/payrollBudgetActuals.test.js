import { describe, expect, it } from 'vitest';
import { buildPayrollBudgetActuals } from './payrollBudgetActuals.js';

describe('buildPayrollBudgetActuals', () => {
  it('buckets each period cashTotal into Salarios|expense|monthIdx for the selected year', () => {
    const periods = [
      { period: '2026-01', cashTotal: 30000, employerCostTotal: 42000 },
      { period: '2026-02', cashTotal: 31000, employerCostTotal: 43000 },
    ];
    const out = buildPayrollBudgetActuals({ periods, year: 2026 });
    expect(out.get('Salarios|expense|0')).toBe(30000);
    expect(out.get('Salarios|expense|1')).toBe(31000);
  });

  it('excludes periods outside the selected year', () => {
    const periods = [
      { period: '2025-12', cashTotal: 29000 },
      { period: '2026-01', cashTotal: 30000 },
    ];
    const out = buildPayrollBudgetActuals({ periods, year: 2026 });
    expect(out.get('Salarios|expense|0')).toBe(30000);
    expect([...out.keys()].some((k) => k.endsWith('|11'))).toBe(false);
  });

  it('can use employerCostTotal as the basis when requested', () => {
    const periods = [{ period: '2026-01', cashTotal: 30000, employerCostTotal: 42000 }];
    const out = buildPayrollBudgetActuals({ periods, year: 2026, basis: 'employerCostTotal' });
    expect(out.get('Salarios|expense|0')).toBe(42000);
  });

  it('sums multiple periods that fall in the same month (defensive)', () => {
    const periods = [
      { period: '2026-03', cashTotal: 10000 },
      { period: '2026-03', cashTotal: 5000 },
    ];
    const out = buildPayrollBudgetActuals({ periods, year: 2026 });
    expect(out.get('Salarios|expense|2')).toBe(15000);
  });

  it('returns an empty Map for empty/nullish input', () => {
    expect(buildPayrollBudgetActuals({ periods: [], year: 2026 }).size).toBe(0);
    expect(buildPayrollBudgetActuals({ periods: null, year: 2026 }).size).toBe(0);
  });
});
