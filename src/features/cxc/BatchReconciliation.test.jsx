/**
 * Batch reconciliation screen — the confirming remesa desk.
 *
 * What these tests protect is the reason the screen exists: the operator picks
 * one incoming transfer, ticks the invoices it covers, and the DIFFERENCE stays
 * on screen the whole time. A batch that does not add up is the signal that
 * something is missing — it must never be rounded away or hidden behind a
 * disabled button with no explanation.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { installFirebaseMocks } from '@/test/firebaseMock';
import { bankMovementFixture, ledgerFixtures, receivableFixture } from '@/test/fixtures';

// The payer is BBVA; the client only appears inside the DATEV purpose text.
const CONFIRMING = bankMovementFixture({
  id: 'mov-confirming',
  direction: 'in',
  kind: 'collection',
  amount: 10000,
  postedDate: '2026-07-17',
  valueDate: '2026-07-17',
  counterpartyName: 'BANCO BILBAO VIZCAYA ARGENTARIA S',
  description: 'SETTLEMENT BBVACONFIRMING ADVANCE INSYTE DEUTSCHLAND GMBH',
});

const TAX_REFUND = bankMovementFixture({
  id: 'mov-finanzamt',
  direction: 'in',
  amount: 2500,
  postedDate: '2026-07-10',
  counterpartyName: 'Finanzkasse Stralsund',
  description: 'EREF+082/121/02610 ERSTATTUNG',
});

const invoice = (id, amount, documentNumber, overrides = {}) =>
  receivableFixture({
    id,
    amount,
    grossAmount: amount,
    openAmount: amount,
    documentNumber,
    counterpartyName: 'Insyte Deutschland GmbH',
    issueDate: '2026-06-01',
    dueDate: '2026-07-01',
    ...overrides,
  });

const SIX = invoice('cxc-six', 6000, 'RE-2026-001');
const FOUR = invoice('cxc-four', 4000, 'RE-2026-002', { issueDate: '2026-06-05' });
const THREE = invoice('cxc-three', 3000, 'RE-2026-003', { issueDate: '2026-06-08' });

const store = installFirebaseMocks(
  ledgerFixtures({
    collections: {
      bankMovements: [CONFIRMING, TAX_REFUND],
      receivables: [SIX, FOUR, THREE],
    },
  }),
);

const firestore = await import('firebase/firestore');
const { renderScreen } = await import('@/test/renderScreen.jsx');
const { default: BatchReconciliation } = await import('./BatchReconciliation.jsx');

const USER = { uid: 'test-uid', email: 'jromero@umtelkomd.com' };

const setCollections = (receivables, bankMovements = [CONFIRMING, TAX_REFUND]) => {
  const pristine = ledgerFixtures();
  Object.assign(store.collections, pristine.collections);
  Object.assign(store.documents, pristine.documents);
  store.collections.bankMovements = bankMovements;
  store.collections.receivables = receivables;
};

const render = (role = 'admin') => renderScreen(<BatchReconciliation user={USER} userRole={role} />);

const selectConfirming = () => {
  fireEvent.click(screen.getByRole('button', { name: /BANCO BILBAO/i }));
};

const candidateRow = (documentNumber) =>
  screen.getByRole('row', { name: new RegExp(documentNumber) });

const tick = (documentNumber) => {
  fireEvent.click(within(candidateRow(documentNumber)).getByRole('checkbox'));
};

const differenceValue = () => screen.getByTestId('batch-difference').textContent;

beforeEach(() => {
  setCollections([SIX, FOUR, THREE]);
  firestore.writeBatch.mockClear();
});

describe('BatchReconciliation — the pending batches', () => {
  it('lists incoming movements that are not yet linked to any invoice', () => {
    render();

    expect(screen.getByRole('heading', { name: /Conciliación de remesas/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /BANCO BILBAO/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Finanzkasse/i })).toBeInTheDocument();
  });

  it('says on each row how many invoices it could cover', () => {
    // Every unlinked inbound movement lands here — tax refunds and interest
    // included. Without this count the list is a wall of dead ends.
    render();

    expect(screen.getByRole('button', { name: /BANCO BILBAO/i })).toHaveTextContent('3 facturas');
    expect(screen.getByRole('button', { name: /Finanzkasse/i })).toHaveTextContent(/sin facturas/i);
  });

  it('keeps a transfer that is only half explained, and measures against the rest', () => {
    setCollections(
      [FOUR],
      [
        {
          ...CONFIRMING,
          receivableId: 'cxc-six',
          receivableIds: ['cxc-six'],
          receivableAllocations: [{ documentId: 'cxc-six', amount: 6000 }],
          reconciledAmount: 6000,
        },
      ],
    );
    render();
    selectConfirming();

    expect(differenceValue()).toContain('4.000,00');
    tick('RE-2026-002');
    expect(screen.getByTestId('batch-status')).toHaveTextContent(/Cuadra/i);
  });

  it('leaves out movements already reconciled against invoices', () => {
    setCollections(
      [SIX],
      [{ ...CONFIRMING, receivableIds: ['cxc-six'], receivableId: 'cxc-six' }, TAX_REFUND],
    );
    render();

    expect(screen.queryByRole('button', { name: /BANCO BILBAO/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Finanzkasse/i })).toBeInTheDocument();
  });
});

describe('BatchReconciliation — candidates and the difference', () => {
  it('shows the invoices of the client named inside the DATEV description', () => {
    render();
    selectConfirming();

    ['RE-2026-001', 'RE-2026-002', 'RE-2026-003'].forEach((documentNumber) => {
      expect(candidateRow(documentNumber)).toBeInTheDocument();
    });
  });

  it('starts with the whole transfer unexplained', () => {
    render();
    selectConfirming();

    expect(differenceValue()).toContain('10.000,00');
    expect(screen.getByTestId('batch-status')).toHaveTextContent(/Falta/i);
  });

  it('keeps the shortfall on screen while the selection is incomplete', () => {
    render();
    selectConfirming();
    tick('RE-2026-001');

    expect(screen.getByTestId('batch-selected')).toHaveTextContent('6.000,00');
    expect(differenceValue()).toContain('4.000,00');
    expect(screen.getByTestId('batch-status')).toHaveTextContent(/Falta/i);
  });

  it('reports an exact batch once the ticked invoices add up', () => {
    render();
    selectConfirming();
    tick('RE-2026-001');
    tick('RE-2026-002');

    expect(screen.getByTestId('batch-status')).toHaveTextContent(/Cuadra/i);
    expect(differenceValue()).toContain('0,00');
  });

  it('warns and blocks when more is ticked than the bank sent', () => {
    render();
    selectConfirming();
    tick('RE-2026-001');
    tick('RE-2026-002');
    tick('RE-2026-003');

    expect(screen.getByTestId('batch-status')).toHaveTextContent(/Excede/i);
    expect(screen.getByRole('button', { name: /^Conciliar/i })).toBeDisabled();
  });

  it('explains itself when the transfer matches no invoice at all', () => {
    render();
    fireEvent.click(screen.getByRole('button', { name: /Finanzkasse/i }));

    expect(screen.getByText(/no encontramos facturas abiertas/i)).toBeInTheDocument();
  });

  it('offers invoices the bulk closing script closed, flagged as pending', () => {
    setCollections([
      invoice('cxc-bulk', 10000, 'RE-2026-009', {
        status: 'settled',
        openAmount: 0,
        paidAmount: 10000,
        reconciliationPending: true,
        payments: [{ id: 'bulk-settle-2026-07-27', amount: 10000, date: '2026-07-27' }],
      }),
    ]);
    render();
    selectConfirming();

    expect(within(candidateRow('RE-2026-009')).getByText(/Cierre masivo/i)).toBeInTheDocument();
  });
});

describe('BatchReconciliation — suggest', () => {
  it('ticks the one combination that adds up', () => {
    render();
    selectConfirming();
    fireEvent.click(screen.getByRole('button', { name: /Sugerir/i }));

    expect(within(candidateRow('RE-2026-001')).getByRole('checkbox')).toBeChecked();
    expect(within(candidateRow('RE-2026-002')).getByRole('checkbox')).toBeChecked();
    expect(within(candidateRow('RE-2026-003')).getByRole('checkbox')).not.toBeChecked();
  });

  it('refuses to guess when several combinations reach the same total', () => {
    setCollections([SIX, FOUR, invoice('cxc-ten', 10000, 'RE-2026-010')]);
    render();
    selectConfirming();
    fireEvent.click(screen.getByRole('button', { name: /Sugerir/i }));

    expect(screen.getByText(/varias combinaciones posibles/i)).toBeInTheDocument();
    screen.getAllByRole('checkbox').forEach((box) => expect(box).not.toBeChecked());
  });

  it('says so when nothing adds up instead of proposing the closest guess', () => {
    setCollections([invoice('cxc-a', 3000, 'RE-2026-011'), invoice('cxc-b', 2500, 'RE-2026-012')]);
    render();
    selectConfirming();
    fireEvent.click(screen.getByRole('button', { name: /Sugerir/i }));

    expect(screen.getByText(/Ninguna combinación/i)).toBeInTheDocument();
  });
});

describe('BatchReconciliation — applying', () => {
  it('writes the remesa in one batch when the operator confirms', async () => {
    render();
    selectConfirming();
    tick('RE-2026-001');
    tick('RE-2026-002');

    fireEvent.click(screen.getByRole('button', { name: /^Conciliar/i }));

    await screen.findByText(/2 facturas conciliadas/i);
    expect(firestore.writeBatch).toHaveBeenCalledTimes(1);
  });

  it('never applies anything on its own — nothing is written before the click', () => {
    render();
    selectConfirming();
    fireEvent.click(screen.getByRole('button', { name: /Sugerir/i }));

    expect(firestore.writeBatch).not.toHaveBeenCalled();
  });

  it('keeps the write out of reach for a role that may not act', () => {
    render('editor');
    selectConfirming();
    tick('RE-2026-001');

    expect(screen.getByRole('button', { name: /^Conciliar/i })).toBeDisabled();
  });
});
