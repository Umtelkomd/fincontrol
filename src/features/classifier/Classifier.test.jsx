/**
 * Classifier — render smoke tests.
 *
 * The weekly DATEV inbox. Three mutually exclusive tab panels, each with its
 * own empty state, plus a coverage header shared with Movimientos. Only one
 * panel is mounted at a time, so two thirds of this screen's JSX had never been
 * evaluated by anything before these tests.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { installFirebaseMocks } from '@/test/firebaseMock';
import {
  bankMovementFixture,
  isoDaysFromNow,
  ledgerFixtures,
  payableFixture,
  receivableFixture,
} from '@/test/fixtures';

const INCOME = bankMovementFixture({
  id: 'mov-in',
  direction: 'in',
  amount: 10000,
  description: 'Überweisung Insyte',
  counterpartyName: 'Insyte Deutschland',
  postedDate: isoDaysFromNow(-4),
});

// Same amount and a due date inside the ±21-day window ⇒ score ≥ 100, which is
// what routes an outflow into the "Gastos con CXP sugerida" bucket.
const EXPENSE_WITH_MATCH = bankMovementFixture({
  id: 'mov-out-matched',
  direction: 'out',
  amount: 4000,
  description: 'Lastschrift Kabel Service',
  counterpartyName: 'Kabel Service GmbH',
  postedDate: isoDaysFromNow(-3),
});

const EXPENSE_SPONTANEOUS = bankMovementFixture({
  id: 'mov-out-loose',
  direction: 'out',
  amount: 87.4,
  description: 'Tankstelle Aral',
  counterpartyName: 'Aral AG',
  postedDate: isoDaysFromNow(-2),
});

const INBOX = [INCOME, EXPENSE_WITH_MATCH, EXPENSE_SPONTANEOUS];

const store = installFirebaseMocks(
  ledgerFixtures({
    collections: {
      bankMovements: INBOX,
      payables: [payableFixture({ id: 'cxp-match', openAmount: 4000, amount: 4000, dueDate: isoDaysFromNow(-3) })],
      receivables: [receivableFixture({ id: 'cxc-open', openAmount: 10000, amount: 10000, dueDate: isoDaysFromNow(-4) })],
    },
  }),
);

const { renderScreen } = await import('@/test/renderScreen.jsx');
const { default: Classifier } = await import('./Classifier.jsx');

const USER = { uid: 'test-uid', email: 'jromero@umtelkomd.com' };

beforeEach(() => {
  const pristine = ledgerFixtures();
  Object.assign(store.collections, pristine.collections);
  store.collections.bankMovements = INBOX;
  store.collections.payables = [
    payableFixture({ id: 'cxp-match', openAmount: 4000, amount: 4000, dueDate: isoDaysFromNow(-3) }),
  ];
  store.collections.receivables = [
    receivableFixture({ id: 'cxc-open', openAmount: 10000, amount: 10000, dueDate: isoDaysFromNow(-4) }),
  ];
  store.collections.classificationRules = [];
});

describe('Classifier — inbox shell', () => {
  it('renders the header and the coverage banner without throwing', () => {
    renderScreen(<Classifier user={USER} />);

    expect(screen.getByRole('heading', { name: 'Clasificar movimientos' })).toBeInTheDocument();
    expect(screen.getByText('Bandeja semanal')).toBeInTheDocument();
    expect(screen.getByText('Cobertura de clasificación')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Cobertura de clasificación' })).toBeInTheDocument();
  });

  it('buckets the inbox across the KPI row', () => {
    renderScreen(<Classifier user={USER} />);

    // One inflow + one matched outflow + one loose outflow. The bucket labels
    // also appear on the tabs (inside a <span>), so each KPI is read from its
    // own tile: label <p> → header row → tile root → the tile's value <p>.
    const kpiValue = (label) =>
      screen
        .getByText(label, { selector: 'p' })
        .closest('div')
        .parentElement.querySelector(':scope > p');

    expect(kpiValue('Pendientes total')).toHaveTextContent('3');
    expect(kpiValue('Con CXP sugerida')).toHaveTextContent('1');
    expect(kpiValue('Gastos espontáneos')).toHaveTextContent('1');
  });

  it('reports an empty inbox as up to date rather than as an error', () => {
    store.collections.bankMovements = [];

    renderScreen(<Classifier user={USER} />);

    expect(screen.getByText('✓ Bandeja al día')).toBeInTheDocument();
    expect(screen.getByText('[Sin ingresos pendientes]')).toBeInTheDocument();
  });
});

describe('Classifier — tab panels', () => {
  it('opens on the income bucket and lists the unreconciled inflow', () => {
    renderScreen(<Classifier user={USER} />);

    const panel = screen.getByText('Ingresos sin conciliar', { selector: 'h3' }).closest('section');
    expect(within(panel).getByText('Überweisung Insyte')).toBeInTheDocument();
    expect(within(panel).queryByText('Tankstelle Aral')).not.toBeInTheDocument();
  });

  it('switches to the suggested-CXP bucket and renders its match', () => {
    renderScreen(<Classifier user={USER} />);

    fireEvent.click(screen.getByRole('button', { name: /Gastos con CXP sugerida/ }));

    const panel = screen.getByText('Gastos con CXP sugerida', { selector: 'h3' }).closest('section');
    expect(within(panel).getByText('Lastschrift Kabel Service')).toBeInTheDocument();
    expect(within(panel).queryByText('Überweisung Insyte')).not.toBeInTheDocument();
  });

  it('switches to the spontaneous bucket for outflows with no CXP candidate', () => {
    renderScreen(<Classifier user={USER} />);

    fireEvent.click(screen.getByRole('button', { name: /Gastos espontáneos/ }));

    const panel = screen.getByText('Gastos espontáneos', { selector: 'h3' }).closest('section');
    expect(within(panel).getByText('Tankstelle Aral')).toBeInTheDocument();
  });

  it('shows a per-bucket empty state, not a blank panel', () => {
    store.collections.bankMovements = [INCOME];

    renderScreen(<Classifier user={USER} />);
    fireEvent.click(screen.getByRole('button', { name: /Gastos espontáneos/ }));

    expect(screen.getByText('[Sin gastos por categorizar]')).toBeInTheDocument();
    expect(
      screen.getByText('Todos los gastos están conciliados o categorizados.'),
    ).toBeInTheDocument();
  });
});

describe('Classifier — search', () => {
  it('filters the active bucket by description', () => {
    renderScreen(<Classifier user={USER} />);

    fireEvent.change(screen.getByPlaceholderText('Buscar...'), { target: { value: 'Insyte' } });

    expect(screen.getByText('Überweisung Insyte')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Buscar...'), { target: { value: 'zzz' } });

    expect(screen.getByText('[Sin ingresos pendientes]')).toBeInTheDocument();
  });
});

describe('Classifier — rule shortcut', () => {
  it('offers "Aplicar reglas" only when a rule matches something in the inbox', () => {
    renderScreen(<Classifier user={USER} />);
    expect(screen.queryByRole('button', { name: /Aplicar reglas/ })).not.toBeInTheDocument();
  });

  it('counts the inbox movements a stored rule would classify', () => {
    store.collections.classificationRules = [
      {
        id: 'rule-aral',
        active: true,
        priority: 10,
        matchType: 'contains',
        field: 'counterpartyName',
        pattern: 'Aral',
        categoryName: 'Combustible',
        costScope: 'overhead',
      },
    ];

    renderScreen(<Classifier user={USER} />);

    expect(screen.getByRole('button', { name: /Aplicar reglas \(1\)/ })).toBeInTheDocument();
  });
});
