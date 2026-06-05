import { describe, expect, it } from 'vitest';
import { missingPayrollMonths } from './missingMonths.js';

describe('missingPayrollMonths', () => {
  it('returns [] for empty periods', () => {
    expect(missingPayrollMonths([], '2026-06')).toEqual([]);
  });

  it('returns the gap months up to the previous completed month', () => {
    const periods = [{ period: '2026-01' }, { period: '2026-03' }];
    // Upper bound is the previous completed month (current 2026-06 → 2026-05).
    // Missing within 2026-01..2026-05: 02, 04, 05 (06 is in-progress, excluded).
    expect(missingPayrollMonths(periods, '2026-06')).toEqual([
      '2026-02',
      '2026-04',
      '2026-05',
    ]);
  });

  it('returns [] when periods are consecutive up to the current month', () => {
    const periods = [{ period: '2026-04' }, { period: '2026-05' }, { period: '2026-06' }];
    expect(missingPayrollMonths(periods, '2026-06')).toEqual([]);
  });

  it('excludes the in-progress current month (payroll runs at month-end)', () => {
    const periods = [{ period: '2026-04' }, { period: '2026-05' }];
    // current 2026-06 is in progress → upper bound 2026-05 → nothing missing.
    expect(missingPayrollMonths(periods, '2026-06')).toEqual([]);
  });

  it('handles a year boundary (2025-11 .. 2026-02)', () => {
    const periods = [{ period: '2025-11' }, { period: '2026-02' }];
    expect(missingPayrollMonths(periods, '2026-02')).toEqual(['2025-12', '2026-01']);
  });

  it('returns [] when only the current month exists', () => {
    const periods = [{ period: '2026-06' }];
    expect(missingPayrollMonths(periods, '2026-06')).toEqual([]);
  });

  it('accepts raw string periods', () => {
    const periods = ['2026-01', '2026-03'];
    expect(missingPayrollMonths(periods, '2026-03')).toEqual(['2026-02']);
  });
});
