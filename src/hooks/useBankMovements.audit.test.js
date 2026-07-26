import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * bulkClassify overwrites classification on hundreds of documents in one
 * click. `updateBankMovement` captures a before/after snapshot for a single
 * document; the bulk path has to capture the prior classification too, or a
 * wrong selection destroys reviewed history with no way back.
 *
 * These tests need the hook to actually HOLD movements, so unlike
 * useBankMovements.test.js the React mocks here are stateful and the effect
 * runs: `onSnapshot` delivers fixtures, the state cell keeps them, and a
 * second call to the hook reads them back — the equivalent of a re-render.
 */

const snapshotDocs = vi.hoisted(() => ({ current: [] }));
const batchMocks = vi.hoisted(() => ({ committed: [] }));
const hookState = vi.hoisted(() => ({ cells: [], cursor: 0 }));

vi.mock('react', () => ({
  useState: (initial) => {
    const index = hookState.cursor++;
    if (!(index in hookState.cells)) {
      hookState.cells[index] = typeof initial === 'function' ? initial() : initial;
    }
    return [
      hookState.cells[index],
      (next) => {
        hookState.cells[index] = typeof next === 'function' ? next(hookState.cells[index]) : next;
      },
    ];
  },
  useMemo: (factory) => factory(),
  useEffect: (effect) => {
    effect();
  },
}));

vi.mock('firebase/firestore', () => ({
  addDoc: vi.fn(),
  arrayUnion: vi.fn((...items) => items),
  collection: vi.fn(() => ({ path: 'bankMovements' })),
  doc: vi.fn((_db, ...segments) => ({ path: segments.join('/'), id: segments[segments.length - 1] })),
  onSnapshot: vi.fn((_query, onNext) => {
    onNext({ docs: snapshotDocs.current.map((entry) => ({ id: entry.id, data: () => entry })) });
    return () => {};
  }),
  orderBy: vi.fn(),
  query: vi.fn(),
  serverTimestamp: vi.fn(() => 'SERVER_TIMESTAMP'),
  updateDoc: vi.fn(),
  writeBatch: vi.fn(() => {
    const batch = {
      update: vi.fn(),
      set: vi.fn(),
      delete: vi.fn(),
      commit: vi.fn().mockResolvedValue(undefined),
    };
    batchMocks.committed.push(batch);
    return batch;
  }),
}));

vi.mock('../services/firebase', () => ({ db: { mocked: true }, appId: 'test-app' }));

const auditMocks = vi.hoisted(() => ({ writeAuditLogEntry: vi.fn() }));
vi.mock('../utils/auditLog', () => auditMocks);
vi.mock('../utils/logger', () => ({ logError: vi.fn() }));

const { buildClassificationSnapshot, useBankMovements } = await import('./useBankMovements.js');
const { COST_SCOPE } = await import('../finance/costScope.js');

const USER = { email: 'jarl@example.com' };

const CLASSIFIED = {
  id: 'mov-1',
  direction: 'out',
  amount: 100,
  postedDate: '2026-05-01',
  categoryName: 'Combustible',
  costCenterId: 'CC-9',
  projectId: 'p9',
  projectName: 'Obra Vieja',
};

const UNCLASSIFIED = {
  id: 'mov-2',
  direction: 'out',
  amount: 50,
  postedDate: '2026-05-02',
  projectName: '',
};

/** Mount, let the snapshot land, then mount again to read the delivered state. */
const useMountedBankMovements = () => {
  hookState.cursor = 0;
  useBankMovements(USER);
  hookState.cursor = 0;
  return useBankMovements(USER);
};

const auditEntryFor = (batchIndex, updateIndex) =>
  batchMocks.committed[batchIndex].update.mock.calls[updateIndex][1].auditTrail[0];

describe('bulkClassify — before-state capture', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    batchMocks.committed.length = 0;
    hookState.cells.length = 0;
    hookState.cursor = 0;
    snapshotDocs.current = [CLASSIFIED, UNCLASSIFIED];
    auditMocks.writeAuditLogEntry.mockResolvedValue(undefined);
  });

  it('records the classification each document had before the bulk write', async () => {
    const { bulkClassify } = useMountedBankMovements();

    await bulkClassify(['mov-1'], { categoryName: 'Impuestos' });

    expect(auditEntryFor(0, 0).before).toEqual({
      categoryName: 'Combustible',
      costScope: COST_SCOPE.PROJECT,
      projectId: 'p9',
      projectName: 'Obra Vieja',
      costCenterId: 'CC-9',
    });
  });

  it('gives every document its own snapshot, not the first one repeated', async () => {
    const { bulkClassify } = useMountedBankMovements();

    await bulkClassify(['mov-1', 'mov-2'], { categoryName: 'Impuestos' });

    expect(auditEntryFor(0, 0).before.categoryName).toBe('Combustible');
    expect(auditEntryFor(0, 1).before.categoryName).toBe('');
    expect(auditEntryFor(0, 1).before.projectId).toBe('');
  });

  it('writes an empty snapshot for an id the hook never loaded', async () => {
    const { bulkClassify } = useMountedBankMovements();

    await bulkClassify(['ghost'], { categoryName: 'Impuestos' });

    expect(auditEntryFor(0, 0).before).toEqual({
      categoryName: '',
      costScope: '',
      projectId: '',
      projectName: '',
      costCenterId: '',
    });
  });

  it('keeps the rest of the audit trail entry intact', async () => {
    const { bulkClassify } = useMountedBankMovements();

    await bulkClassify(['mov-1'], { categoryName: 'Impuestos' });

    expect(auditEntryFor(0, 0)).toMatchObject({
      action: 'bulk-classify',
      user: USER.email,
    });
    expect(auditEntryFor(0, 0).detail).toContain('Impuestos');
  });
});

describe('buildClassificationSnapshot', () => {
  it('captures exactly the fields a bulk write can change', () => {
    expect(buildClassificationSnapshot({
      categoryName: 'Material',
      costScope: COST_SCOPE.PROJECT,
      projectId: 'p1',
      projectName: 'NE4 Rossdorf',
      costCenterId: 'CC-1',
      amount: 999,
      description: 'irrelevante',
    })).toEqual({
      categoryName: 'Material',
      costScope: COST_SCOPE.PROJECT,
      projectId: 'p1',
      projectName: 'NE4 Rossdorf',
      costCenterId: 'CC-1',
    });
  });

  it('resolves the destination legacy documents only imply', () => {
    expect(buildClassificationSnapshot({ projectName: 'Overhead' }).costScope)
      .toBe(COST_SCOPE.OVERHEAD);
    expect(buildClassificationSnapshot({ projectId: 'p1' }).costScope)
      .toBe(COST_SCOPE.PROJECT);
  });

  it('returns empty strings for a missing movement', () => {
    expect(buildClassificationSnapshot(undefined)).toEqual({
      categoryName: '',
      costScope: '',
      projectId: '',
      projectName: '',
      costCenterId: '',
    });
  });
});
