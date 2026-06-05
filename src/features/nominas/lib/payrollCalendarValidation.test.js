import { describe, expect, it } from 'vitest';
import { validatePayrollRoster } from './payrollCalendarValidation.js';

describe('validatePayrollRoster', () => {
  it('flags a ghost line whose employee endDate is before the period start', () => {
    const out = validatePayrollRoster({
      period: '2026-03',
      lines: [{ employeeId: 'e1', persNr: '001', name: 'Ana' }],
      employees: [{ id: 'e1', persNr: '001', fullName: 'Ana', status: 'inactive', startDate: '2025-01-01', endDate: '2026-01-31' }],
    });
    expect(out.ok).toBe(false);
    expect(out.ghosts).toHaveLength(1);
    expect(out.ghosts[0].persNr).toBe('001');
    expect(out.ghosts[0].reason).toMatch(/endDate/);
  });

  it('flags a missing active: an active employee with no line that period', () => {
    const out = validatePayrollRoster({
      period: '2026-03',
      lines: [],
      employees: [{ id: 'e1', persNr: '001', fullName: 'Ana', status: 'active', startDate: '2025-01-01', endDate: '' }],
    });
    expect(out.ok).toBe(false);
    expect(out.missingActives).toHaveLength(1);
    expect(out.missingActives[0].employeeId).toBe('e1');
  });

  it('does NOT flag a mid-month joiner who has a line', () => {
    const out = validatePayrollRoster({
      period: '2026-03',
      lines: [{ employeeId: 'e1', persNr: '001', name: 'Ana' }],
      employees: [{ id: 'e1', persNr: '001', fullName: 'Ana', status: 'active', startDate: '2026-03-15', endDate: '' }],
    });
    expect(out.ghosts).toHaveLength(0);
    expect(out.missingActives).toHaveLength(0);
    expect(out.ok).toBe(true);
  });

  it('does NOT flag a leaver as a ghost when endDate is within the period (mid-month leaver)', () => {
    const out = validatePayrollRoster({
      period: '2026-03',
      lines: [{ employeeId: 'e1', persNr: '001', name: 'Ana' }],
      employees: [{ id: 'e1', persNr: '001', fullName: 'Ana', status: 'inactive', startDate: '2025-01-01', endDate: '2026-03-20' }],
    });
    expect(out.ghosts).toHaveLength(0);
    expect(out.ok).toBe(true);
  });

  it('does NOT mark an employee whose startDate is after the period as a missing active', () => {
    const out = validatePayrollRoster({
      period: '2026-03',
      lines: [],
      employees: [{ id: 'e1', persNr: '001', fullName: 'Ana', status: 'active', startDate: '2026-05-01', endDate: '' }],
    });
    expect(out.missingActives).toHaveLength(0);
    expect(out.ok).toBe(true);
  });

  it('suppresses the ghost flag when allowPartialOverride is set for that persNr', () => {
    const out = validatePayrollRoster({
      period: '2026-03',
      lines: [{ employeeId: 'e1', persNr: '001', name: 'Ana' }],
      employees: [{ id: 'e1', persNr: '001', fullName: 'Ana', status: 'inactive', startDate: '2025-01-01', endDate: '2026-01-31' }],
      allowPartialOverride: true,
    });
    expect(out.ghosts).toHaveLength(0);
    expect(out.ok).toBe(true);
  });

  it('returns ok=true with empty flags when the roster is clean', () => {
    const out = validatePayrollRoster({
      period: '2026-03',
      lines: [{ employeeId: 'e1', persNr: '001', name: 'Ana' }],
      employees: [{ id: 'e1', persNr: '001', fullName: 'Ana', status: 'active', startDate: '2025-01-01', endDate: '' }],
    });
    expect(out.ok).toBe(true);
    expect(out.ghosts).toEqual([]);
    expect(out.missingActives).toEqual([]);
  });

  it('handles empty/nullish input safely', () => {
    const out = validatePayrollRoster({ period: '2026-03', lines: null, employees: null });
    expect(out.ok).toBe(true);
    expect(out.ghosts).toEqual([]);
    expect(out.missingActives).toEqual([]);
  });
});
