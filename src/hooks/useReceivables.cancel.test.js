/**
 * cancelReceivable — twin of usePayables.cancel.test.js. Same optional
 * `{ reason, source }` extension, same byte-identical no-args regression.
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

const storedReceivable = (overrides = {}) => ({
  id: 'cxc-1',
  currency: 'EUR',
  status: 'issued',
  grossAmount: 5000,
  amount: 5000,
  openAmount: 5000,
  pendingAmount: 5000,
  paidAmount: 0,
  documentNumber: 'CXC-1',
  invoiceNumber: 'CXC-1',
  counterpartyName: 'Insyte Deutschland',
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

describe('cancelReceivable — no options (regression)', () => {
  it('writes the exact same hardcoded auditTrail detail as before when called with no second argument', async () => {
    const { cancelReceivable } = useReceivables(USER);

    const result = await cancelReceivable(storedReceivable());

    expect(result).toEqual({ success: true });
    expect(writtenAuditTrailDetail()).toBe('Factura CXC cancelada desde la mesa maestra');
  });
});

describe('cancelReceivable — optional reason', () => {
  it('uses the caller-supplied reason as the auditTrail detail instead of the hardcoded sentence', async () => {
    const { cancelReceivable } = useReceivables(USER);
    const reason = 'Anulada al eliminar la factura archivada Nº CXC-1. Motivo: Duplicada';

    await cancelReceivable(storedReceivable(), { reason, source: 'invoice-archive-delete' });

    expect(writtenAuditTrailDetail()).toBe(reason);
  });

  it('records the source as audit-log metadata for traceability', async () => {
    const { cancelReceivable } = useReceivables(USER);

    await cancelReceivable(storedReceivable(), { reason: 'Duplicada', source: 'invoice-archive-delete' });

    expect(auditMocks.writeAuditLogEntry).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ source: 'invoice-archive-delete' }) }),
    );
  });

  it('still refuses to cancel a receivable with payments, exactly as before', async () => {
    const { cancelReceivable } = useReceivables(USER);

    const result = await cancelReceivable(storedReceivable({ paidAmount: 500 }), { reason: 'Duplicada' });

    expect(result.success).toBe(false);
    expect(firestoreMocks.updateDoc).not.toHaveBeenCalled();
  });
});
