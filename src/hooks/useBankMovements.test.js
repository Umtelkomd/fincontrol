import { beforeEach, describe, expect, it, vi } from 'vitest';

const batchMocks = vi.hoisted(() => ({ committed: [] }));

const firestoreMocks = vi.hoisted(() => ({
  addDoc: vi.fn(),
  arrayUnion: vi.fn((...items) => items),
  collection: vi.fn(() => ({ path: 'bankMovements' })),
  doc: vi.fn((_db, ...segments) => ({ path: segments.join('/'), id: segments[segments.length - 1] })),
  onSnapshot: vi.fn(() => () => {}),
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

const auditMocks = vi.hoisted(() => ({
  writeAuditLogEntry: vi.fn(),
}));

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

vi.mock('../utils/logger', () => ({
  logError: vi.fn(),
}));

const { useBankMovements } = await import('./useBankMovements.js');
const { COST_SCOPE } = await import('../finance/costScope.js');

const USER = { email: 'jarl@example.com' };

// Exactly what CanonicalRecordModal + Movimientos send today. Note there is no
// employeeIds, kind, status or valueDate field anywhere in that form.
const modalFormData = (overrides = {}) => ({
  direction: 'out',
  amount: 120.456,
  postedDate: '2026-05-08',
  issueDate: '',
  dueDate: '',
  description: 'Pago proveedor',
  counterpartyName: 'Supplier GmbH',
  documentNumber: 'RE-1',
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

describe('updateBankMovement — partial update semantics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    firestoreMocks.updateDoc.mockResolvedValue(undefined);
    auditMocks.writeAuditLogEntry.mockResolvedValue(undefined);
  });

  it('never writes employeeIds when the caller does not supply them', async () => {
    const { updateBankMovement } = useBankMovements(USER);

    expect(await updateBankMovement('mov-1', modalFormData())).toEqual({ success: true });
    expect(writtenPayload()).not.toHaveProperty('employeeIds');
  });

  it('writes employeeIds when the caller does supply them', async () => {
    const { updateBankMovement } = useBankMovements(USER);

    await updateBankMovement('mov-1', modalFormData({ employeeIds: ['emp-1', 'emp-2'] }));
    expect(writtenPayload().employeeIds).toEqual(['emp-1', 'emp-2']);
  });

  it('writes an empty employeeIds array when the caller explicitly clears it', async () => {
    const { updateBankMovement } = useBankMovements(USER);

    await updateBankMovement('mov-1', modalFormData({ employeeIds: [] }));
    expect(writtenPayload().employeeIds).toEqual([]);
  });

  it('does not clobber omitted fields with empty defaults', async () => {
    const { updateBankMovement } = useBankMovements(USER);

    await updateBankMovement('mov-1', { description: 'Solo descripción' });
    const payload = writtenPayload();

    expect(payload.description).toBe('Solo descripción');
    ['counterpartyName', 'documentNumber', 'projectId', 'projectName', 'costCenterId', 'categoryName']
      .forEach((field) => {
        expect(payload).not.toHaveProperty(field);
      });
  });

  it('does not reset the dates to today when the caller omits them', async () => {
    const { updateBankMovement } = useBankMovements(USER);

    await updateBankMovement('mov-1', { description: 'Solo descripción' });
    const payload = writtenPayload();

    expect(payload).not.toHaveProperty('postedDate');
    expect(payload).not.toHaveProperty('valueDate');
  });

  it('does not touch valueDate when only postedDate is edited', async () => {
    const { updateBankMovement } = useBankMovements(USER);

    await updateBankMovement('mov-1', modalFormData());
    const payload = writtenPayload();

    expect(payload.postedDate).toBe('2026-05-08');
    expect(payload).not.toHaveProperty('valueDate');
  });

  it('does not flip the direction to "in" when the caller omits it', async () => {
    const { updateBankMovement } = useBankMovements(USER);

    await updateBankMovement('mov-1', { description: 'Solo descripción' });
    expect(writtenPayload()).not.toHaveProperty('direction');
  });

  it('does not zero the amount when the caller omits it', async () => {
    const { updateBankMovement } = useBankMovements(USER);

    await updateBankMovement('mov-1', { description: 'Solo descripción' });
    expect(writtenPayload()).not.toHaveProperty('amount');
  });

  it('still writes every field the caller does send, normalized', async () => {
    const { updateBankMovement } = useBankMovements(USER);

    await updateBankMovement('mov-1', modalFormData());
    expect(writtenPayload()).toMatchObject({
      direction: 'out',
      amount: 120.46,
      postedDate: '2026-05-08',
      description: 'Pago proveedor',
      counterpartyName: 'Supplier GmbH',
      documentNumber: 'RE-1',
      projectId: 'proj-1',
      projectName: 'NE4 Rossdorf',
      costCenterId: 'CC1',
      categoryName: 'Material',
      updatedBy: USER.email,
    });
  });

  it('still clears a field the caller explicitly empties', async () => {
    const { updateBankMovement } = useBankMovements(USER);

    await updateBankMovement('mov-1', modalFormData({ categoryName: '', projectId: '', projectName: '' }));
    const payload = writtenPayload();

    expect(payload.categoryName).toBe('');
    expect(payload.projectId).toBe('');
    expect(payload.projectName).toBe('');
  });

  it('accepts `date` as an alias for postedDate', async () => {
    const { updateBankMovement } = useBankMovements(USER);

    await updateBankMovement('mov-1', { date: '2026-06-01' });
    expect(writtenPayload().postedDate).toBe('2026-06-01');
  });

  it('does not persist form-only control fields', async () => {
    const { updateBankMovement } = useBankMovements(USER);

    await updateBankMovement('mov-1', modalFormData());
    const payload = writtenPayload();

    ['forceStatus', 'correctionReason', 'issueDate', 'dueDate'].forEach((field) => {
      expect(payload).not.toHaveProperty(field);
    });
  });

  it('writes a valid costScope and collapses an invalid one to an empty scope', async () => {
    const { updateBankMovement } = useBankMovements(USER);

    await updateBankMovement('mov-1', { costScope: COST_SCOPE.OVERHEAD });
    expect(writtenPayload().costScope).toBe(COST_SCOPE.OVERHEAD);

    vi.clearAllMocks();
    await updateBankMovement('mov-1', { costScope: 'structural' });
    expect(writtenPayload().costScope).toBe('');
  });

  it('leaves costScope alone when the caller omits it', async () => {
    const { updateBankMovement } = useBankMovements(USER);

    await updateBankMovement('mov-1', { description: 'Solo descripción' });
    expect(writtenPayload()).not.toHaveProperty('costScope');
  });
});

// ─────────────────────────────────────────────────────────────
// bulkClassify — the multi-select write the classifier UI builds on
// ─────────────────────────────────────────────────────────────

/** Every doc path handed to batch.update, across all batches, in order. */
const batchedUpdates = () =>
  batchMocks.committed.flatMap((batch) => batch.update.mock.calls);

const soleBatchPayload = () => {
  expect(batchMocks.committed).toHaveLength(1);
  const calls = batchMocks.committed[0].update.mock.calls;
  expect(calls).toHaveLength(1);
  return calls[0][1];
};

describe('bulkClassify', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    batchMocks.committed.length = 0;
    auditMocks.writeAuditLogEntry.mockResolvedValue(undefined);
  });

  it('writes only the keys the caller supplied', async () => {
    const { bulkClassify } = useBankMovements(USER);

    const result = await bulkClassify(['mov-1'], { categoryName: 'Impuestos' });

    expect(result).toEqual({ success: true, updated: 1, failed: 0 });
    const payload = soleBatchPayload();
    expect(payload.categoryName).toBe('Impuestos');
    ['costCenterId', 'projectId', 'projectName', 'costScope'].forEach((field) => {
      expect(payload).not.toHaveProperty(field);
    });
  });

  it('writes the full classification when every key is supplied', async () => {
    const { bulkClassify } = useBankMovements(USER);

    await bulkClassify(['mov-1'], {
      categoryName: 'Material',
      costCenterId: 'CC1',
      projectId: 'proj-1',
      projectName: 'NE4 Rossdorf',
      costScope: COST_SCOPE.PROJECT,
    });

    expect(soleBatchPayload()).toMatchObject({
      categoryName: 'Material',
      costCenterId: 'CC1',
      projectId: 'proj-1',
      projectName: 'NE4 Rossdorf',
      costScope: COST_SCOPE.PROJECT,
      updatedBy: USER.email,
    });
  });

  it('assigns a structural cost with no project at all', async () => {
    const { bulkClassify } = useBankMovements(USER);

    const result = await bulkClassify(['mov-1', 'mov-2'], {
      categoryName: 'Impuestos',
      costScope: COST_SCOPE.OVERHEAD,
    });

    expect(result).toEqual({ success: true, updated: 2, failed: 0 });
    const payload = batchMocks.committed[0].update.mock.calls[0][1];
    expect(payload.costScope).toBe(COST_SCOPE.OVERHEAD);
    expect(payload).not.toHaveProperty('projectId');
  });

  it('rejects a costScope that is not a COST_SCOPE value, without writing anything', async () => {
    const { bulkClassify } = useBankMovements(USER);

    const result = await bulkClassify(['mov-1'], {
      categoryName: 'Impuestos',
      costScope: 'structural',
    });

    expect(result.success).toBe(false);
    expect(result.updated).toBe(0);
    expect(result.error).toBeInstanceOf(Error);
    expect(firestoreMocks.writeBatch).not.toHaveBeenCalled();
  });

  it('rejects an empty-string costScope rather than silently clearing the destination', async () => {
    const { bulkClassify } = useBankMovements(USER);

    const result = await bulkClassify(['mov-1'], { categoryName: 'Impuestos', costScope: '' });

    expect(result.success).toBe(false);
    expect(firestoreMocks.writeBatch).not.toHaveBeenCalled();
  });

  it('rejects a projectId without a projectName instead of writing half the pair', async () => {
    const { bulkClassify } = useBankMovements(USER);

    const result = await bulkClassify(['mov-1'], { projectId: 'proj-1' });

    expect(result.success).toBe(false);
    expect(result.error).toBeInstanceOf(Error);
    expect(firestoreMocks.writeBatch).not.toHaveBeenCalled();

    expect((await bulkClassify(['mov-1'], { projectId: 'proj-1', projectName: '  ' })).success)
      .toBe(false);
  });

  it('rejects a projectName without a projectId — the pair is written together', async () => {
    const { bulkClassify } = useBankMovements(USER);

    const result = await bulkClassify(['mov-1'], { projectName: 'NE4 Rossdorf' });

    expect(result.success).toBe(false);
    expect(firestoreMocks.writeBatch).not.toHaveBeenCalled();
  });

  it('clears projectId and projectName together when the project is emptied', async () => {
    const { bulkClassify } = useBankMovements(USER);

    const result = await bulkClassify(['mov-1'], { projectId: '' });

    expect(result.success).toBe(true);
    expect(soleBatchPayload()).toMatchObject({ projectId: '', projectName: '' });
  });

  it('refuses to attach a project to a structural cost', async () => {
    const { bulkClassify } = useBankMovements(USER);

    const result = await bulkClassify(['mov-1'], {
      costScope: COST_SCOPE.OVERHEAD,
      projectId: 'proj-1',
      projectName: 'NE4 Rossdorf',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBeInstanceOf(Error);
    expect(firestoreMocks.writeBatch).not.toHaveBeenCalled();
  });

  /**
   * The mirror of "a structural cost never carries a project". Without it the
   * exported hook writes `costScope: 'project'` with no projectId — the
   * half-classified shape the doc comment promises is impossible. Not
   * reachable from BulkClassifyBar (it validates first), but bulkClassify is
   * public API and its guarantees have to hold for every caller.
   */
  it('refuses to mark a cost as site work without a project', async () => {
    const { bulkClassify } = useBankMovements(USER);

    const result = await bulkClassify(['mov-1'], {
      categoryName: 'Material',
      costScope: COST_SCOPE.PROJECT,
    });

    expect(result.success).toBe(false);
    expect(result.updated).toBe(0);
    expect(result.error).toBeInstanceOf(Error);
    expect(firestoreMocks.writeBatch).not.toHaveBeenCalled();
  });

  it('refuses site work whose project is explicitly cleared in the same call', async () => {
    const { bulkClassify } = useBankMovements(USER);

    const result = await bulkClassify(['mov-1'], {
      costScope: COST_SCOPE.PROJECT,
      projectId: '',
      projectName: '',
    });

    expect(result.success).toBe(false);
    expect(firestoreMocks.writeBatch).not.toHaveBeenCalled();
  });

  it('still accepts site work that carries its project', async () => {
    const { bulkClassify } = useBankMovements(USER);

    const result = await bulkClassify(['mov-1'], {
      costScope: COST_SCOPE.PROJECT,
      projectId: 'proj-1',
      projectName: 'NE4 Rossdorf',
    });

    expect(result.success).toBe(true);
    expect(soleBatchPayload()).toMatchObject({
      costScope: COST_SCOPE.PROJECT,
      projectId: 'proj-1',
      projectName: 'NE4 Rossdorf',
    });
  });

  it('rejects a call that would classify nothing', async () => {
    const { bulkClassify } = useBankMovements(USER);

    const result = await bulkClassify(['mov-1'], {});

    expect(result).toMatchObject({ success: false, updated: 0, failed: 0 });
    expect(firestoreMocks.writeBatch).not.toHaveBeenCalled();
  });

  it('rejects an empty selection and a missing user', async () => {
    const { bulkClassify } = useBankMovements(USER);

    expect((await bulkClassify([], { categoryName: 'Impuestos' })).success).toBe(false);
    expect((await bulkClassify(undefined, { categoryName: 'Impuestos' })).success).toBe(false);

    const anonymous = useBankMovements(null);
    expect((await anonymous.bulkClassify(['mov-1'], { categoryName: 'Impuestos' })).success)
      .toBe(false);
    expect(firestoreMocks.writeBatch).not.toHaveBeenCalled();
  });

  it('chunks the write at 400 operations per batch', async () => {
    const { bulkClassify } = useBankMovements(USER);
    const ids = Array.from({ length: 900 }, (_, i) => `mov-${i}`);

    const result = await bulkClassify(ids, { categoryName: 'Impuestos' });

    expect(result).toEqual({ success: true, updated: 900, failed: 0 });
    expect(batchMocks.committed).toHaveLength(3);
    expect(batchMocks.committed.map((b) => b.update.mock.calls.length)).toEqual([400, 400, 100]);
    batchMocks.committed.forEach((batch) => expect(batch.commit).toHaveBeenCalledTimes(1));
    expect(batchedUpdates()).toHaveLength(900);
  });

  it('reports the movements a failed chunk left untouched', async () => {
    const { bulkClassify } = useBankMovements(USER);
    firestoreMocks.writeBatch
      .mockImplementationOnce(() => {
        const batch = {
          update: vi.fn(),
          commit: vi.fn().mockRejectedValue(new Error('quota exceeded')),
        };
        batchMocks.committed.push(batch);
        return batch;
      });

    const ids = Array.from({ length: 500 }, (_, i) => `mov-${i}`);
    const result = await bulkClassify(ids, { categoryName: 'Impuestos' });

    expect(result.success).toBe(false);
    expect(result.updated).toBe(100);
    expect(result.failed).toBe(400);
    expect(result.error).toBeInstanceOf(Error);
  });

  it('stamps every movement with an audit trail entry and writes one audit log record', async () => {
    const { bulkClassify } = useBankMovements(USER);

    await bulkClassify(['mov-1', 'mov-2'], {
      categoryName: 'Impuestos',
      costScope: COST_SCOPE.OVERHEAD,
    });

    const payload = batchMocks.committed[0].update.mock.calls[0][1];
    expect(payload.auditTrail[0]).toMatchObject({
      action: 'bulk-classify',
      user: USER.email,
    });

    expect(auditMocks.writeAuditLogEntry).toHaveBeenCalledTimes(1);
    expect(auditMocks.writeAuditLogEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'bulk-classify',
        entityType: 'bankMovement',
        userEmail: USER.email,
      }),
    );
  });

  it('does not write an audit log record when nothing was updated', async () => {
    const { bulkClassify } = useBankMovements(USER);
    firestoreMocks.writeBatch.mockImplementationOnce(() => {
      const batch = { update: vi.fn(), commit: vi.fn().mockRejectedValue(new Error('offline')) };
      batchMocks.committed.push(batch);
      return batch;
    });

    await bulkClassify(['mov-1'], { categoryName: 'Impuestos' });

    expect(auditMocks.writeAuditLogEntry).not.toHaveBeenCalled();
  });

  it('targets the bankMovements document of every selected id', async () => {
    const { bulkClassify } = useBankMovements(USER);

    await bulkClassify(['mov-1', 'mov-2'], { categoryName: 'Impuestos' });

    expect(batchedUpdates().map(([ref]) => ref.path)).toEqual([
      'artifacts/test-app/public/data/bankMovements/mov-1',
      'artifacts/test-app/public/data/bankMovements/mov-2',
    ]);
  });
});

describe('bulkUpdateCategory — kept working on top of bulkClassify', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    batchMocks.committed.length = 0;
    auditMocks.writeAuditLogEntry.mockResolvedValue(undefined);
  });

  it('still returns { success, count } for TransactionList', async () => {
    const { bulkUpdateCategory } = useBankMovements(USER);

    const result = await bulkUpdateCategory(['mov-1', 'mov-2'], 'Impuestos', 'CC1');

    expect(result).toEqual({ success: true, count: 2 });
    expect(batchMocks.committed[0].update.mock.calls[0][1]).toMatchObject({
      categoryName: 'Impuestos',
      costCenterId: 'CC1',
    });
  });

  it('never sets a project or a cost scope', async () => {
    const { bulkUpdateCategory } = useBankMovements(USER);

    await bulkUpdateCategory(['mov-1'], 'Impuestos');
    const payload = batchMocks.committed[0].update.mock.calls[0][1];

    ['projectId', 'projectName', 'costScope'].forEach((field) => {
      expect(payload).not.toHaveProperty(field);
    });
  });

  it('fails without ids, as before', async () => {
    const { bulkUpdateCategory } = useBankMovements(USER);

    expect((await bulkUpdateCategory([], 'Impuestos')).success).toBe(false);
    expect(firestoreMocks.writeBatch).not.toHaveBeenCalled();
  });
});
