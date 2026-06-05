import { describe, expect, it } from 'vitest';
import { resolveEmployeeIdsByPersNr } from './payrollIdentity.js';

const EMPLOYEES = [
  { id: 'e1', persNr: '00001', fullName: 'Juan Dios Lesmes Linares', firstName: 'Juan', lastName: 'Lesmes Linares', aliases: [] },
  { id: 'e2', persNr: '00010', fullName: 'José Romero Lesmes', firstName: 'José', lastName: 'Romero Lesmes', aliases: ['J. Romero'] },
  { id: 'e3', persNr: '', fullName: 'Klaus Wagner', firstName: 'Klaus', lastName: 'Wagner', aliases: [] },
];

describe('resolveEmployeeIdsByPersNr', () => {
  it('matches by persNr first', () => {
    const { resolved, unmatched } = resolveEmployeeIdsByPersNr({
      lines: [{ persNr: '00001', name: 'Lesmes Linares, J.', netto: 2401.05 }],
      employees: EMPLOYEES,
    });
    expect(resolved[0].employeeId).toBe('e1');
    expect(unmatched).toHaveLength(0);
  });

  it('falls back to name/alias match only when persNr is absent or unknown', () => {
    const { resolved } = resolveEmployeeIdsByPersNr({
      lines: [{ persNr: '', name: 'Wagner', netto: 1800 }],
      employees: EMPLOYEES,
    });
    expect(resolved[0].employeeId).toBe('e3');
  });

  it('matches by alias when persNr is unknown', () => {
    const { resolved } = resolveEmployeeIdsByPersNr({
      lines: [{ persNr: '99999', name: 'J. Romero', netto: 100 }],
      employees: EMPLOYEES,
    });
    expect(resolved[0].employeeId).toBe('e2');
  });

  it('pushes truly unmatched lines into unmatched[] and leaves employeeId empty', () => {
    const { resolved, unmatched } = resolveEmployeeIdsByPersNr({
      lines: [{ persNr: '88888', name: 'Nadie Conocido', netto: 100 }],
      employees: EMPLOYEES,
    });
    expect(resolved[0].employeeId).toBe('');
    expect(unmatched).toEqual([{ persNr: '88888', name: 'Nadie Conocido' }]);
  });

  it('prefers persNr over a conflicting name match', () => {
    // line name says "Wagner" (e3) but persNr points to e1 — persNr wins
    const { resolved } = resolveEmployeeIdsByPersNr({
      lines: [{ persNr: '00001', name: 'Wagner', netto: 100 }],
      employees: EMPLOYEES,
    });
    expect(resolved[0].employeeId).toBe('e1');
  });

  it('does not double-assign one employee to two lines (deterministic tie-break)', () => {
    const { resolved } = resolveEmployeeIdsByPersNr({
      lines: [
        { persNr: '', name: 'Wagner', netto: 100 },
        { persNr: '', name: 'Wagner', netto: 200 },
      ],
      employees: EMPLOYEES,
    });
    // First line claims e3 by name; the second can't reuse it -> unmatched
    expect(resolved[0].employeeId).toBe('e3');
    expect(resolved[1].employeeId).toBe('');
  });

  it('preserves all original line fields on the resolved output', () => {
    const { resolved } = resolveEmployeeIdsByPersNr({
      lines: [{ persNr: '00001', name: 'Lesmes', netto: 2401.05, brutto: 3666.67, gesamtkosten: 4470.23 }],
      employees: EMPLOYEES,
    });
    expect(resolved[0]).toMatchObject({
      persNr: '00001',
      name: 'Lesmes',
      netto: 2401.05,
      brutto: 3666.67,
      gesamtkosten: 4470.23,
      employeeId: 'e1',
    });
  });

  it('handles empty inputs gracefully', () => {
    const { resolved, unmatched } = resolveEmployeeIdsByPersNr({ lines: [], employees: [] });
    expect(resolved).toEqual([]);
    expect(unmatched).toEqual([]);
  });
});
