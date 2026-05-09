import { beforeEach, describe, expect, it, vi } from 'vitest';

const firestoreMocks = vi.hoisted(() => ({
  addDoc: vi.fn(),
  arrayUnion: vi.fn((...items) => items),
  collection: vi.fn(() => ({ path: 'bankMovements' })),
  doc: vi.fn(() => ({ path: 'classificationRules/rule-1' })),
  increment: vi.fn((value) => ({ __increment: value })),
  serverTimestamp: vi.fn(() => 'SERVER_TIMESTAMP'),
  updateDoc: vi.fn(),
}));

const auditMocks = vi.hoisted(() => ({
  writeAuditLogEntry: vi.fn(),
}));

vi.mock('react', () => ({
  useCallback: (fn) => fn,
}));

vi.mock('firebase/firestore', () => firestoreMocks);

vi.mock('../services/firebase', () => ({
  db: { mocked: true },
  appId: 'test-app',
}));

vi.mock('../utils/auditLog', () => auditMocks);

vi.mock('../utils/logger', () => ({
  logError: vi.fn(),
}));

vi.mock('../finance/ruleEngine', () => ({
  findBestRule: vi.fn(() => null),
  buildClassificationPayload: vi.fn(() => ({})),
}));

const { useDatevImport } = await import('./useDatevImport.js');

describe('useDatevImport metadata persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    firestoreMocks.addDoc.mockResolvedValue({ id: 'movement-1' });
    firestoreMocks.updateDoc.mockResolvedValue(undefined);
    auditMocks.writeAuditLogEntry.mockResolvedValue(undefined);
  });

  it('persists DATEV identity, run, file, raw, and signed amount metadata while keeping amount/direction compatibility', async () => {
    const { importRows } = useDatevImport({ email: 'jarl@example.com' });
    const row = {
      direction: 'out',
      amount: 42.13,
      signedAmount: -42.13,
      postedDate: '2026-05-08',
      valueDate: '2026-05-09',
      description: 'Invoice payment',
      counterpartyName: 'Supplier GmbH',
      counterpartyIban: 'DE89370400440532013000',
      counterpartyBic: 'COBADEFFXXX',
      rowHash: 'datev-hash-1',
      rowFingerprint: 'sparkasse|identity|1',
      importRunId: 'datev-run-1',
      importFile: { name: 'may.csv', size: 1234, lastModified: 1778306400000 },
      importLineNumber: 7,
      raw: { line: 7, columns: { Buchungstag: '08.05.26', Betrag: '-42,13' } },
    };

    const result = await importRows([row], 'fallback.csv');

    expect(result).toMatchObject({ success: true, imported: 1 });
    expect(firestoreMocks.addDoc).toHaveBeenCalledTimes(1);
    expect(firestoreMocks.addDoc.mock.calls[0][1]).toMatchObject({
      amount: 42.13,
      signedAmount: -42.13,
      direction: 'out',
      importSource: 'datev',
      importRunId: 'datev-run-1',
      importFile: { name: 'may.csv', size: 1234, lastModified: 1778306400000 },
      importLineNumber: 7,
      rowHash: 'datev-hash-1',
      rowFingerprint: 'sparkasse|identity|1',
      counterpartyIban: 'DE89370400440532013000',
      counterpartyBic: 'COBADEFFXXX',
      rawDatev: { line: 7, columns: { Buchungstag: '08.05.26', Betrag: '-42,13' } },
    });
  });

  it('falls back to legacy filename and row line number when parser metadata is absent', async () => {
    const { importRows } = useDatevImport({ email: 'jarl@example.com' });

    await importRows([
      {
        direction: 'in',
        amount: 19.99,
        postedDate: '2026-05-08',
        description: 'Refund',
        counterpartyName: 'Customer',
        lineNumber: 4,
      },
    ], 'legacy.csv');

    expect(firestoreMocks.addDoc.mock.calls[0][1]).toMatchObject({
      amount: 19.99,
      signedAmount: 19.99,
      direction: 'in',
      importFile: { name: 'legacy.csv', size: 0, lastModified: null },
      importLineNumber: 4,
    });
  });
});
