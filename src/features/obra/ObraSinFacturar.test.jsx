/**
 * ObraSinFacturar — the weekly control of executed-not-invoiced work across
 * every obra. The two things that must hold: every active obra is on screen
 * (including the ones never measured), and updating a figure is type + Enter.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { installFirebaseMocks } from '@/test/firebaseMock';
import { ledgerFixtures, projectFixture } from '@/test/fixtures';

const QFF = projectFixture({ id: 'p-qff', name: 'Roßdorf', code: 'QFF', status: 'active' });
const WSC = projectFixture({ id: 'p-wsc', name: 'Wesconnect', code: 'WSC', status: 'active' });
const OLD = projectFixture({ id: 'p-old', name: 'Langenau', code: 'LANG', status: 'inactive' });

const store = installFirebaseMocks(ledgerFixtures({ collections: { projects: [QFF, WSC, OLD] } }));

const firestore = await import('firebase/firestore');
const { renderScreen } = await import('@/test/renderScreen.jsx');
const { default: ObraSinFacturar } = await import('./ObraSinFacturar.jsx');

const USER = { uid: 'test-uid', email: 'jromero@umtelkomd.com' };

const isoDaysAgo = (days) => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

const wipDoc = (overrides = {}) => ({
  id: 'wip-1', projectId: 'p-qff', projectName: 'Roßdorf', amount: 22000, asOf: isoDaysAgo(41),
  stage: 'executed', status: 'open', note: '', createdAt: '2026-08-01T08:00:00.000Z', ...overrides,
});

const wipAddDocCalls = () =>
  firestore.addDoc.mock.calls.filter(([ref]) => String(ref?.path ?? '').endsWith('/workInProgress'));

beforeEach(() => {
  store.collections.workInProgress = [];
  store.errors = {};
  firestore.addDoc.mockClear();
  firestore.updateDoc.mockClear();
});

describe('ObraSinFacturar', () => {
  it('lists every active obra, even the ones never measured, and hides inactive ones', async () => {
    renderScreen(<ObraSinFacturar user={USER} />);

    expect(await screen.findByTestId('wip-row-p-qff')).toBeInTheDocument();
    expect(screen.getByTestId('wip-row-p-wsc')).toBeInTheDocument();
    expect(screen.queryByTestId('wip-row-p-old')).not.toBeInTheDocument();
    expect(within(screen.getByTestId('wip-row-p-wsc')).getByText('nunca')).toBeInTheDocument();
  });

  it('shows the current backlog, its age and the trend against the previous figure', async () => {
    store.collections.workInProgress = [
      wipDoc({ id: 'a', amount: 18000, asOf: isoDaysAgo(60) }),
      wipDoc({ id: 'b', amount: 22000, asOf: isoDaysAgo(41) }),
    ];

    renderScreen(<ObraSinFacturar user={USER} />);

    const row = await screen.findByTestId('wip-row-p-qff');
    expect(within(row).getByText(/^22\.000,00/)).toBeInTheDocument();
    expect(within(row).getByText('hace 41 d')).toBeInTheDocument();
    expect(within(row).getByText(/\+4\.000,00/)).toBeInTheDocument();
  });

  it('records a new figure for today on Enter', async () => {
    renderScreen(<ObraSinFacturar user={USER} />);

    const input = await screen.findByLabelText('Ejecutado sin certificar · Wesconnect');
    fireEvent.change(input, { target: { value: '12300' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(wipAddDocCalls()).toHaveLength(1));
    expect(wipAddDocCalls()[0][1]).toMatchObject({ projectId: 'p-wsc', amount: 12300, stage: 'executed', asOf: isoDaysAgo(0) });
  });

  it('closes the current figure when 0 is entered', async () => {
    store.collections.workInProgress = [wipDoc({ id: 'open-1' })];

    renderScreen(<ObraSinFacturar user={USER} />);

    const input = await screen.findByLabelText('Ejecutado sin certificar · Roßdorf');
    fireEvent.change(input, { target: { value: '0' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(firestore.updateDoc).toHaveBeenCalled());
    expect(wipAddDocCalls()).toHaveLength(0);
  });
});
