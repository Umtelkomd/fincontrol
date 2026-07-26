/**
 * CXP (cuentas por pagar) — render smoke tests.
 *
 * Structurally the mirror of CXC, plus the F1 production gate: a payable that
 * requires ops clearance renders an extra badge and an extra filter bucket.
 * Those branches only exist for a subset of documents, so they get their own
 * fixtures rather than being assumed to render.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { installFirebaseMocks } from '@/test/firebaseMock';
import { isoDaysFromNow, ledgerFixtures, payableFixture } from '@/test/fixtures';

const OVERDUE = payableFixture({
  id: 'cxp-overdue',
  counterpartyName: 'Kabel Service GmbH',
  documentNumber: 'ER-2026-201',
  description: 'Material fibra',
  amount: 4000,
  openAmount: 4000,
  dueDate: isoDaysFromNow(-25),
});

const UPCOMING = payableFixture({
  id: 'cxp-upcoming',
  counterpartyName: 'Finanzamt Darmstadt',
  documentNumber: 'ER-2026-202',
  description: 'Umsatzsteuer',
  amount: 3000,
  openAmount: 3000,
  dueDate: isoDaysFromNow(10),
});

// `opsGateRequired: true` is what puts a payable behind the F1 production gate.
const NEEDS_OPS = payableFixture({
  id: 'cxp-ops',
  counterpartyName: 'Subunternehmer Bau',
  documentNumber: 'ER-2026-203',
  description: 'Subcontrata semana 30',
  amount: 5000,
  openAmount: 5000,
  dueDate: isoDaysFromNow(5),
  opsGateRequired: true,
  opsCleared: false,
});

const ALL = [OVERDUE, UPCOMING, NEEDS_OPS];

const store = installFirebaseMocks(ledgerFixtures({ collections: { payables: ALL } }));

const { renderScreen } = await import('@/test/renderScreen.jsx');
const { default: CXPIndependiente } = await import('./CXPIndependiente.jsx');

const USER = { uid: 'test-uid', email: 'jromero@umtelkomd.com' };

beforeEach(() => {
  const pristine = ledgerFixtures();
  Object.assign(store.collections, pristine.collections);
  Object.assign(store.documents, pristine.documents);
  store.collections.payables = ALL;
});

describe('CXP — screen render', () => {
  it('renders the header, KPI row and table head without throwing', () => {
    renderScreen(<CXPIndependiente user={USER} userRole="admin" />);

    expect(screen.getByText('Cuentas por pagar', { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Control de pagos, deuda y vencimientos\./ })).toBeInTheDocument();

    const headers = screen.getAllByRole('columnheader').map((cell) => cell.textContent);
    expect(headers).toEqual([
      'Proveedor',
      'Documento',
      'Proyecto',
      'Importe',
      'Abierto',
      'Vence',
      'Estado',
      'Origen',
      'Acciones',
    ]);
  });

  it('shows the loading branch while the ledger is still resolving', () => {
    renderScreen(<CXPIndependiente user={null} userRole="admin" />, { user: null });

    expect(screen.getByText('Cargando…')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('lists every open payable and totals the open debt', () => {
    renderScreen(<CXPIndependiente user={USER} userRole="admin" />);

    const table = screen.getByRole('table');
    expect(within(table).getByText('Kabel Service GmbH')).toBeInTheDocument();
    expect(within(table).getByText('Finanzamt Darmstadt')).toBeInTheDocument();
    expect(within(table).getByText('Subunternehmer Bau')).toBeInTheDocument();

    expect(screen.getByText('Deuda abierta')).toBeInTheDocument();
    expect(screen.getByText('12.000,00')).toBeInTheDocument(); // 4.000 + 3.000 + 5.000
  });

  it('mounts the aging breakdown when something is overdue', () => {
    renderScreen(<CXPIndependiente user={USER} userRole="admin" />);

    expect(screen.getByText('Deuda vencida por tramos')).toBeInTheDocument();
  });
});

describe('CXP — production gate', () => {
  it('flags a payable that still needs production clearance', () => {
    renderScreen(<CXPIndependiente user={USER} userRole="admin" />);

    const row = screen.getByText('Subunternehmer Bau').closest('tr');
    expect(within(row).getByText('Sin prod.')).toBeInTheDocument();
  });

  it('filters the table down to the gated payables', () => {
    renderScreen(<CXPIndependiente user={USER} userRole="admin" />);

    fireEvent.click(screen.getByRole('button', { name: 'Sin producción' }));

    const table = screen.getByRole('table');
    expect(within(table).getByText('Subunternehmer Bau')).toBeInTheDocument();
    expect(within(table).queryByText('Kabel Service GmbH')).not.toBeInTheDocument();
  });

  it('marks a cleared payable as production-OK instead of gated', () => {
    store.collections.payables = [{ ...NEEDS_OPS, opsCleared: true, productionWeekRef: '2026-W30' }];

    renderScreen(<CXPIndependiente user={USER} userRole="admin" />);

    const row = screen.getByText('Subunternehmer Bau').closest('tr');
    expect(within(row).getByText('Prod. OK 2026-W30')).toBeInTheDocument();
  });
});

describe('CXP — filters and role gating', () => {
  it('narrows the table to overdue documents', () => {
    renderScreen(<CXPIndependiente user={USER} userRole="admin" />);

    fireEvent.click(screen.getByRole('button', { name: 'Vencidas' }));

    const table = screen.getByRole('table');
    expect(within(table).getByText('Kabel Service GmbH')).toBeInTheDocument();
    expect(within(table).queryByText('Finanzamt Darmstadt')).not.toBeInTheDocument();
  });

  it('filters by free text across supplier, document and project', () => {
    renderScreen(<CXPIndependiente user={USER} userRole="admin" />);

    fireEvent.change(screen.getByPlaceholderText('Buscar proveedor, documento o proyecto'), {
      target: { value: 'ER-2026-202' },
    });

    const table = screen.getByRole('table');
    expect(within(table).getByText('Finanzamt Darmstadt')).toBeInTheDocument();
    expect(within(table).queryByText('Kabel Service GmbH')).not.toBeInTheDocument();
  });

  it('drops the actions column for a role that cannot act', () => {
    renderScreen(<CXPIndependiente user={USER} userRole="editor" />);

    const headers = screen.getAllByRole('columnheader').map((cell) => cell.textContent);
    expect(headers).not.toContain('Acciones');
    expect(within(screen.getByRole('table')).getByText('Kabel Service GmbH')).toBeInTheDocument();
  });
});
