/**
 * ExecutiveSummary — the report that disagreed with Resumen.
 *
 * It filtered open invoices by the selected year, so its "liquidity" dropped
 * every receivable issued in 2025 or with a blank issueDate, and it printed the
 * raw runway ("-0.3 meses"). Both numbers now come from the shared
 * LiquidityKpis fed by the one formula in useTreasuryMetrics.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { installFirebaseMocks } from '@/test/firebaseMock';
import { isoDaysFromNow, ledgerFixtures, receivableFixture } from '@/test/fixtures';

const store = installFirebaseMocks(ledgerFixtures());

const { renderScreen } = await import('@/test/renderScreen.jsx');
const { default: ExecutiveSummary } = await import('./ExecutiveSummary.jsx');

const USER = { uid: 'test-uid', email: 'jromero@umtelkomd.com' };

beforeEach(() => {
  const pristine = ledgerFixtures();
  Object.assign(store.collections, pristine.collections);
  Object.assign(store.documents, pristine.documents);
});

describe('ExecutiveSummary — shared liquidity trio', () => {
  it('prints Caja / Posición neta / Runway with the same figures as Resumen', () => {
    renderScreen(<ExecutiveSummary user={USER} />);

    expect(screen.getByText('Caja')).toBeInTheDocument();
    expect(screen.getByText('52.000,00')).toBeInTheDocument();
    expect(screen.getByText('Posición neta')).toBeInTheDocument();
    // 52.000 + 10.000 open receivable − 4.000 open payable.
    expect(screen.getByText('58.000,00')).toBeInTheDocument();
    expect(screen.getByText('Runway')).toBeInTheDocument();
    expect(screen.getByText('CXC vencida')).toBeInTheDocument();
    expect(screen.queryByText('Liquidez proyectada')).not.toBeInTheDocument();
    expect(screen.queryByText('Cobertura de caja')).not.toBeInTheDocument();
  });

  it('keeps an open invoice issued last year in the position whatever the year filter says', () => {
    store.collections.receivables = [
      receivableFixture({ id: 'cxc-2025', openAmount: 120, amount: 120, issueDate: '2025-11-03', dueDate: isoDaysFromNow(20) }),
    ];

    renderScreen(<ExecutiveSummary user={USER} />);

    // 52.000 + 120 − 4.000 with the current year selected by default…
    expect(screen.getByText('48.120,00')).toBeInTheDocument();

    // …and still 48.120 after switching the year filter.
    fireEvent.click(screen.getByRole('button', { name: 'Todos los años' }));
    expect(screen.getByText('48.120,00')).toBeInTheDocument();
  });

  it('never prints a negative runway when the cash is below zero', () => {
    store.documents.reconciliation = {
      anchors: [{ date: isoDaysFromNow(-10), balance: -40000, source: 'DATEV SuSa 1200' }],
    };

    renderScreen(<ExecutiveSummary user={USER} />);

    const runway = screen.getByText('Runway').closest('div').parentElement;
    expect(within(runway).getByText('Bajo cero')).toBeInTheDocument();
    expect(screen.queryByText(/-\d+[.,]\d+ meses/)).not.toBeInTheDocument();
  });
});
