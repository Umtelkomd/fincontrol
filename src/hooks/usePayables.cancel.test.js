/**
 * cancelPayable — the correction-reason plumbing this hook was missing.
 *
 * src/features/facturas/lib/amend.js's applyInvoiceDelete already calls
 * `effects.cancelObligation(family, id, reason)` (the DELETE user's own
 * typed motive), but with no way to carry it into cancelPayable the
 * obligation's own auditTrail always said the same hardcoded sentence no
 * matter why it was actually cancelled. These tests pin the optional
 * `{ reason, source }` extension AND the byte-identical no-args regression
 * the fix must never break (every OTHER caller — e.g. useNominas.js — calls
 * `cancelPayable(row)` with no second argument at all).
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

const storedPayable = (overrides = {}) => ({
  id: 'cxp-1',
  currency: 'EUR',
  status: 'issued',
  grossAmount: 1190,
  amount: 1190,
  openAmount: 1190,
  pendingAmount: 1190,
  paidAmount: 0,
  documentNumber: 'RE-2026-050',
  invoiceNumber: 'RE-2026-050',
  counterpartyName: 'Kabel Service GmbH',
  ...overrides,
});

const writtenPayload = () => {
  expect(firestoreMocks.updateDoc).toHaveBeenCalledTimes(1);
  return firestoreMocks.updateDoc.mock.calls[0][1];
};

const writtenAuditTrailDetail = () => writtenPayload().auditTrail[0].detail;

beforeEach(() => {
  vi.clearAllMocks();
  firestoreMocks.updateDoc.mockResolvedValue(undefined);
  auditMocks.writeAuditLogEntry.mockResolvedValue({ success: true });
});

describe('cancelPayable — no options (regression)', () => {
  it('writes the exact same hardcoded auditTrail detail as before when called with no second argument', async () => {
    const { cancelPayable } = usePayables(USER);

    const result = await cancelPayable(storedPayable());

    expect(result).toEqual({ success: true });
    expect(writtenAuditTrailDetail()).toBe('Factura CXP cancelada desde la mesa maestra');
  });

  it('produces the exact same detail with an explicit empty options object', async () => {
    const { cancelPayable } = usePayables(USER);

    await cancelPayable(storedPayable(), {});

    expect(writtenAuditTrailDetail()).toBe('Factura CXP cancelada desde la mesa maestra');
  });
});

describe('cancelPayable — optional reason', () => {
  it('uses the caller-supplied reason as the auditTrail detail instead of the hardcoded sentence', async () => {
    const { cancelPayable } = usePayables(USER);
    const reason = 'Anulada al eliminar la factura archivada Nº RE-2026-050. Motivo: Duplicada';

    await cancelPayable(storedPayable(), { reason, source: 'invoice-archive-delete' });

    expect(writtenAuditTrailDetail()).toBe(reason);
  });

  it('records the source as audit-log metadata for traceability', async () => {
    const { cancelPayable } = usePayables(USER);

    await cancelPayable(storedPayable(), { reason: 'Duplicada', source: 'invoice-archive-delete' });

    expect(auditMocks.writeAuditLogEntry).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ source: 'invoice-archive-delete' }) }),
    );
  });

  it('still refuses to cancel a payable with payments, exactly as before', async () => {
    const { cancelPayable } = usePayables(USER);

    const result = await cancelPayable(storedPayable({ paidAmount: 500 }), { reason: 'Duplicada' });

    expect(result.success).toBe(false);
    expect(firestoreMocks.updateDoc).not.toHaveBeenCalled();
  });
});
