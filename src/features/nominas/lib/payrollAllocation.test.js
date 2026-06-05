import { describe, expect, it } from 'vitest';
import { allocatePayrollCost } from './payrollAllocation.js';

describe('allocatePayrollCost', () => {
  it('sums per-line gesamtkosten into the employee defaultCostCenter bucket', () => {
    const periods = [
      { period: '2026-01', lines: [
        { employeeId: 'e1', gesamtkosten: 2000 },
        { employeeId: 'e2', gesamtkosten: 3000 },
      ] },
    ];
    const employeesById = {
      e1: { id: 'e1', defaultCostCenter: 'CC-OPS', projectIds: [] },
      e2: { id: 'e2', defaultCostCenter: 'CC-OPS', projectIds: [] },
    };
    const out = allocatePayrollCost({ periods, employeesById });
    expect(out.byCostCenter['CC-OPS']).toBe(5000);
  });

  it('falls back to the CC-NOM bucket when an employee has no defaultCostCenter', () => {
    const periods = [
      { period: '2026-01', lines: [{ employeeId: 'e1', gesamtkosten: 1500 }] },
    ];
    const employeesById = { e1: { id: 'e1', defaultCostCenter: '', projectIds: [] } };
    const out = allocatePayrollCost({ periods, employeesById, fallbackCostCenter: 'CC-NOM' });
    expect(out.byCostCenter['CC-NOM']).toBe(1500);
  });

  it('equal-splits a line across multiple projectIds', () => {
    const periods = [
      { period: '2026-01', lines: [{ employeeId: 'e1', gesamtkosten: 3000 }] },
    ];
    const employeesById = { e1: { id: 'e1', defaultCostCenter: 'CC-OPS', projectIds: ['Alpha', 'Beta', 'Gamma'] } };
    const out = allocatePayrollCost({ periods, employeesById });
    expect(out.byProject.Alpha).toBe(1000);
    expect(out.byProject.Beta).toBe(1000);
    expect(out.byProject.Gamma).toBe(1000);
  });

  it('assigns the full line to a single projectId', () => {
    const periods = [
      { period: '2026-01', lines: [{ employeeId: 'e1', gesamtkosten: 2500 }] },
    ];
    const employeesById = { e1: { id: 'e1', defaultCostCenter: 'CC-OPS', projectIds: ['Alpha'] } };
    const out = allocatePayrollCost({ periods, employeesById });
    expect(out.byProject.Alpha).toBe(2500);
  });

  it('does not allocate to any project when the employee has no projectIds', () => {
    const periods = [
      { period: '2026-01', lines: [{ employeeId: 'e1', gesamtkosten: 2500 }] },
    ];
    const employeesById = { e1: { id: 'e1', defaultCostCenter: 'CC-OPS', projectIds: [] } };
    const out = allocatePayrollCost({ periods, employeesById });
    expect(out.byProject).toEqual({});
  });

  it('aggregates across multiple periods', () => {
    const periods = [
      { period: '2026-01', lines: [{ employeeId: 'e1', gesamtkosten: 1000 }] },
      { period: '2026-02', lines: [{ employeeId: 'e1', gesamtkosten: 1000 }] },
    ];
    const employeesById = { e1: { id: 'e1', defaultCostCenter: 'CC-OPS', projectIds: ['Alpha'] } };
    const out = allocatePayrollCost({ periods, employeesById });
    expect(out.byCostCenter['CC-OPS']).toBe(2000);
    expect(out.byProject.Alpha).toBe(2000);
  });

  it('returns empty maps for empty periods', () => {
    expect(allocatePayrollCost({ periods: [], employeesById: {} })).toEqual({ byCostCenter: {}, byProject: {} });
    expect(allocatePayrollCost({ periods: null, employeesById: null })).toEqual({ byCostCenter: {}, byProject: {} });
  });

  it('produces plain serializable maps (no class instances)', () => {
    const periods = [{ period: '2026-01', lines: [{ employeeId: 'e1', gesamtkosten: 100 }] }];
    const employeesById = { e1: { id: 'e1', defaultCostCenter: 'CC-OPS', projectIds: ['Alpha'] } };
    const out = allocatePayrollCost({ periods, employeesById });
    expect(JSON.parse(JSON.stringify(out))).toEqual(out);
    expect(out.byCostCenter.constructor).toBe(Object);
  });

  it('keys byProject by resolved project NAME when projectNamesById is given (id !== name)', () => {
    // Realistic: projectIds are document ids; buildProjectMargins groups by name.
    const periods = [{ period: '2026-01', lines: [{ employeeId: 'e1', gesamtkosten: 2500 }] }];
    const employeesById = { e1: { id: 'e1', defaultCostCenter: 'CC-OPS', projectIds: ['proj_abc'] } };
    const projectNamesById = { proj_abc: 'NE4 Rollout' };
    const out = allocatePayrollCost({ periods, employeesById, projectNamesById });
    expect(out.byProject['NE4 Rollout']).toBe(2500);
    expect(out.byProject.proj_abc).toBeUndefined();
  });
});
