/**
 * CXC (cuentas por cobrar) — render smoke tests.
 *
 * Ten hooks feed this screen and it is gated by `userRole` in two places. The
 * aging bars only mount when something is actually overdue, and the row action
 * column only mounts for admin/manager — two conditional subtrees that no test
 * had ever evaluated.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { installFirebaseMocks } from '@/test/firebaseMock';
import { isoDaysFromNow, ledgerFixtures, receivableFixture } from '@/test/fixtures';

const OVERDUE = receivableFixture({
  id: 'cxc-overdue',
  counterpartyName: 'Insyte Deutschland',
  documentNumber: 'RE-2026-101',
  description: 'Certificación junio',
  amount: 10000,
  openAmount: 10000,
  dueDate: isoDaysFromNow(-40),
});

const PARTIAL = receivableFixture({
  id: 'cxc-partial',
  counterpartyName: 'Deutsche Telekom',
  documentNumber: 'RE-2026-102',
  description: 'Tramo Rossdorf',
  status: 'partial',
  amount: 6000,
  openAmount: 2000,
  paidAmount: 4000,
  dueDate: isoDaysFromNow(15),
});

const store = installFirebaseMocks(
  ledgerFixtures({ collections: { receivables: [OVERDUE, PARTIAL] } }),
);

const { renderScreen } = await import('@/test/renderScreen.jsx');
const { default: CXCIndependiente } = await import('./CXCIndependiente.jsx');

const USER = { uid: 'test-uid', email: 'jromero@umtelkomd.com' };

beforeEach(() => {
  const pristine = ledgerFixtures();
  Object.assign(store.collections, pristine.collections);
  Object.assign(store.documents, pristine.documents);
  store.collections.receivables = [OVERDUE, PARTIAL];
});

describe('CXC — screen render', () => {
  it('renders the header, KPI row and table head without throwing', () => {
    renderScreen(<CXCIndependiente user={USER} userRole="admin" />);

    expect(screen.getByText('Cuentas por cobrar', { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Seguimiento de cobros, abonos y vencimientos\./ })).toBeInTheDocument();

    const headers = screen.getAllByRole('columnheader').map((cell) => cell.textContent);
    expect(headers).toEqual([
      'Cliente',
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
    renderScreen(<CXCIndependiente user={null} userRole="admin" />, { user: null });

    expect(screen.getByText('Cargando…')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('lists every open receivable with its document number and open amount', () => {
    renderScreen(<CXCIndependiente user={USER} userRole="admin" />);

    const table = screen.getByRole('table');
    expect(within(table).getByText('Insyte Deutschland')).toBeInTheDocument();
    expect(within(table).getByText('RE-2026-101')).toBeInTheDocument();
    expect(within(table).getByText('Deutsche Telekom')).toBeInTheDocument();
    expect(within(table).getByText('RE-2026-102')).toBeInTheDocument();
    expect(within(table).getByText('2.000,00')).toBeInTheDocument(); // partial open amount
  });

  it('totals the open portfolio in the KPI row', () => {
    renderScreen(<CXCIndependiente user={USER} userRole="admin" />);

    // 10.000 fully open + 2.000 still open on the partially collected invoice.
    expect(screen.getByText('12.000,00')).toBeInTheDocument();
    expect(screen.getByText('Cartera abierta')).toBeInTheDocument();
    expect(screen.getByText('Vencido')).toBeInTheDocument();
    expect(screen.getByText('Ventana 14d')).toBeInTheDocument();
  });

  it('mounts the aging breakdown when something is overdue', () => {
    renderScreen(<CXCIndependiente user={USER} userRole="admin" />);

    expect(screen.getByText('Cartera vencida por tramos')).toBeInTheDocument();
  });

  it('hides the aging breakdown when nothing is overdue', () => {
    store.collections.receivables = [PARTIAL];

    renderScreen(<CXCIndependiente user={USER} userRole="admin" />);

    expect(screen.queryByText('Cartera vencida por tramos')).not.toBeInTheDocument();
    expect(screen.getByRole('table')).toBeInTheDocument();
  });
});

describe('CXC — filters', () => {
  it('narrows the table to overdue documents', () => {
    renderScreen(<CXCIndependiente user={USER} userRole="admin" />);

    fireEvent.click(screen.getByRole('button', { name: 'Vencidas' }));

    const table = screen.getByRole('table');
    expect(within(table).getByText('Insyte Deutschland')).toBeInTheDocument();
    expect(within(table).queryByText('Deutsche Telekom')).not.toBeInTheDocument();
  });

  it('filters by free text across client, document and project', () => {
    renderScreen(<CXCIndependiente user={USER} userRole="admin" />);

    fireEvent.change(screen.getByPlaceholderText('Buscar cliente, documento o proyecto'), {
      target: { value: 'RE-2026-102' },
    });

    const table = screen.getByRole('table');
    expect(within(table).getByText('Deutsche Telekom')).toBeInTheDocument();
    expect(within(table).queryByText('Insyte Deutschland')).not.toBeInTheDocument();
  });
});

describe('CXC — role gating', () => {
  it('drops the actions column for a role that cannot act', () => {
    renderScreen(<CXCIndependiente user={USER} userRole="editor" />);

    const headers = screen.getAllByRole('columnheader').map((cell) => cell.textContent);
    expect(headers).not.toContain('Acciones');
    // The data itself stays readable — the restriction is on writing, not seeing.
    expect(within(screen.getByRole('table')).getByText('Insyte Deutschland')).toBeInTheDocument();
  });
});

describe('CXC — batch reconciliation entry point', () => {
  // Confirming remesas are reconciled on their own screen. It is reachable from
  // here and nowhere else, so this link is the only way in.
  it('links to the remesa screen from the header', () => {
    renderScreen(<CXCIndependiente user={USER} userRole="admin" />);

    expect(screen.getByRole('link', { name: /remesa/i })).toHaveAttribute('href', '/cxc/remesas');
  });
});
