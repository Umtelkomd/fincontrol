/**
 * Movimientos — render smoke tests.
 *
 * The canonical cash ledger table. It is dense (filters, pagination, row
 * selection, four modals) and every branch below the first `if` was previously
 * unproven at runtime: the pure helpers it delegates to are unit-tested, but
 * nothing had ever mounted the component that wires them together.
 *
 * The bulk-select bar gets explicit coverage because it only exists while rows
 * are selected — exactly the kind of conditional subtree that ships broken.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { installFirebaseMocks } from '@/test/firebaseMock';
import { bankMovementFixture, isoDaysFromNow, ledgerFixtures } from '@/test/fixtures';

const CLASSIFIED = bankMovementFixture({
  id: 'mov-classified',
  direction: 'out',
  amount: 1800,
  description: 'Material fibra óptica',
  counterpartyName: 'Kabel Service GmbH',
  categoryName: 'Material',
  costScope: 'project',
  projectId: 'proj-1',
  projectName: 'NE4 Rossdorf',
  postedDate: isoDaysFromNow(-6),
});

const UNCLASSIFIED = bankMovementFixture({
  id: 'mov-unclassified',
  direction: 'out',
  amount: 640,
  description: 'Cargo sin categorizar',
  counterpartyName: 'Shell Tankstelle',
  categoryName: '',
  postedDate: isoDaysFromNow(-3),
});

const VOIDED = bankMovementFixture({
  id: 'mov-void',
  status: 'void',
  direction: 'out',
  amount: 99,
  description: 'Movimiento anulado',
  postedDate: isoDaysFromNow(-2),
});

const store = installFirebaseMocks({
  ...ledgerFixtures({
    collections: { bankMovements: [CLASSIFIED, UNCLASSIFIED, VOIDED] },
  }),
});
store.documents.categories = {
  expenseCategories: ['Material', 'Personal'],
  incomeCategories: ['Ventas'],
};

const { renderScreen } = await import('@/test/renderScreen.jsx');
const { default: Movimientos } = await import('./Movimientos.jsx');

const USER = { uid: 'test-uid', email: 'jromero@umtelkomd.com' };

// Restored before EVERY test, not after the ones that mutate: a failing
// assertion would skip an inline restore and cascade into unrelated tests.
beforeEach(() => {
  store.collections.bankMovements = [CLASSIFIED, UNCLASSIFIED, VOIDED];
});

describe('Movimientos — ledger table', () => {
  it('renders the header, coverage banner and table without throwing', () => {
    renderScreen(<Movimientos user={USER} />);

    expect(screen.getByRole('heading', { name: 'Revisión de movimientos' })).toBeInTheDocument();
    expect(screen.getByText('Cobertura de clasificación')).toBeInTheDocument();
    expect(screen.getByRole('table')).toBeInTheDocument();

    const headers = screen.getAllByRole('columnheader').map((cell) => cell.textContent);
    expect(headers).toEqual(
      expect.arrayContaining(['Fecha', 'Concepto', 'Contraparte', 'Categoría', 'Monto', 'Estado']),
    );
  });

  it('renders one row per non-filtered movement with its status badge', () => {
    renderScreen(<Movimientos user={USER} />);

    expect(screen.getByText('Material fibra óptica')).toBeInTheDocument();
    expect(screen.getByText('Cargo sin categorizar')).toBeInTheDocument();
    // The default "Todos (no anulados)" filter hides voided rows.
    expect(screen.queryByText('Movimiento anulado')).not.toBeInTheDocument();

    // Scoped to the table: "Sin clasificar" is also one of the filter options.
    const table = screen.getByRole('table');
    expect(within(table).getByText('Clasificado')).toBeInTheDocument();
    expect(within(table).getByText('Sin clasificar')).toBeInTheDocument();
  });

  it('sums the KPI row from the visible movements', () => {
    renderScreen(<Movimientos user={USER} />);

    expect(screen.getByText('Total filtrado')).toBeInTheDocument();
    expect(screen.getByText('1 clasificados')).toBeInTheDocument();
    expect(screen.getByText('2.440,00')).toBeInTheDocument(); // 1.800 + 640 outflows
  });

  it('shows the loading branch before the snapshot lands', () => {
    renderScreen(<Movimientos user={null} />, { user: null });

    expect(screen.getByText('Cargando...')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('shows the empty state instead of a headless table', () => {
    store.collections.bankMovements = [];

    renderScreen(<Movimientos user={USER} />);

    // NEXUS.OS EmptyState brackets its title.
    expect(screen.getByText('[Sin resultados]')).toBeInTheDocument();
    expect(screen.getByText('Ajustá los filtros o el rango de búsqueda.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});

describe('Movimientos — filters', () => {
  it('narrows the table when the status filter changes', () => {
    renderScreen(<Movimientos user={USER} />);

    fireEvent.change(screen.getByLabelText('Estado'), { target: { value: 'unclassified' } });

    expect(screen.getByText('Cargo sin categorizar')).toBeInTheDocument();
    expect(screen.queryByText('Material fibra óptica')).not.toBeInTheDocument();
  });

  it('surfaces voided movements only under the Anulados filter', () => {
    renderScreen(<Movimientos user={USER} />);

    fireEvent.change(screen.getByLabelText('Estado'), { target: { value: 'void' } });

    const table = screen.getByRole('table');
    expect(within(table).getByText('Movimiento anulado')).toBeInTheDocument();
    expect(within(table).getByText('Anulado')).toBeInTheDocument();
  });

  it('filters by free-text search across description and counterparty', () => {
    renderScreen(<Movimientos user={USER} />);

    fireEvent.change(screen.getByPlaceholderText('Buscar...'), { target: { value: 'Shell' } });

    expect(screen.getByText('Cargo sin categorizar')).toBeInTheDocument();
    expect(screen.queryByText('Material fibra óptica')).not.toBeInTheDocument();
  });
});

describe('Movimientos — bulk selection', () => {
  it('mounts the bulk-classify bar only once a row is selected', () => {
    renderScreen(<Movimientos user={USER} />);

    expect(screen.queryByText(/movimiento\(s\) seleccionados/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Seleccionar movimiento Cargo sin categorizar'));

    expect(screen.getByText('1 movimiento(s) seleccionados')).toBeInTheDocument();
    expect(screen.getByText('Categoría *')).toBeInTheDocument();
    expect(screen.getByText('Destino *')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Limpiar selección/ })).toBeInTheDocument();
  });

  it('selects the whole page from the header checkbox and clears again', () => {
    renderScreen(<Movimientos user={USER} />);

    const selectAll = screen.getByLabelText('Seleccionar todos los movimientos de la página');
    fireEvent.click(selectAll);
    expect(screen.getByText('2 movimiento(s) seleccionados')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Limpiar selección/ }));
    expect(screen.queryByText(/movimiento\(s\) seleccionados/)).not.toBeInTheDocument();
  });

  it('never offers a voided movement for bulk classification', () => {
    renderScreen(<Movimientos user={USER} />);

    fireEvent.change(screen.getByLabelText('Estado'), { target: { value: 'void' } });

    const checkbox = screen.getByLabelText('Movimiento anulado, no seleccionable: Movimiento anulado');
    expect(checkbox).toBeDisabled();

    fireEvent.click(screen.getByLabelText('Seleccionar todos los movimientos de la página'));
    expect(screen.queryByText(/movimiento\(s\) seleccionados/)).not.toBeInTheDocument();
  });
});

describe('Movimientos — pagination', () => {
  it('pages the table at 50 rows and moves between pages', () => {
    store.collections.bankMovements = Array.from({ length: 55 }, (_, index) =>
      bankMovementFixture({
        id: `bulk-${index}`,
        description: `Movimiento ${index}`,
        postedDate: isoDaysFromNow(-index - 1),
      }),
    );

    const { container } = renderScreen(<Movimientos user={USER} />);

    // Data rows carry role="button" (rowButtonProps makes the whole row
    // clickable), so they are not queryable as `row` — count them structurally.
    const dataRows = () => container.querySelectorAll('tbody tr');

    expect(dataRows()).toHaveLength(50);
    expect(screen.getByText('Mostrando 1–50 de 55')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Siguiente/ }));

    expect(screen.getByText('Mostrando 51–55 de 55')).toBeInTheDocument();
    expect(dataRows()).toHaveLength(5);
  });
});

describe('Movimientos — row detail modal', () => {
  it('opens the detail modal for the clicked movement', () => {
    renderScreen(<Movimientos user={USER} />);

    const row = screen.getByText('Material fibra óptica').closest('tr');
    fireEvent.click(within(row).getByRole('button', { name: /Ver/ }));

    // The modal repeats the description as its <h2> heading.
    expect(
      screen.getByRole('heading', { level: 2, name: 'Material fibra óptica' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Fecha valor')).toBeInTheDocument();
    expect(screen.getAllByText('-1.800,00').length).toBeGreaterThan(1); // row + modal hero
  });
});

/**
 * Nómina vs subcontratista in the ledger table.
 *
 * Same rule as the classifier inbox, on the screen where the owner reviews
 * everything: an internal employee is company payroll, an external one is a
 * subcontractor, and a probable match never claims to be certain.
 */
describe('Movimientos — nómina vs subcontratista', () => {
  const employee = (overrides) => ({
    id: 'e-x',
    fullName: '',
    firstName: '',
    lastName: '',
    type: 'internal',
    status: 'active',
    projectIds: [],
    aliases: [],
    ...overrides,
  });

  const JEISSON = employee({
    id: 'e-jeisson',
    fullName: 'Jeisson Lesmes Linares',
    firstName: 'Jeisson',
    lastName: 'Lesmes Linares',
  });
  const JORGE = employee({
    id: 'e-jorge',
    fullName: 'Jorge Moran',
    firstName: 'Jorge',
    lastName: 'Moran',
    type: 'external',
  });

  const SALARY = bankMovementFixture({
    id: 'mov-salary',
    direction: 'out',
    amount: 2400,
    description: 'Überweisung Gehalt',
    counterpartyName: 'Jeisson Lesmes Linares',
    postedDate: isoDaysFromNow(-4),
  });
  const SUBCONTRACT = bankMovementFixture({
    id: 'mov-sub',
    direction: 'out',
    amount: 5000,
    description: 'Pago cuadrilla',
    counterpartyName: 'Jorge Moran',
    postedDate: isoDaysFromNow(-4),
  });

  beforeEach(() => {
    store.collections.employees = [JEISSON, JORGE];
    store.collections.bankMovements = [SALARY, SUBCONTRACT, UNCLASSIFIED];
  });

  it('marks the payroll row and the subcontractor row differently', () => {
    renderScreen(<Movimientos user={USER} />);

    const payrollRow = screen.getByText('Überweisung Gehalt').closest('tr');
    expect(within(payrollRow).getByText('Nómina')).toBeInTheDocument();

    const subRow = screen.getByText('Pago cuadrilla').closest('tr');
    expect(within(subRow).getByText('Subcontratista')).toBeInTheDocument();
  });

  it('leaves an ordinary supplier row unmarked', () => {
    renderScreen(<Movimientos user={USER} />);

    const row = screen.getByText('Cargo sin categorizar').closest('tr');
    expect(within(row).queryByText('Nómina')).not.toBeInTheDocument();
    expect(within(row).queryByText('Subcontratista')).not.toBeInTheDocument();
  });

  it('marks a probable match as unconfirmed rather than asserting it', () => {
    store.collections.employees = [
      employee({
        id: 'e-pedro',
        fullName: 'Pedro Pizarro Caufal',
        firstName: 'Pedro',
        lastName: 'Pizarro Caufal',
      }),
    ];
    store.collections.bankMovements = [
      bankMovementFixture({
        id: 'mov-maybe',
        direction: 'out',
        amount: 2200,
        description: 'Überweisung SEPA',
        counterpartyName: 'Pedro Luis Pizarro Zapata',
        postedDate: isoDaysFromNow(-4),
      }),
    ];

    renderScreen(<Movimientos user={USER} />);

    const row = screen.getByText('Überweisung SEPA').closest('tr');
    expect(within(row).getByText('Nómina?')).toBeInTheDocument();
  });
});

/**
 * Own-account transfers must be readable as such at a glance: they are excluded
 * from every cost figure, so a row that looks like an ordinary 10.000 € payment
 * would otherwise be unexplainable.
 */
describe('Movimientos — internal transfers', () => {
  const INTERNAL = bankMovementFixture({
    id: 'mov-internal',
    direction: 'out',
    amount: 10000,
    description: 'Traspaso a cuenta propia',
    counterpartyName: 'UMTELKOMD GmbH',
    categoryName: '',
    postedDate: isoDaysFromNow(-4),
  });

  const SPANISH_SUBCONTRACTOR = bankMovementFixture({
    id: 'mov-spain',
    direction: 'out',
    amount: 6500,
    description: 'Teilzahlung Rechnung INV/2025/00005',
    counterpartyName: 'UMTELKOMD ESPA.A S.L.',
    categoryName: '',
    postedDate: isoDaysFromNow(-5),
  });

  beforeEach(() => {
    store.collections.bankMovements = [INTERNAL, SPANISH_SUBCONTRACTOR];
  });

  it('badges the own-account row as an internal transfer', () => {
    renderScreen(<Movimientos user={USER} />);

    const row = screen.getByText('Traspaso a cuenta propia').closest('tr');
    expect(within(row).getByText('Transferencia interna')).toBeInTheDocument();
  });

  it('leaves the UMTELKOMD ESPAÑA subcontractor unclassified, as a real supplier', () => {
    renderScreen(<Movimientos user={USER} />);

    const row = screen.getByText('Teilzahlung Rechnung INV/2025/00005').closest('tr');
    expect(within(row).queryByText('Transferencia interna')).not.toBeInTheDocument();
    expect(within(row).getByText('Sin clasificar')).toBeInTheDocument();
  });

  it('explains why internal transfers need no category', () => {
    renderScreen(<Movimientos user={USER} />);

    const note = screen.getByTestId('internal-transfer-note');
    expect(within(note).getByText(/entre cuentas propias/i)).toBeInTheDocument();
  });
});
