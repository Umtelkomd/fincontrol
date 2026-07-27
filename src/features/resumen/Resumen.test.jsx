/**
 * Resumen — render smoke tests.
 *
 * Resumen is the default landing route and the root `<ErrorBoundary>` wraps the
 * whole app, so anything that throws here does not degrade one panel: it blanks
 * FinControl entirely. That already happened once — the alerts panel rendered
 * `<Link>` without importing it, and the app died the first time an alert fired.
 * 834 pure-function tests did not notice because none of them rendered anything.
 *
 * These tests therefore mount the real component over the real hooks (only
 * Firestore is faked) and, above all, force the alerts branch to render.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { installFirebaseMocks } from '@/test/firebaseMock';
import {
  bankMovementFixture,
  isoDaysFromNow,
  ledgerFixtures,
  payableFixture,
  receivableFixture,
} from '@/test/fixtures';
import { ALERT_HREFS } from './lib/alertsPanel';

const store = installFirebaseMocks(ledgerFixtures());

const { renderScreen } = await import('@/test/renderScreen.jsx');
const { default: Resumen } = await import('./Resumen.jsx');

const USER = { uid: 'test-uid', email: 'jromero@umtelkomd.com' };

/** The "Caja actual" KPI card — cash also appears inside "Posición real". */
const cashKpi = () => screen.getByText('Caja actual').closest('div').parentElement;

/**
 * LOCAL dates, never toISOString(): ages are computed against local midnight and
 * in Europe/Berlin toISOString() lands on the previous day, which would make a
 * day-count assertion off by one for half the year.
 */
const isoDaysAgoLocal = (days) => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

// Restored BEFORE every test, not after the ones that mutate: a failing
// assertion skips an inline restore and cascades into unrelated tests.
beforeEach(() => {
  const pristine = ledgerFixtures();
  Object.assign(store.collections, pristine.collections);
  Object.assign(store.documents, pristine.documents);
  store.errors = {};
  store.auth.permissions = null;
  store.auth.userRole = 'admin';
});

describe('Resumen — cockpit render', () => {
  it('renders every block without throwing', () => {
    renderScreen(<Resumen user={USER} />);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Cómo va la empresa');
    expect(screen.getByText('Caja y runway')).toBeInTheDocument();
    expect(screen.getByText('Resultado del mes')).toBeInTheDocument();
    expect(screen.getByText('Por cobrar / por pagar')).toBeInTheDocument();
    expect(screen.getByText('Margen por proyecto')).toBeInTheDocument();
  });

  it('reports the loading state instead of rendering €0 figures', () => {
    // A null user keeps every Firestore listener idle, which is exactly the
    // state the ledger is in before the first snapshot lands.
    renderScreen(<Resumen user={null} />, { user: null });

    expect(screen.getByText('Cargando…')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
  });

  it('derives cash from the reconciliation anchor, not from settings/bankAccount', () => {
    renderScreen(<Resumen user={USER} />);

    // 25.000 anchor + 42.000 − 12.000 − 3.000 (all three movements post-date it).
    // Scoped to the KPI: "Posición real" repeats cash as part of its arithmetic.
    expect(within(cashKpi()).getByText('52.000,00')).toBeInTheDocument();
    expect(screen.getByText(/Conciliado al/)).toBeInTheDocument();
  });

  /**
   * The layer boundary, asserted from the cash side.
   *
   * Project cost and budget actuals are measured NET, because input VAT comes
   * back as Vorsteuer. Cash is not: the bank moved the gross amount and the
   * balance has to match the statement. This is a characterization test — it
   * passed before VAT rates existed and must keep passing after — so that
   * configuring a rate can never quietly reprice the cash position.
   */
  it('keeps cash gross even when every category carries a VAT rate', () => {
    store.collections.bankMovements = [
      bankMovementFixture({
        direction: 'in',
        amount: 11900,
        categoryName: 'Servicios',
        postedDate: isoDaysFromNow(-8),
      }),
      bankMovementFixture({
        direction: 'out',
        amount: 5950,
        categoryName: 'Materiales',
        postedDate: isoDaysFromNow(-5),
      }),
    ];
    store.documents.vatRates = { rates: { Servicios: 0.19, Materiales: 0.19 } };

    renderScreen(<Resumen user={USER} />);

    // 25.000 anchor + 11.900 − 5.950, all gross. Netting these at 19% would
    // read 30.000,00 instead.
    expect(within(cashKpi()).getByText('30.950,00')).toBeInTheDocument();
    expect(screen.queryByText('30.000,00')).not.toBeInTheDocument();
  });

  it('warns when no anchor exists instead of silently using the legacy balance', () => {
    store.documents.reconciliation = { anchors: [] };

    renderScreen(<Resumen user={USER} />);

    expect(
      screen.getByText('Sin conciliar — registra un ancla en Configuración → Tesorería'),
    ).toBeInTheDocument();
  });

  it('renders the CXC/CXP totals and the net position', () => {
    renderScreen(<Resumen user={USER} />);

    const panel = screen.getByText('Por cobrar / por pagar').closest('section');
    expect(within(panel).getByText('10.000,00')).toBeInTheDocument(); // open receivable
    expect(within(panel).getByText('4.000,00')).toBeInTheDocument(); // open payable
    expect(within(panel).getByText('+6.000,00')).toBeInTheDocument(); // net position
  });

  it('ranks projects and keeps unassigned cash visible as its own row', () => {
    renderScreen(<Resumen user={USER} />);

    const panel = screen.getByText('Margen por proyecto').closest('section');
    expect(within(panel).getByText('NE4 Rossdorf')).toBeInTheDocument();
    expect(within(panel).getByText('+30.000,00')).toBeInTheDocument();
    expect(within(panel).getByText('Sin asignar')).toBeInTheDocument();
  });
});

describe('Resumen — alerts panel', () => {
  // The exact branch that shipped broken: an alert exists, so every alert row
  // must render its router link. A missing/renamed <Link> import throws here.
  it('renders one routable link per alert', () => {
    renderScreen(<Resumen user={USER} />);

    const panel = screen.getByText('Alertas').closest('section');
    expect(panel).not.toBeNull();

    const links = within(panel).getAllByRole('link');
    expect(links.length).toBeGreaterThan(0);

    links.forEach((link) => {
      const href = link.getAttribute('href');
      expect(href).toBeTruthy();
      // MemoryRouter renders `to` verbatim; a typo'd route would dead-end the
      // user at App.jsx's catch-all redirect instead of the intended screen.
      expect(ALERT_HREFS).toContain(href);
    });
  });

  it('surfaces the overdue payables and receivables alerts', () => {
    renderScreen(<Resumen user={USER} />);

    const panel = screen.getByText('Alertas').closest('section');
    expect(within(panel).getByText('Cuentas por pagar vencidas')).toBeInTheDocument();
    expect(within(panel).getByText('Cobros vencidos sin gestionar')).toBeInTheDocument();
    expect(within(panel).getByText(/^\d+ activas?$/)).toBeInTheDocument();
  });

  it('links a stale reconciliation anchor to Configuración', () => {
    store.documents.reconciliation = {
      anchors: [{ date: isoDaysFromNow(-120), balance: 25000, source: 'DATEV SuSa 1200' }],
    };

    renderScreen(<Resumen user={USER} />);

    const panel = screen.getByText('Alertas').closest('section');
    const stale = within(panel).getByText('Conciliación desactualizada').closest('li');
    expect(within(stale).getByRole('link')).toHaveAttribute('href', '/configuracion');
  });

  it('omits the panel entirely when nothing is wrong', () => {
    // Nothing open, a fresh anchor and a movement imported yesterday ⇒ zero
    // alerts, and the panel must not render an empty shell.
    store.collections.receivables = [];
    store.collections.payables = [];

    renderScreen(<Resumen user={USER} />);

    expect(screen.queryByText('Alertas')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Cómo va la empresa');
  });
});

describe('Resumen — partial data guard', () => {
  it('warns that the figures are untrustworthy when a source fails', () => {
    store.errors.bankMovements = new Error('permission-denied');

    renderScreen(<Resumen user={USER} />);

    expect(screen.getByText('Datos incompletos — no confíes en estas cifras')).toBeInTheDocument();
    expect(screen.getByText(/bankMovements/)).toBeInTheDocument();
  });
});

describe('Resumen — payroll permission gating', () => {
  it('drops the payroll figures for a role without the cxp permission', () => {
    store.auth.userRole = 'editor';
    store.auth.permissions = ['dashboard', 'reports'];

    renderScreen(<Resumen user={USER} />);

    // With the permission the block is titled "… (nómina incluida)"; without it
    // the payroll line is dropped honestly rather than shown as 0 without note.
    expect(screen.getAllByText('Resultado del mes').length).toBeGreaterThan(1);
    expect(screen.queryByText('Resultado del mes (nómina incluida)')).not.toBeInTheDocument();
    expect(screen.getByText('Sin permiso')).toBeInTheDocument();
    expect(screen.getByText('Sin mano de obra (sin permiso)')).toBeInTheDocument();
  });
});

describe('Resumen — upcoming due lists', () => {
  it('lists documents due inside the 30-day window on the right side', () => {
    store.collections.payables = [
      payableFixture({ counterpartyName: 'Finanzamt Darmstadt', dueDate: isoDaysFromNow(7), openAmount: 2500 }),
    ];
    store.collections.receivables = [
      receivableFixture({ counterpartyName: 'Deutsche Telekom', dueDate: isoDaysFromNow(12), openAmount: 8000 }),
    ];

    renderScreen(<Resumen user={USER} />);

    const payments = screen.getByText('Próximos pagos').closest('div').parentElement;
    const collections = screen.getByText('Próximos cobros').closest('div').parentElement;
    expect(within(payments).getByText('Finanzamt Darmstadt')).toBeInTheDocument();
    expect(within(collections).getByText('Deutsche Telekom')).toBeInTheDocument();
    expect(within(payments).queryByText('Deutsche Telekom')).not.toBeInTheDocument();
  });

  it('shows the empty copy when nothing falls in the window', () => {
    store.collections.payables = [];
    store.collections.receivables = [];

    renderScreen(<Resumen user={USER} />);

    expect(screen.getByText('Sin pagos en la ventana.')).toBeInTheDocument();
    expect(screen.getByText('Sin cobros en la ventana.')).toBeInTheDocument();
  });
});

describe('Resumen — posición real', () => {
  // Ledger fixture: cash 52.000, CXC abierta 10.000, CXP abierta 4.000.
  const WIP_DOC = {
    id: 'wip-1',
    projectId: 'proj-1',
    projectName: 'NE4 Rossdorf',
    amount: 30000,
    asOf: isoDaysAgoLocal(5),
    stage: 'executed',
    status: 'open',
    note: '',
    receivableId: null,
    createdBy: 'jromero@umtelkomd.com',
    createdAt: '2026-07-01T08:00:00.000Z',
  };

  it('adds executed work to the position and shows the arithmetic', () => {
    store.collections.workInProgress = [WIP_DOC];

    renderScreen(<Resumen user={USER} />);

    const panel = screen.getByTestId('position-panel');
    // 52.000 caja + 30.000 obra + 10.000 por cobrar − 4.000 por pagar
    expect(within(panel).getByTestId('position-net')).toHaveTextContent('88.000,00');
    expect(within(panel).getByText('Obra ejecutada')).toBeInTheDocument();
    expect(within(panel).getByText('30.000,00')).toBeInTheDocument();
    expect(within(panel).getByText('52.000,00')).toBeInTheDocument();
  });

  it('still renders the position when nothing is captured yet', () => {
    store.collections.workInProgress = [];

    renderScreen(<Resumen user={USER} />);

    const panel = screen.getByTestId('position-panel');
    expect(within(panel).getByTestId('position-net')).toHaveTextContent('58.000,00');
    expect(within(panel).getByText(/Sin obra ejecutada registrada/)).toBeInTheDocument();
  });

  it('says plainly when the executed work has been frozen by paperwork', () => {
    store.collections.workInProgress = [{ ...WIP_DOC, asOf: isoDaysAgoLocal(80) }];

    renderScreen(<Resumen user={USER} />);

    expect(within(screen.getByTestId('position-panel')).getByText(/80 días/)).toBeInTheDocument();
  });

  it('keeps executed work OUT of the cash figure — WIP is not cash', () => {
    store.collections.workInProgress = [WIP_DOC];

    renderScreen(<Resumen user={USER} />);

    // "Caja actual" is still the anchor-derived 52.000, untouched by the 30.000.
    const cash = screen.getByText('Caja actual').closest('div').parentElement;
    expect(within(cash).getByText('52.000,00')).toBeInTheDocument();
    expect(within(cash).queryByText('82.000,00')).not.toBeInTheDocument();
  });
});
