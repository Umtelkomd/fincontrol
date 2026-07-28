import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { installFirebaseMocks, TEST_USER } from '@/test/firebaseMock';
import {
  bankMovementFixture,
  isoThisMonth,
  ledgerFixtures,
  projectFixture,
} from '@/test/fixtures';

const PROJECT_NAME = 'NE4 Rossdorf';
const MOVEMENTS = [
  bankMovementFixture({
    id: 'income-project',
    direction: 'in',
    amount: 10000,
    postedDate: isoThisMonth(5),
    projectId: 'project-1',
    projectName: PROJECT_NAME,
  }),
  bankMovementFixture({
    id: 'cost-project',
    direction: 'out',
    amount: 3000,
    postedDate: isoThisMonth(6),
    projectId: 'project-1',
    projectName: PROJECT_NAME,
  }),
  bankMovementFixture({
    id: 'unassigned-income',
    direction: 'in',
    amount: 90000,
    postedDate: isoThisMonth(7),
    projectId: '',
    projectName: 'Sin proyecto',
  }),
];

const monthKey = isoThisMonth(1).slice(0, 7);
installFirebaseMocks(ledgerFixtures({
  collections: {
    bankMovements: MOVEMENTS,
    projects: [projectFixture({ id: 'project-1', name: PROJECT_NAME })],
    employees: [{
      id: 'employee-1',
      fullName: 'Payroll Employee',
      type: 'internal',
      status: 'active',
      projectIds: ['project-1'],
    }],
    payrollPeriods: [{
      id: 'payroll-period',
      period: monthKey,
      lines: [{ employeeId: 'employee-1', gesamtkosten: 2000 }],
    }],
  },
}));

const { renderScreen } = await import('@/test/renderScreen.jsx');
const { allocatePayrollCost } = await import('../nominas/lib/payrollAllocation.js');
const { buildProjectMargins } = await import('../../hooks/useTreasuryMetrics.js');
const { default: Reports } = await import('./Reports.jsx');

describe('Reports project margins', () => {
  it('renders the same canonical margin result as Treasury/Summary, including payroll', () => {
    const payrollByProject = allocatePayrollCost({
      periods: [{ lines: [{ employeeId: 'employee-1', gesamtkosten: 2000 }] }],
      employeesById: {
        'employee-1': { projectIds: ['project-1'] },
      },
      projectNamesById: { 'project-1': PROJECT_NAME },
    }).byProject;
    const canonical = buildProjectMargins(MOVEMENTS, payrollByProject);

    renderScreen(<Reports user={TEST_USER} />);

    const section = screen.getByRole('heading', { name: 'Margen realizado por proyecto' }).closest('section');
    const project = canonical[0];
    expect(project).toMatchObject({
      name: PROJECT_NAME,
      inflows: 10000,
      outflows: 5000,
      net: 5000,
    });
    expect(within(section).getByText(PROJECT_NAME)).toBeInTheDocument();
    expect(
      within(section).getByText('Ingresos 10.000,00 · Gastos 5.000,00'),
    ).toBeInTheDocument();
    expect(within(section).getByText('+5.000,00')).toBeInTheDocument();
  });

  it('does not render the unassigned placeholder as a project', () => {
    renderScreen(<Reports user={TEST_USER} />);

    const section = screen.getByRole('heading', { name: 'Margen realizado por proyecto' }).closest('section');
    expect(within(section).queryByText('Sin proyecto')).not.toBeInTheDocument();
  });
});
