/**
 * WipPanel — the obra-level backlog of executed work that is not an invoice yet.
 *
 * Two things must hold on screen. First, capture has to be fast: the project is
 * already known, so the form is amount + stage + date + optional note and
 * nothing else — if it took longer nobody would keep it up to date and the whole
 * feature would rot. Second, age has to be uncomfortable: work frozen by
 * paperwork is the highest-value action available to this company, and a panel
 * that renders it as a neutral number hides that.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { installFirebaseMocks } from '@/test/firebaseMock';
import { ledgerFixtures, projectFixture } from '@/test/fixtures';

const PROJECT = projectFixture({ id: 'proj-1', name: 'NE4 Rossdorf', code: 'NE4' });

const store = installFirebaseMocks(ledgerFixtures({ collections: { projects: [PROJECT] } }));

const firestore = await import('firebase/firestore');
const { renderScreen } = await import('@/test/renderScreen.jsx');
const { default: WipPanel } = await import('./WipPanel.jsx');

const USER = { uid: 'test-uid', email: 'jromero@umtelkomd.com' };

// LOCAL dates, never toISOString(): the app ages entries against local midnight,
// and in Europe/Berlin toISOString() lands on the previous day — which would
// make every age assertion here off by one for half the year.
const isoDaysAgo = (days) => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

const wipDoc = (overrides = {}) => ({
  id: 'wip-1',
  projectId: 'proj-1',
  projectName: 'NE4 Rossdorf',
  amount: 40000,
  asOf: isoDaysAgo(5),
  stage: 'executed',
  status: 'open',
  note: '',
  receivableId: null,
  createdBy: USER.email,
  createdAt: '2026-07-01T08:00:00.000Z',
  ...overrides,
});

const wipAddDocCalls = () =>
  firestore.addDoc.mock.calls.filter(([ref]) => String(ref?.path ?? '').endsWith('/workInProgress'));

beforeEach(() => {
  store.collections.workInProgress = [];
  store.errors = {};
  firestore.addDoc.mockClear();
  firestore.updateDoc.mockClear();
});

describe('WipPanel — showing the backlog', () => {
  it('invites the first entry instead of rendering a bare 0', () => {
    renderScreen(<WipPanel project={PROJECT} user={USER} />);

    expect(screen.getByText('Obra ejecutada sin facturar')).toBeInTheDocument();
    expect(screen.getByText(/Sin obra ejecutada registrada/)).toBeInTheDocument();
  });

  it('totals the current backlog of this obra', () => {
    store.collections.workInProgress = [
      wipDoc({ id: 'a', amount: 40000, stage: 'executed' }),
      wipDoc({ id: 'b', amount: 12000, stage: 'certified' }),
    ];

    renderScreen(<WipPanel project={PROJECT} user={USER} />);

    expect(screen.getByTestId('wip-total')).toHaveTextContent('52.000,00');
  });

  it('shows only the newest figure per stage — the rest is history', () => {
    store.collections.workInProgress = [
      wipDoc({ id: 'old', amount: 40000, asOf: isoDaysAgo(40) }),
      wipDoc({ id: 'new', amount: 55000, asOf: isoDaysAgo(3) }),
    ];

    renderScreen(<WipPanel project={PROJECT} user={USER} />);

    expect(screen.getByTestId('wip-total')).toHaveTextContent('55.000,00');
    expect(screen.queryByText('40.000,00')).not.toBeInTheDocument();
  });

  it('ignores the backlog of other obras', () => {
    store.collections.workInProgress = [
      wipDoc({ id: 'mine', amount: 40000 }),
      wipDoc({ id: 'theirs', projectId: 'proj-9', projectName: 'Otra obra', amount: 99000 }),
    ];

    renderScreen(<WipPanel project={PROJECT} user={USER} />);

    expect(screen.getByTestId('wip-total')).toHaveTextContent('40.000,00');
    expect(screen.queryByText('99.000,00')).not.toBeInTheDocument();
  });

  it('says plainly that money is frozen by paperwork once a cycle is missed', () => {
    store.collections.workInProgress = [wipDoc({ asOf: isoDaysAgo(75) })];

    renderScreen(<WipPanel project={PROJECT} user={USER} />);

    expect(screen.getByText('hace 75 días')).toBeInTheDocument();
    expect(screen.getByText(/congelado por papeleo/i)).toBeInTheDocument();
  });

  it('stays quiet while the work is inside the current certification cycle', () => {
    store.collections.workInProgress = [wipDoc({ asOf: isoDaysAgo(6) })];

    renderScreen(<WipPanel project={PROJECT} user={USER} />);

    expect(screen.queryByText(/congelado por papeleo/i)).not.toBeInTheDocument();
  });

  it('labels the two backlogs separately — they need different phone calls', () => {
    store.collections.workInProgress = [
      wipDoc({ id: 'a', amount: 40000, stage: 'executed' }),
      wipDoc({ id: 'b', amount: 12000, stage: 'certified' }),
    ];

    renderScreen(<WipPanel project={PROJECT} user={USER} />);

    // Scoped to the list: the same two labels are also the form's stage options.
    const rows = screen.getByTestId('wip-entries');
    expect(within(rows).getByText('Ejecutado sin certificar')).toBeInTheDocument();
    expect(within(rows).getByText('Certificado sin facturar')).toBeInTheDocument();
  });
});

describe('WipPanel — capture', () => {
  it('records a figure from amount + stage + date alone', async () => {
    renderScreen(<WipPanel project={PROJECT} user={USER} />);

    fireEvent.change(screen.getByLabelText('Importe (€)'), { target: { value: '55000' } });
    fireEvent.click(screen.getByRole('button', { name: /registrar/i }));

    await waitFor(() => expect(wipAddDocCalls()).toHaveLength(1));
    expect(wipAddDocCalls()[0][1]).toMatchObject({
      projectId: 'proj-1',
      projectName: 'NE4 Rossdorf',
      amount: 55000,
      stage: 'executed',
      status: 'open',
    });
  });

  it('defaults the date to today so the common case is zero typing', async () => {
    renderScreen(<WipPanel project={PROJECT} user={USER} />);

    expect(screen.getByLabelText('Medido el')).toHaveValue(isoDaysAgo(0));

    fireEvent.change(screen.getByLabelText('Importe (€)'), { target: { value: '1000' } });
    fireEvent.click(screen.getByRole('button', { name: /registrar/i }));

    await waitFor(() => expect(wipAddDocCalls()).toHaveLength(1));
    expect(wipAddDocCalls()[0][1].asOf).toBe(isoDaysAgo(0));
  });

  it('records the certified backlog when that stage is picked', async () => {
    renderScreen(<WipPanel project={PROJECT} user={USER} />);

    fireEvent.change(screen.getByLabelText('Importe (€)'), { target: { value: '12000' } });
    fireEvent.change(screen.getByLabelText('Estado'), { target: { value: 'certified' } });
    fireEvent.click(screen.getByRole('button', { name: /registrar/i }));

    await waitFor(() => expect(wipAddDocCalls()).toHaveLength(1));
    expect(wipAddDocCalls()[0][1].stage).toBe('certified');
  });

  it('carries an optional note through', async () => {
    renderScreen(<WipPanel project={PROJECT} user={USER} />);

    fireEvent.change(screen.getByLabelText('Importe (€)'), { target: { value: '1000' } });
    fireEvent.change(screen.getByLabelText('Nota (opcional)'), { target: { value: 'KW29 pendiente de Aufmaß' } });
    fireEvent.click(screen.getByRole('button', { name: /registrar/i }));

    await waitFor(() => expect(wipAddDocCalls()).toHaveLength(1));
    expect(wipAddDocCalls()[0][1].note).toBe('KW29 pendiente de Aufmaß');
  });

  it('refuses an empty amount on screen instead of writing a zero', async () => {
    renderScreen(<WipPanel project={PROJECT} user={USER} />);

    fireEvent.click(screen.getByRole('button', { name: /registrar/i }));

    expect(await screen.findByText(/importe/i, { selector: '[role="alert"]' })).toBeInTheDocument();
    expect(wipAddDocCalls()).toHaveLength(0);
  });

  it('clears the amount after a successful capture so the next one is fast', async () => {
    renderScreen(<WipPanel project={PROJECT} user={USER} />);

    const amount = screen.getByLabelText('Importe (€)');
    fireEvent.change(amount, { target: { value: '55000' } });
    fireEvent.click(screen.getByRole('button', { name: /registrar/i }));

    await waitFor(() => expect(amount).toHaveValue(null));
  });
});

describe('WipPanel — closing an entry', () => {
  it('closes the entry when the work finally reaches an invoice', async () => {
    store.collections.workInProgress = [wipDoc({ id: 'wip-1', amount: 40000 })];

    renderScreen(<WipPanel project={PROJECT} user={USER} />);

    fireEvent.click(screen.getByRole('button', { name: /facturado/i }));

    await waitFor(() => expect(firestore.updateDoc).toHaveBeenCalled());
    expect(firestore.updateDoc.mock.calls[0][1]).toMatchObject({ status: 'invoiced' });
    expect(firestore.deleteDoc).not.toHaveBeenCalled();
  });
});

describe('WipPanel — degraded states', () => {
  it('renders nothing without an obra rather than throwing', () => {
    renderScreen(<WipPanel project={null} user={USER} />);
    expect(screen.queryByTestId('wip-panel')).not.toBeInTheDocument();
  });

  it('warns instead of showing 0 when the listener fails', () => {
    store.errors = { workInProgress: new Error('permission-denied') };
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    renderScreen(<WipPanel project={PROJECT} user={USER} />);

    expect(screen.getByText(/No se pudo cargar/i)).toBeInTheDocument();
    spy.mockRestore();
  });

  it('scopes the backlog by project NAME when the entry carries no id', () => {
    store.collections.workInProgress = [
      wipDoc({ id: 'by-name', projectId: '', projectName: 'NE4 Rossdorf', amount: 7000 }),
    ];

    renderScreen(<WipPanel project={PROJECT} user={USER} />);

    expect(screen.getByTestId('wip-total')).toHaveTextContent('7.000,00');
  });
});
