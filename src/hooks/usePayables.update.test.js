/**
 * updatePayable — partial update semantics.
 *
 * Mirror of `useReceivables.update.test.js`; the two hooks carried the same
 * defect as `updateBankMovement` did before `buildMovementUpdatePayload`.
 * Every key was written as `data.field || ''`, and the money block was derived
 * from `clampMoney(data.amount)` — which is 0 when the caller sends no amount,
 * so a partial call zeroed an open CXP and marked it settled.
 *
 * A CXP loses more than a CXC on a wipe: `vendor` is the alias the whole
 * supplier view reads, and the payroll/ops-gate markers sit on the same
 * document (they are not in the payload at all, and these tests keep it that
 * way).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const firestoreMocks = vi.hoisted(() => ({
  addDoc: vi.fn(),
  arrayUnion: vi.fn((...items) => items),
  collection: vi.fn(() => ({ path: 'payables' })),
  deleteDoc: vi.fn(),
  doc: vi.fn((_db, ...segments) => ({ path: segments.join('/'), id: segments[segments.length - 1] })),
  getDocs: vi.fn(),
  limit: vi.fn(),
  onSnapshot: vi.fn(() => () => {}),
  orderBy: vi.fn(),
  query: vi.fn(),
  runTransaction: vi.fn(),
  serverTimestamp: vi.fn(() => 'SERVER_TIMESTAMP'),
  updateDoc: vi.fn(),
  where: vi.fn(),
}));

const auditMocks = vi.hoisted(() => ({ writeAuditLogEntry: vi.fn() }));

vi.mock('react', () => ({
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, vi.fn()],
  useMemo: (factory) => factory(),
  useEffect: vi.fn(),
}));

vi.mock('firebase/firestore', () => firestoreMocks);

vi.mock('../services/firebase', () => ({
  db: { mocked: true },
  appId: 'test-app',
}));

vi.mock('../utils/auditLog', () => auditMocks);

vi.mock('../utils/logger', () => ({ logError: vi.fn() }));

const { usePayables } = await import('./usePayables.js');

const USER = { email: 'jarl@example.com' };

/** A live CXP as it sits in Firestore. */
const storedPayable = (overrides = {}) => ({
  id: 'cxp-1',
  currency: 'EUR',
  status: 'issued',
  grossAmount: 4000,
  amount: 4000,
  openAmount: 4000,
  pendingAmount: 4000,
  paidAmount: 0,
  issueDate: '2026-06-05',
  dueDate: '2026-07-05',
  description: 'Material fibra',
  counterpartyName: 'Kabel Service GmbH',
  vendor: 'Kabel Service GmbH',
  documentNumber: 'ER-2026-044',
  invoiceNumber: 'ER-2026-044',
  projectId: 'proj-1',
  projectName: 'NE4 Rossdorf',
  costCenterId: 'CC1',
  categoryName: 'Material',
  ...overrides,
});

/** Exactly what CanonicalRecordModal + CXPIndependiente send today. */
const modalFormData = (overrides = {}) => ({
  direction: 'out',
  amount: 5000,
  postedDate: '',
  issueDate: '2026-06-05',
  dueDate: '2026-07-05',
  description: 'Material fibra',
  counterpartyName: 'Kabel Service GmbH',
  documentNumber: 'ER-2026-044',
  projectId: 'proj-1',
  projectName: 'NE4 Rossdorf',
  costCenterId: 'CC1',
  categoryName: 'Material',
  forceStatus: '',
  correctionReason: '',
  ...overrides,
});

const writtenPayload = () => {
  expect(firestoreMocks.updateDoc).toHaveBeenCalledTimes(1);
  return firestoreMocks.updateDoc.mock.calls[0][1];
};

const MONEY_KEYS = ['grossAmount', 'amount', 'openAmount', 'pendingAmount', 'status'];
const TEXT_KEYS = [
  'description',
  'counterpartyName',
  'vendor',
  'documentNumber',
  'invoiceNumber',
  'projectId',
  'projectName',
  'costCenterId',
  'categoryName',
];

beforeEach(() => {
  vi.clearAllMocks();
  firestoreMocks.updateDoc.mockResolvedValue(undefined);
  auditMocks.writeAuditLogEntry.mockResolvedValue(undefined);
});

describe('updatePayable — omitted fields are left alone', () => {
  it('does not clobber the text fields the caller did not send', async () => {
    const { updatePayable } = usePayables(USER);

    expect(await updatePayable(storedPayable(), { description: 'Solo descripción' }))
      .toEqual({ success: true });

    const payload = writtenPayload();
    expect(payload.description).toBe('Solo descripción');
    TEXT_KEYS.filter((key) => key !== 'description').forEach((key) => {
      expect(payload).not.toHaveProperty(key);
    });
  });

  it('never zeroes the invoice when the caller sends no amount', async () => {
    const { updatePayable } = usePayables(USER);

    await updatePayable(storedPayable(), { projectId: 'proj-2', projectName: 'NE4 Dieburg' });

    const payload = writtenPayload();
    MONEY_KEYS.forEach((key) => expect(payload).not.toHaveProperty(key));
  });

  it('leaves a cancelled invoice cancelled on a metadata-only edit', async () => {
    const { updatePayable } = usePayables(USER);
    const cancelled = storedPayable({ status: 'cancelled', openAmount: 0, pendingAmount: 0 });

    await updatePayable(cancelled, { categoryName: 'Otros' });

    expect(writtenPayload()).not.toHaveProperty('status');
  });

  it('never touches the payroll and ops-gate markers', async () => {
    const { updatePayable } = usePayables(USER);
    const payroll = storedPayable({
      payrollPeriodId: '2026-06',
      payrollKind: 'net',
      opsGateRequired: false,
      opsCleared: true,
      employeeIds: ['emp-1'],
    });

    await updatePayable(payroll, modalFormData());

    const payload = writtenPayload();
    ['payrollPeriodId', 'payrollKind', 'opsGateRequired', 'opsCleared', 'employeeIds', 'payments']
      .forEach((key) => expect(payload).not.toHaveProperty(key));
  });

  it('keeps the stored dates instead of writing undefined over them', async () => {
    const { updatePayable } = usePayables(USER);

    await updatePayable(storedPayable(), { description: 'x' });

    const payload = writtenPayload();
    expect(payload).not.toHaveProperty('issueDate');
    expect(payload).not.toHaveProperty('dueDate');
  });
});

describe('updatePayable — explicit clears still land', () => {
  it('writes an empty string when the caller deliberately clears a field', async () => {
    const { updatePayable } = usePayables(USER);

    await updatePayable(storedPayable(), { projectId: '', projectName: '', categoryName: '' });

    const payload = writtenPayload();
    expect(payload.projectId).toBe('');
    expect(payload.projectName).toBe('');
    expect(payload.categoryName).toBe('');
  });

  it('carries counterpartyName and documentNumber onto their legacy aliases', async () => {
    const { updatePayable } = usePayables(USER);

    await updatePayable(storedPayable(), {
      counterpartyName: 'Otro proveedor',
      documentNumber: 'ER-2026-999',
    });

    const payload = writtenPayload();
    expect(payload.vendor).toBe('Otro proveedor');
    expect(payload.invoiceNumber).toBe('ER-2026-999');
  });
});

describe('updatePayable — the full form still behaves exactly as before', () => {
  it('restates the money block when the caller sends an amount', async () => {
    const { updatePayable } = usePayables(USER);

    await updatePayable(storedPayable(), modalFormData());

    expect(writtenPayload()).toMatchObject({
      grossAmount: 5000,
      amount: 5000,
      openAmount: 5000,
      pendingAmount: 5000,
      status: 'issued',
      vendor: 'Kabel Service GmbH',
      invoiceNumber: 'ER-2026-044',
      issueDate: '2026-06-05',
      dueDate: '2026-07-05',
    });
  });

  it('refuses an amount below what was already paid', async () => {
    const { updatePayable } = usePayables(USER);
    const partial = storedPayable({ status: 'partial', paidAmount: 1500, openAmount: 2500 });

    const result = await updatePayable(partial, modalFormData({ amount: 500 }));

    expect(result.success).toBe(false);
    expect(result.error.message).toMatch(/por debajo de lo ya pagado/);
    expect(firestoreMocks.updateDoc).not.toHaveBeenCalled();
  });

  it('keeps a partially paid invoice partial and nets off what was paid', async () => {
    const { updatePayable } = usePayables(USER);
    const partial = storedPayable({ status: 'partial', paidAmount: 1500, openAmount: 2500 });

    await updatePayable(partial, modalFormData({ amount: 5000 }));

    expect(writtenPayload()).toMatchObject({
      grossAmount: 5000,
      openAmount: 3500,
      pendingAmount: 3500,
      status: 'partial',
    });
  });
});

describe('updatePayable — admin status override', () => {
  it('reopens the invoice and drops its payments on forceStatus "issued"', async () => {
    const { updatePayable } = usePayables(USER);
    const settled = storedPayable({ status: 'settled', paidAmount: 4000, openAmount: 0 });

    await updatePayable(settled, modalFormData({ amount: 4000, forceStatus: 'issued' }));

    expect(writtenPayload()).toMatchObject({
      status: 'issued',
      openAmount: 4000,
      paidAmount: 0,
      payments: [],
    });
  });

  it('closes the invoice on forceStatus "settled" without an amount in the payload', async () => {
    const { updatePayable } = usePayables(USER);

    await updatePayable(storedPayable(), { forceStatus: 'settled', correctionReason: 'DATEV' });

    expect(writtenPayload()).toMatchObject({
      status: 'settled',
      openAmount: 0,
      paidAmount: 4000,
      grossAmount: 4000,
    });
  });

  it('cancels without inventing a new gross amount', async () => {
    const { updatePayable } = usePayables(USER);

    await updatePayable(storedPayable(), { forceStatus: 'cancelled', correctionReason: 'Duplicada' });

    expect(writtenPayload()).toMatchObject({
      status: 'cancelled',
      openAmount: 0,
      grossAmount: 4000,
    });
  });
});
