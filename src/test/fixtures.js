/**
 * Firestore document fixtures for screen tests.
 *
 * Every builder emits a RAW Firestore shape — the same fields the adapters in
 * `src/finance/adapters.js` read — so screens run through the real adaptation
 * path instead of being fed pre-adapted objects that could drift from reality.
 *
 * Dates are relative to the day the test runs (`isoDaysFromNow`), never
 * hard-coded. A fixture pinned to a literal date silently stops being "overdue"
 * or "upcoming" as the calendar moves, and the assertions that depend on it rot.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** ISO date `offset` days from today (negative = past). */
export const isoDaysFromNow = (offset = 0) =>
  new Date(Date.now() + offset * DAY_MS).toISOString().slice(0, 10);

/** ISO date inside the current calendar month, clamped so it never overflows. */
export const isoThisMonth = (day = 5) => {
  const now = new Date();
  const lastDay = new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 0)).getUTCDate();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    Math.min(day, lastDay),
  ).padStart(2, '0')}`;
};

let sequence = 0;
const nextId = (prefix) => `${prefix}-${(sequence += 1)}`;

/** Raw `bankMovements` doc — the canonical cash ledger row. */
export const bankMovementFixture = (overrides = {}) => ({
  id: nextId('mov'),
  accountId: 'main',
  currency: 'EUR',
  kind: 'payment',
  status: 'posted',
  direction: 'out',
  amount: 500,
  postedDate: isoThisMonth(5),
  valueDate: isoThisMonth(5),
  description: 'Movimiento de prueba',
  counterpartyName: 'Proveedor GmbH',
  documentNumber: '',
  projectId: '',
  projectName: 'Sin proyecto',
  costCenterId: '',
  categoryName: '',
  ...overrides,
});

/** Raw `receivables` doc (CXC). `openAmount` drives aging and the CXC totals. */
export const receivableFixture = (overrides = {}) => ({
  id: nextId('cxc'),
  accountId: 'main',
  currency: 'EUR',
  status: 'issued',
  amount: 10000,
  openAmount: 10000,
  paidAmount: 0,
  issueDate: isoDaysFromNow(-60),
  dueDate: isoDaysFromNow(-30),
  counterpartyName: 'Insyte Deutschland',
  description: 'Certificación julio',
  documentNumber: 'RE-2026-001',
  projectId: 'proj-1',
  projectName: 'NE4 Rossdorf',
  payments: [],
  ...overrides,
});

/** Raw `payables` doc (CXP). */
export const payableFixture = (overrides = {}) => ({
  id: nextId('cxp'),
  accountId: 'main',
  currency: 'EUR',
  status: 'issued',
  amount: 4000,
  openAmount: 4000,
  paidAmount: 0,
  issueDate: isoDaysFromNow(-45),
  dueDate: isoDaysFromNow(-20),
  counterpartyName: 'Kabel Service GmbH',
  description: 'Material fibra',
  documentNumber: 'ER-2026-044',
  projectId: 'proj-1',
  projectName: 'NE4 Rossdorf',
  payments: [],
  ...overrides,
});

/** Raw `projects` doc. */
export const projectFixture = (overrides = {}) => ({
  id: nextId('proj'),
  name: 'NE4 Rossdorf',
  status: 'active',
  budget: 100000,
  ...overrides,
});

/** `settings/reconciliation` — the anchor the cash position derives from. */
export const reconciliationDoc = (anchors) => ({
  anchors: anchors ?? [
    { date: isoDaysFromNow(-10), balance: 25000, source: 'DATEV SuSa 1200', note: '' },
  ],
});

/** `settings/bankAccount`. */
export const bankAccountDoc = (overrides = {}) => ({
  bankName: 'Commerzbank',
  balance: 25000,
  balanceDate: isoDaysFromNow(-10),
  creditLineLimit: 0,
  ...overrides,
});

/**
 * A coherent, non-empty ledger: cash in the bank, one overdue invoice on each
 * side, one project. Spread the result straight into `installFirebaseMocks`.
 *
 * Cash is deterministic by construction — the anchor sits 10 days back and all
 * three movements land after it:
 *   25.000 (anchor) + 42.000 − 12.000 − 3.000 = 52.000 €
 * Project margin: NE4 Rossdorf +30.000, unassigned −3.000.
 * The newest movement is one day old, so `detectImportGap` stays quiet.
 *
 * @param {{ collections?: object, documents?: object }} [overrides] merged shallowly
 */
export const ledgerFixtures = (overrides = {}) => ({
  collections: {
    bankMovements: [
      bankMovementFixture({
        direction: 'in',
        amount: 42000,
        description: 'Cobro Insyte',
        counterpartyName: 'Insyte Deutschland',
        projectId: 'proj-1',
        projectName: 'NE4 Rossdorf',
        postedDate: isoDaysFromNow(-8),
      }),
      bankMovementFixture({
        direction: 'out',
        amount: 12000,
        description: 'Pago proveedor',
        projectId: 'proj-1',
        projectName: 'NE4 Rossdorf',
        postedDate: isoDaysFromNow(-5),
      }),
      bankMovementFixture({
        direction: 'out',
        amount: 3000,
        description: 'Alquiler oficina',
        projectName: 'Sin proyecto',
        postedDate: isoDaysFromNow(-1),
      }),
    ],
    receivables: [receivableFixture()],
    payables: [payableFixture()],
    projects: [projectFixture({ id: 'proj-1' })],
    budgets: [],
    transactions: [],
    employees: [],
    payrollPeriods: [],
    recurringCosts: [],
    classificationRules: [],
    costCenters: [],
    categories: [],
    ...(overrides.collections || {}),
  },
  documents: {
    reconciliation: reconciliationDoc(),
    bankAccount: bankAccountDoc(),
    treasury: { vatEstimates: [], alertBufferEur: 10000 },
    ...(overrides.documents || {}),
  },
});
