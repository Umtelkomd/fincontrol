/**
 * Personal — nómina vs subcontratista, and the two master-data defects.
 *
 * "Jeisson, Juan de Dios son nómina de empresa no subcontratistas." The master
 * already knows (`type`), so the screen has to say it in those words — not
 * "Interno"/"Externo", which nobody reads as payroll vs subcontractor.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { installFirebaseMocks } from '@/test/firebaseMock';
import { ledgerFixtures } from '@/test/fixtures';

const employee = (overrides) => ({
  id: 'e-x',
  fullName: '',
  firstName: '',
  lastName: '',
  type: 'internal',
  status: 'active',
  projectIds: [],
  aliases: [],
  role: '',
  ...overrides,
});

const JEISSON = employee({
  id: 'e-jeisson',
  fullName: 'Jeisson Lesmes Linares',
  type: 'internal',
  projectIds: ['proj-1'],
});
const JORGE = employee({
  id: 'e-jorge',
  fullName: 'Jorge Moran',
  type: 'external',
  projectIds: ['proj-1'],
});

const store = installFirebaseMocks(ledgerFixtures({ collections: { employees: [JEISSON, JORGE] } }));

const { renderScreen } = await import('@/test/renderScreen.jsx');
const { default: Employees } = await import('./Employees.jsx');

const USER = { uid: 'test-uid', email: 'jromero@umtelkomd.com' };

beforeEach(() => {
  store.collections.employees = [JEISSON, JORGE];
  store.collections.recurringCosts = [];
});

describe('Employees — nómina vs subcontratista', () => {
  it('labels a company-payroll employee "Nómina"', () => {
    renderScreen(<Employees user={USER} />);

    const row = screen.getByText('Jeisson Lesmes Linares').closest('tr');
    expect(within(row).getByText('Nómina')).toBeInTheDocument();
  });

  it('labels an external employee "Subcontratista"', () => {
    renderScreen(<Employees user={USER} />);

    fireEvent.click(screen.getByRole('button', { name: /Subcontratistas/ }));

    const row = screen.getByText('Jorge Moran').closest('tr');
    expect(within(row).getByText('Subcontratista')).toBeInTheDocument();
  });

  it('states what each type means for project cost', () => {
    renderScreen(<Employees user={USER} />);

    expect(
      screen.getByText(/La nómina se reparte a las obras por los proyectos del empleado/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/El subcontratista se carga a la obra/i)).toBeInTheDocument();
  });
});

describe('Employees — master data warnings', () => {
  it('flags the same person entered twice with a typo', () => {
    store.collections.employees = [
      employee({ id: 'e-1', fullName: 'Sebastian Agudelo Grajales', status: 'inactive', projectIds: ['proj-1'] }),
      employee({ id: 'e-2', fullName: 'Sebatian Agudelo Grajales', projectIds: ['proj-1'] }),
    ];

    renderScreen(<Employees user={USER} />);

    const warning = screen.getByTestId('warning-duplicate-name');
    expect(within(warning).getByText(/Posible empleado duplicado/i)).toBeInTheDocument();
    expect(within(warning).getByText(/Sebastian Agudelo Grajales/)).toBeInTheDocument();
    expect(within(warning).getByText(/Sebatian Agudelo Grajales/)).toBeInTheDocument();
  });

  it('flags payroll that cannot reach any obra', () => {
    store.collections.employees = [employee({ id: 'e-1', fullName: 'Jeisson Lesmes Linares' }), JORGE];

    renderScreen(<Employees user={USER} />);

    const warning = screen.getByTestId('warning-missing-projects');
    expect(within(warning).getByText(/no llega a ninguna obra/i)).toBeInTheDocument();
    expect(within(warning).getByText(/1 empleado\(s\) de nómina no tienen proyectos asignados/i)).toBeInTheDocument();
  });

  it('stays quiet when the master is clean', () => {
    renderScreen(<Employees user={USER} />);

    expect(screen.queryByTestId('warning-duplicate-name')).not.toBeInTheDocument();
    expect(screen.queryByTestId('warning-missing-projects')).not.toBeInTheDocument();
  });

  it('marks the row of an employee whose payroll reaches no obra', () => {
    store.collections.employees = [employee({ id: 'e-1', fullName: 'Jeisson Lesmes Linares' }), JORGE];

    renderScreen(<Employees user={USER} />);

    const row = screen.getByText('Jeisson Lesmes Linares').closest('tr');
    expect(within(row).getByText('Sin obra')).toBeInTheDocument();
  });
});
