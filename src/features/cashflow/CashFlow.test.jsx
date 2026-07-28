/**
 * CashFlow (/cashflow) — the VAT obligation panel.
 *
 * Treasury decisions are taken on this screen, and until now the Umsatzsteuer
 * was invisible here: it only existed as a manual figure in
 * `settings/treasury.vatEstimates`, which is empty in production. These tests
 * mount the real screen over faked Firestore and assert that the derived VAT
 * reaches the user WITH its coverage caveat — a number presented as exact when
 * it is only an estimate is worse than no number.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { installFirebaseMocks } from '@/test/firebaseMock';
import { bankMovementFixture, isoThisMonth, ledgerFixtures, receivableFixture } from '@/test/fixtures';
import { vatDueDate } from '@/lib/finance/fiscalCalendar';
import { formatDate } from '@/utils/formatters';

const store = installFirebaseMocks(ledgerFixtures());

const { renderScreen } = await import('@/test/renderScreen.jsx');
const { default: CashFlow } = await import('./CashFlow.jsx');

const USER = { uid: 'test-uid', email: 'jromero@umtelkomd.com' };

const THIS_MONTH = isoThisMonth(5).slice(0, 7);

/** Ledger where every VAT-relevant record sits inside the current month. */
const vatLedger = () => {
  const pristine = ledgerFixtures();
  Object.assign(store.collections, pristine.collections, {
    // 11.900 € invoiced at 19% → 1.900 € repercutido.
    receivables: [
      receivableFixture({ issueDate: isoThisMonth(5), amount: 11900, openAmount: 0, status: 'settled', taxRate: 0.19 }),
    ],
    bankMovements: [
      // 5.950 € of materials at 19% → 950 € soportado.
      bankMovementFixture({ direction: 'out', amount: 5950, categoryName: 'Materiales', postedDate: isoThisMonth(6) }),
      // 4.050 € nobody classified → no rate, and it drags coverage down.
      bankMovementFixture({ direction: 'out', amount: 4050, categoryName: '', postedDate: isoThisMonth(7) }),
    ],
  });
  Object.assign(store.documents, pristine.documents, {
    vatRates: { rates: { Materiales: 0.19 } },
  });
  store.errors = {};
  store.auth.permissions = null;
  store.auth.userRole = 'admin';
};

const vatPanel = () => screen.getByText('IVA por liquidar').closest('section');

beforeEach(vatLedger);

describe('CashFlow — IVA por liquidar', () => {
  it('lists the derived obligation with its month, amount and filing date', () => {
    renderScreen(<CashFlow user={USER} />);

    const panel = vatPanel();
    // 1.900 repercutido − 950 soportado.
    expect(within(panel).getByText('950,00')).toBeInTheDocument();
    expect(within(panel).getByText(formatDate(vatDueDate(THIS_MONTH)))).toBeInTheDocument();
  });

  it('says out loud which share of the amounts the estimate stands on', () => {
    renderScreen(<CashFlow user={USER} />);

    // 17.850 € of 21.900 € carry a known rate → 82%.
    expect(within(vatPanel()).getByText(/Estimado sobre el 82% de los importes clasificados/)).toBeInTheDocument();
  });

  it('shows the manually entered amount instead, with no estimate caveat', () => {
    store.documents.treasury = {
      vatEstimates: [{ month: THIS_MONTH, amount: 3000 }],
      alertBufferEur: 10000,
    };

    renderScreen(<CashFlow user={USER} />);

    const panel = vatPanel();
    expect(within(panel).getByText('3.000,00')).toBeInTheDocument();
    expect(within(panel).getByText('Manual')).toBeInTheDocument();
    expect(within(panel).queryByText(/Estimado sobre el/)).not.toBeInTheDocument();
  });

  it('explains the absence instead of showing an empty table', () => {
    store.collections.receivables = [];
    store.collections.bankMovements = [];

    renderScreen(<CashFlow user={USER} />);

    expect(within(vatPanel()).getByText(/Sin IVA estimado/)).toBeInTheDocument();
  });
});
