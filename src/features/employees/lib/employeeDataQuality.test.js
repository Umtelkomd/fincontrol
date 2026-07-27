/**
 * Employee master data quality.
 *
 * Both checks come from real damage found in the production collection:
 *   - "Sebastian Agudelo Grajales" (inactive) and "Sebatian Agudelo Grajales"
 *     (active) are one person typed twice.
 *   - 12 of 15 employees have `projectIds: []`, so `allocatePayrollCost` has
 *     nowhere to send their cost and no obra ever sees their labour.
 */
import { describe, expect, it } from 'vitest';
import {
  employeeDataWarnings,
  findDuplicateEmployees,
  findEmployeesWithoutProjects,
} from './employeeDataQuality.js';

const employee = (overrides) => ({
  id: 'e-x',
  fullName: '',
  type: 'internal',
  status: 'active',
  projectIds: [],
  aliases: [],
  ...overrides,
});

describe('findDuplicateEmployees', () => {
  it('catches the same person entered twice with a typo', () => {
    const groups = findDuplicateEmployees([
      employee({ id: 'e-1', fullName: 'Sebastian Agudelo Grajales', status: 'inactive' }),
      employee({ id: 'e-2', fullName: 'Sebatian Agudelo Grajales' }),
      employee({ id: 'e-3', fullName: 'Jorge Moran' }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].employees.map((e) => e.id)).toEqual(['e-1', 'e-2']);
  });

  it('catches an exact repeat of the same name', () => {
    const groups = findDuplicateEmployees([
      employee({ id: 'e-1', fullName: 'Jorge Moran' }),
      employee({ id: 'e-2', fullName: 'JORGE MORAN' }),
    ]);
    expect(groups[0].employees.map((e) => e.id)).toEqual(['e-1', 'e-2']);
  });

  it('catches the same name with the surnames swapped around', () => {
    const groups = findDuplicateEmployees([
      employee({ id: 'e-1', fullName: 'Pizarro Caufal Simon' }),
      employee({ id: 'e-2', fullName: 'Simon Pizarro Caufal' }),
    ]);
    expect(groups).toHaveLength(1);
  });

  it('does not confuse two genuinely different people', () => {
    expect(
      findDuplicateEmployees([
        employee({ id: 'e-1', fullName: 'Jeisson Lesmes Linares' }),
        employee({ id: 'e-2', fullName: 'Juan Dios Lesmes Linares' }),
      ]),
    ).toEqual([]);
  });

  it('does not flag two short unrelated names that happen to be close', () => {
    expect(
      findDuplicateEmployees([
        employee({ id: 'e-1', fullName: 'Ana Ruiz' }),
        employee({ id: 'e-2', fullName: 'Ane Ruez' }),
      ]),
    ).toEqual([]);
  });

  it('ignores records with no name and handles empty input', () => {
    expect(findDuplicateEmployees([employee({ id: 'e-1' }), employee({ id: 'e-2' })])).toEqual([]);
    expect(findDuplicateEmployees([])).toEqual([]);
    expect(findDuplicateEmployees(null)).toEqual([]);
  });
});

describe('findEmployeesWithoutProjects', () => {
  it('lists internal employees whose payroll cost can reach no obra', () => {
    const result = findEmployeesWithoutProjects([
      employee({ id: 'e-1', fullName: 'Jeisson Lesmes Linares' }),
      employee({ id: 'e-2', fullName: 'Jorge Moran', type: 'external' }),
      employee({ id: 'e-3', fullName: 'Juan Dios Lesmes Linares', projectIds: ['proj-1'] }),
    ]);

    expect(result.map((e) => e.id)).toEqual(['e-1']);
  });

  it('ignores people who already left', () => {
    expect(
      findEmployeesWithoutProjects([
        employee({ id: 'e-1', fullName: 'Klaus Wagner', status: 'inactive' }),
      ]),
    ).toEqual([]);
  });

  it('treats a missing projectIds field as no projects', () => {
    const withoutField = { id: 'e-1', fullName: 'Sin campo', type: 'internal', status: 'active' };
    expect(findEmployeesWithoutProjects([withoutField]).map((e) => e.id)).toEqual(['e-1']);
  });

  it('handles empty input', () => {
    expect(findEmployeesWithoutProjects(null)).toEqual([]);
  });
});

describe('employeeDataWarnings', () => {
  it('returns one actionable warning per problem found', () => {
    const warnings = employeeDataWarnings([
      employee({ id: 'e-1', fullName: 'Sebastian Agudelo Grajales', status: 'inactive' }),
      employee({ id: 'e-2', fullName: 'Sebatian Agudelo Grajales' }),
    ]);

    expect(warnings.map((w) => w.id)).toEqual(['duplicate-name', 'missing-projects']);
    expect(warnings[0].count).toBe(1);
    expect(warnings[0].detail).toContain('Sebastian Agudelo Grajales');
    expect(warnings[1].count).toBe(1);
  });

  it('is silent when the master is clean', () => {
    expect(
      employeeDataWarnings([
        employee({ id: 'e-1', fullName: 'Jeisson Lesmes Linares', projectIds: ['proj-1'] }),
        employee({ id: 'e-2', fullName: 'Jorge Moran', type: 'external' }),
      ]),
    ).toEqual([]);
  });
});
