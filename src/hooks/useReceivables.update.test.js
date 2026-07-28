/**
 * updateReceivable — partial update semantics.
 *
 * Same defect class as `updateBankMovement` (fixed by
 * `buildMovementUpdatePayload`): the payload wrote a default for EVERY field,
 * so anything the caller omitted was overwritten. On a CXC the blast radius is
 * wider than on a movement, because the money block is DERIVED:
 *
 *   `grossAmount = clampMoney(data.amount)` with no amount supplied → 0, which
 *   then produced `openAmount: 0`, `pendingAmount: 0` and `status: 'settled'`.
 *   One partial call therefore zeroed an open invoice and closed it.
 *
 * The text fields wiped their stored value the same way (`data.field || ''`),
 * dragging `client` and `invoiceNumber` along as aliases.
 *
 * The rule these tests pin: a key is written only when the caller actually
 * supplied it. `''` still means "clear this", so choosing "sin proyecto" in the
 * form keeps working, and the money block is only restated when the caller sent
 * an amount or forced a status.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const firestoreMocks = vi.hoisted(() => ({
  addDoc: vi.fn(),
  arrayUnion: vi.fn((...items) => items),
  collection: vi.fn(() => ({ path: 'receivables' })),
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
  writeBatch: vi.fn(),
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

const { useReceivables } = await import('./useReceivables.js');

const USER = { email: 'jarl@example.com' };

/** A live CXC as it sits in Firestore, with every field a partial call could lose. */
const storedReceivable = (overrides = {}) => ({
  id: 'cxc-1',
  currency: 'EUR',
  status: 'issued',
  grossAmount: 10000,
  amount: 10000,
  openAmount: 10000,
  pendingAmount: 10000,
  paidAmount: 0,
  issueDate: '2026-06-01',
  dueDate: '2026-07-01',
  description: 'Certificación junio',
  counterpartyName: 'Insyte Deutschland GmbH',
  client: 'Insyte Deutschland GmbH',
  documentNumber: 'RE-2026-001',
  invoiceNumber: 'RE-2026-001',
  projectId: 'proj-1',
  projectName: 'NE4 Rossdorf',
  costCenterId: 'CC1',
  categoryName: 'Certificaciones',
  ...overrides,
});

/** Exactly what CanonicalRecordModal + CXCIndependiente send today. */
const modalFormData = (overrides = {}) => ({
  direction: 'in',
  amount: 12000,
  postedDate: '',
  issueDate: '2026-06-01',
  dueDate: '2026-07-01',
  description: 'Certificación junio',
  counterpartyName: 'Insyte Deutschland GmbH',
  documentNumber: 'RE-2026-001',
  projectId: 'proj-1',
  projectName: 'NE4 Rossdorf',
  costCenterId: 'CC1',
  categoryName: 'Certificaciones',
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
  'client',
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

describe('updateReceivable — omitted fields are left alone', () => {
  it('does not clobber the text fields the caller did not send', async () => {
    const { updateReceivable } = useReceivables(USER);

    expect(await updateReceivable(storedReceivable(), { description: 'Solo descripción' }))
      .toEqual({ success: true });

    const payload = writtenPayload();
    expect(payload.description).toBe('Solo descripción');
    TEXT_KEYS.filter((key) => key !== 'description').forEach((key) => {
      expect(payload).not.toHaveProperty(key);
    });
  });

  it('never zeroes the invoice when the caller sends no amount', async () => {
    const { updateReceivable } = useReceivables(USER);

    await updateReceivable(storedReceivable(), { projectId: 'proj-2', projectName: 'NE4 Dieburg' });

    const payload = writtenPayload();
    MONEY_KEYS.forEach((key) => expect(payload).not.toHaveProperty(key));
  });

  it('leaves a cancelled invoice cancelled on a metadata-only edit', async () => {
    const { updateReceivable } = useReceivables(USER);
    const cancelled = storedReceivable({ status: 'cancelled', openAmount: 0, pendingAmount: 0 });

    await updateReceivable(cancelled, { categoryName: 'Otros' });

    expect(writtenPayload()).not.toHaveProperty('status');
  });

  it('leaves a partially collected invoice untouched on a metadata-only edit', async () => {
    const { updateReceivable } = useReceivables(USER);
    const partial = storedReceivable({
      status: 'partial',
      paidAmount: 4000,
      openAmount: 6000,
      pendingAmount: 6000,
    });

    await updateReceivable(partial, { costCenterId: 'CC2' });

    const payload = writtenPayload();
    expect(payload.costCenterId).toBe('CC2');
    MONEY_KEYS.forEach((key) => expect(payload).not.toHaveProperty(key));
  });

  it('keeps the stored dates instead of writing undefined over them', async () => {
    const { updateReceivable } = useReceivables(USER);

    await updateReceivable(storedReceivable(), { description: 'x' });

    const payload = writtenPayload();
    expect(payload).not.toHaveProperty('issueDate');
    expect(payload).not.toHaveProperty('dueDate');
  });
});

describe('updateReceivable — explicit clears still land', () => {
  it('writes an empty string when the caller deliberately clears a field', async () => {
    const { updateReceivable } = useReceivables(USER);

    await updateReceivable(storedReceivable(), { projectId: '', projectName: '', categoryName: '' });

    const payload = writtenPayload();
    expect(payload.projectId).toBe('');
    expect(payload.projectName).toBe('');
    expect(payload.categoryName).toBe('');
  });

  it('carries counterpartyName and documentNumber onto their legacy aliases', async () => {
    const { updateReceivable } = useReceivables(USER);

    await updateReceivable(storedReceivable(), {
      counterpartyName: 'Otro cliente',
      documentNumber: 'RE-2026-999',
    });

    const payload = writtenPayload();
    expect(payload.client).toBe('Otro cliente');
    expect(payload.invoiceNumber).toBe('RE-2026-999');
  });
});

describe('updateReceivable — the full form still behaves exactly as before', () => {
  it('restates the money block when the caller sends an amount', async () => {
    const { updateReceivable } = useReceivables(USER);

    await updateReceivable(storedReceivable(), modalFormData());

    expect(writtenPayload()).toMatchObject({
      grossAmount: 12000,
      amount: 12000,
      openAmount: 12000,
      pendingAmount: 12000,
      status: 'issued',
      description: 'Certificación junio',
      client: 'Insyte Deutschland GmbH',
      invoiceNumber: 'RE-2026-001',
      issueDate: '2026-06-01',
      dueDate: '2026-07-01',
    });
  });

  it('keeps a partially collected invoice partial and nets off what was collected', async () => {
    const { updateReceivable } = useReceivables(USER);
    const partial = storedReceivable({ status: 'partial', paidAmount: 4000, openAmount: 6000 });

    await updateReceivable(partial, modalFormData({ amount: 12000 }));

    expect(writtenPayload()).toMatchObject({
      grossAmount: 12000,
      openAmount: 8000,
      pendingAmount: 8000,
      status: 'partial',
    });
  });

  it('refuses an amount below what was already collected', async () => {
    const { updateReceivable } = useReceivables(USER);
    const partial = storedReceivable({ status: 'partial', paidAmount: 4000, openAmount: 6000 });

    const result = await updateReceivable(partial, modalFormData({ amount: 1000 }));

    expect(result.success).toBe(false);
    expect(result.error.message).toMatch(/por debajo de lo ya cobrado/);
    expect(firestoreMocks.updateDoc).not.toHaveBeenCalled();
  });

  it('settles the invoice when the amount drops to what was already collected', async () => {
    const { updateReceivable } = useReceivables(USER);
    const partial = storedReceivable({ status: 'partial', paidAmount: 4000, openAmount: 6000 });

    await updateReceivable(partial, modalFormData({ amount: 4000 }));

    expect(writtenPayload()).toMatchObject({ openAmount: 0, status: 'settled' });
  });
});

describe('updateReceivable — admin status override', () => {
  it('reopens the invoice and drops its payments on forceStatus "issued"', async () => {
    const { updateReceivable } = useReceivables(USER);
    const settled = storedReceivable({ status: 'settled', paidAmount: 10000, openAmount: 0 });

    await updateReceivable(settled, modalFormData({ amount: 10000, forceStatus: 'issued' }));

    expect(writtenPayload()).toMatchObject({
      status: 'issued',
      openAmount: 10000,
      paidAmount: 0,
      payments: [],
    });
  });

  it('closes the invoice on forceStatus "settled" without an amount in the payload', async () => {
    const { updateReceivable } = useReceivables(USER);

    await updateReceivable(storedReceivable(), { forceStatus: 'settled', correctionReason: 'DATEV' });

    expect(writtenPayload()).toMatchObject({
      status: 'settled',
      openAmount: 0,
      paidAmount: 10000,
      grossAmount: 10000,
    });
  });

  it('cancels without inventing a new gross amount', async () => {
    const { updateReceivable } = useReceivables(USER);

    await updateReceivable(storedReceivable(), { forceStatus: 'cancelled', correctionReason: 'Duplicada' });

    expect(writtenPayload()).toMatchObject({
      status: 'cancelled',
      openAmount: 0,
      grossAmount: 10000,
    });
  });
});
