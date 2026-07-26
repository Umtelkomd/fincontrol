import { logError } from '../utils/logger';
import { useEffect, useMemo, useState } from 'react';
import {
  addDoc,
  arrayUnion,
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { db, appId } from '../services/firebase';
import { adaptBankMovementDoc } from '../finance/adapters';
import {
  DEFAULT_CURRENCY,
  MAIN_ACCOUNT_ID,
  MOVEMENT_KIND,
  MOVEMENT_STATUS,
} from '../finance/constants';
import { COST_SCOPE, isCostScope, normalizeCostScope } from '../finance/costScope';
import { clampMoney, toISODate } from '../finance/utils';
import { writeAuditLogEntry } from '../utils/auditLog';

/**
 * Firestore caps a WriteBatch at 500 operations. 400 leaves headroom for the
 * arrayUnion payload each update carries and keeps a failing chunk small.
 */
const BULK_BATCH_LIMIT = 400;

const text = (value) => (typeof value === 'string' ? value.trim() : '');

const buildMovementSnapshot = (movement, override = {}) => ({
  direction: override.direction ?? movement?.direction ?? 'in',
  amount: override.amount ?? clampMoney(movement?.amount || 0),
  status: override.status ?? movement?.status ?? MOVEMENT_STATUS.POSTED,
  postedDate: override.postedDate ?? movement?.postedDate ?? movement?.valueDate ?? null,
  valueDate: override.valueDate ?? movement?.valueDate ?? movement?.postedDate ?? null,
  description: override.description ?? movement?.description ?? '',
  counterpartyName: override.counterpartyName ?? movement?.counterpartyName ?? '',
  documentNumber: override.documentNumber ?? movement?.documentNumber ?? '',
  projectId: override.projectId ?? movement?.projectId ?? '',
  projectName: override.projectName ?? movement?.projectName ?? '',
  costCenterId: override.costCenterId ?? movement?.costCenterId ?? '',
  updatedBy: override.updatedBy ?? movement?.updatedBy ?? movement?.createdBy ?? '',
  updatedAt: override.updatedAt ?? movement?.updatedAt ?? movement?.createdAt ?? null,
});

/**
 * buildClassificationSnapshot — the prior classification of one movement.
 *
 * `buildMovementSnapshot` covers the money fields the single-document editor
 * touches, but it carries neither `categoryName` nor `costScope` — exactly the
 * two fields a bulk write exists to change. This is the recovery record for
 * bulkClassify: the five fields the bulk path can overwrite, and nothing else,
 * so stamping it onto hundreds of documents stays cheap.
 *
 * The destination goes through `normalizeCostScope` so a legacy document whose
 * scope was only ever implied (projectName "Overhead", or the mere presence of
 * a projectId) is recorded as what the app actually resolved it to.
 */
export const buildClassificationSnapshot = (movement) => ({
  categoryName: movement?.categoryName ?? '',
  costScope: normalizeCostScope(movement),
  projectId: movement?.projectId ?? '',
  projectName: movement?.projectName ?? '',
  costCenterId: movement?.costCenterId ?? '',
});

/**
 * Builds a PARTIAL Firestore payload for updateBankMovement.
 *
 * Editors (CanonicalRecordModal from /movimientos and /transacciones) submit a
 * form that only covers part of a movement. Writing a default for every field
 * the form omits destroyed stored data on each save: `employeeIds` was reset to
 * `[]`, `valueDate` was dragged onto `postedDate`, and a caller sending a single
 * field wiped the text fields, zeroed the amount and flipped `direction` to
 * 'in'. So a key is written only when the caller actually supplied it —
 * `undefined` means "leave it alone", while an empty string or empty array is a
 * deliberate clear and is still written.
 *
 * createBankMovement keeps its defaults on purpose: a new document must be
 * complete.
 */
export const buildMovementUpdatePayload = (data = {}) => {
  const payload = {};
  const supplied = (key) => data?.[key] !== undefined;

  if (supplied('direction')) payload.direction = data.direction === 'out' ? 'out' : 'in';
  if (supplied('amount') && data.amount !== null && data.amount !== '') {
    payload.amount = clampMoney(data.amount);
  }

  const postedDate = toISODate(supplied('postedDate') ? data.postedDate : data.date);
  if (postedDate) payload.postedDate = postedDate;

  const valueDate = toISODate(data.valueDate);
  if (valueDate) payload.valueDate = valueDate;

  ['description', 'counterpartyName', 'documentNumber', 'projectId', 'projectName', 'costCenterId', 'categoryName']
    .forEach((key) => {
      if (supplied(key)) payload[key] = data[key] || '';
    });

  // Where the cost lands: 'project' (obra) or 'overhead' (estructura). An
  // unknown value collapses to '' — normalizeCostScope then falls back to the
  // legacy derivation instead of trusting a string nobody can interpret.
  if (supplied('costScope')) {
    payload.costScope = isCostScope(data.costScope) ? data.costScope : '';
  }

  // Array of employee doc ids attached to this movement (Phase 2A). Used for
  // free payments and bank adjustments not linked to a payable.
  if (supplied('employeeIds')) {
    payload.employeeIds = Array.isArray(data.employeeIds) ? data.employeeIds : [];
  }

  return payload;
};

const bulkFailure = (message) => ({
  success: false,
  updated: 0,
  failed: 0,
  error: new Error(message),
});

/**
 * resolveBulkClassification — validate a bulkClassify request and turn it into
 * the partial payload to write. Returns `{ payload }` or `{ error }`.
 *
 * Four invariants, enforced here so no half-classified document can be
 * written:
 *   1. `costScope`, when supplied, must be a COST_SCOPE value. '' is rejected
 *      too: clearing a destination in bulk is never what the operator meant.
 *   2. `projectId` and `projectName` are written as a PAIR. A non-empty id
 *      without a name (or the reverse) is a caller error — this hook has no
 *      project catalog to resolve the missing half from. An empty `projectId`
 *      clears both.
 *   3. A structural cost never carries a project.
 *   4. A site cost always does. `costScope: 'project'` must arrive with a
 *      non-empty `projectId` in the SAME call: this hook cannot read the
 *      documents it is about to write, so "the movements already have a
 *      project" is not something it can verify. Mirrors the rule
 *      `validateClassification` applies to the single-row form.
 */
const resolveBulkClassification = (classification) => {
  const input = classification || {};
  const data = {};

  if (input.categoryName !== undefined) data.categoryName = input.categoryName;
  if (input.costCenterId !== undefined) data.costCenterId = input.costCenterId;

  if (input.costScope !== undefined) {
    if (!isCostScope(input.costScope)) {
      return { error: `Destino de coste inválido: "${input.costScope}"` };
    }
    data.costScope = input.costScope;
  }

  if (input.projectId !== undefined || input.projectName !== undefined) {
    const projectId = text(input.projectId);
    const projectName = text(input.projectName);

    if (projectId && !projectName) {
      return { error: 'Falta el nombre del proyecto: projectId y projectName se guardan juntos' };
    }
    if (projectName && !projectId) {
      return { error: 'Falta el id del proyecto: projectId y projectName se guardan juntos' };
    }
    if (projectId && data.costScope === COST_SCOPE.OVERHEAD) {
      return { error: 'Un gasto de estructura no puede llevar proyecto' };
    }

    data.projectId = projectId;
    data.projectName = projectName;
  }

  if (data.costScope === COST_SCOPE.PROJECT && !text(data.projectId)) {
    return { error: 'Un gasto de obra debe llevar proyecto' };
  }

  const payload = buildMovementUpdatePayload(data);
  if (Object.keys(payload).length === 0) {
    return { error: 'No hay nada que clasificar' };
  }
  return { payload };
};

const SCOPE_LABELS = {
  [COST_SCOPE.PROJECT]: 'obra',
  [COST_SCOPE.OVERHEAD]: 'estructura',
};

/** Human-readable summary of a classification, for the audit trail. */
const describeClassification = (payload) => {
  const parts = [];
  if (payload.categoryName !== undefined) parts.push(`categoría: ${payload.categoryName || '—'}`);
  if (payload.costCenterId !== undefined) parts.push(`centro: ${payload.costCenterId || '—'}`);
  if (payload.projectId !== undefined) parts.push(`proyecto: ${payload.projectName || '—'}`);
  if (payload.costScope !== undefined) {
    parts.push(`destino: ${SCOPE_LABELS[payload.costScope] || '—'}`);
  }
  return parts.join(' · ');
};

const chunk = (items, size) => {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
};

export const useBankMovements = (user) => {
  const [bankMovements, setBankMovements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const movementsRef = useMemo(
    () => collection(db, 'artifacts', appId, 'public', 'data', 'bankMovements'),
    [],
  );

  useEffect(() => {
    if (!user) return undefined;

    const q = query(movementsRef, orderBy('postedDate', 'desc'));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const data = snapshot.docs.map((entry) => adaptBankMovementDoc({ id: entry.id, ...entry.data() }));
        setBankMovements(data);
        setLoading(false);
      },
      (snapshotError) => {
        logError('Error loading bank movements:', snapshotError);
        setError(snapshotError);
        setLoading(false);
      },
    );

    return () => unsubscribe();
  }, [movementsRef, user]);

  const createBankMovement = async (data) => {
    if (!user) return { success: false, error: 'No user' };

    try {
      const payload = {
        accountId: data.accountId || MAIN_ACCOUNT_ID,
        currency: data.currency || DEFAULT_CURRENCY,
        kind: data.kind || MOVEMENT_KIND.ADJUSTMENT,
        status: data.status || MOVEMENT_STATUS.POSTED,
        direction: data.direction === 'out' ? 'out' : 'in',
        amount: clampMoney(data.amount),
        postedDate: toISODate(data.postedDate || data.date) || toISODate(new Date()),
        valueDate:
          toISODate(data.valueDate || data.postedDate || data.date) || toISODate(new Date()),
        description: data.description || '',
        counterpartyName: data.counterpartyName || '',
        documentNumber: data.documentNumber || '',
        projectId: data.projectId || '',
        projectName: data.projectName || '',
        // NEW (Phase 2A): array of employee doc ids attached to this movement.
        // Used for free payments and bank adjustments not linked to a payable.
        employeeIds: Array.isArray(data.employeeIds) ? data.employeeIds : [],
        costCenterId: data.costCenterId || '',
        receivableId: data.receivableId || null,
        payableId: data.payableId || null,
        linkedTransactionId: data.linkedTransactionId || null,
        legacyTransactionId: data.legacyTransactionId || null,
        reconciliationId: data.reconciliationId || null,
        reconciledAt: data.reconciledAt || null,
        createdBy: user.email,
        createdAt: serverTimestamp(),
        updatedBy: user.email,
        updatedAt: serverTimestamp(),
        auditTrail: arrayUnion({
          action: 'create',
          user: user.email,
          timestamp: new Date().toISOString(),
          detail: 'Movimiento bancario creado',
        }),
      };
      const docRef = await addDoc(movementsRef, payload);
      await writeAuditLogEntry({
        action: 'create',
        entityType: 'bankMovement',
        entityId: docRef.id,
        description: `Movimiento bancario creado: ${payload.description || payload.documentNumber || docRef.id}`,
        userEmail: user.email,
        after: buildMovementSnapshot(payload, {
          updatedAt: new Date().toISOString(),
        }),
      });

      return { success: true };
    } catch (createError) {
      logError('Error creating bank movement:', createError);
      return { success: false, error: createError };
    }
  };

  const updateBankMovement = async (movementId, data) => {
    if (!user) return { success: false, error: 'No user' };

    try {
      const movementRef = doc(db, 'artifacts', appId, 'public', 'data', 'bankMovements', movementId);
      const payload = {
        ...buildMovementUpdatePayload(data),
        updatedBy: user.email,
        updatedAt: serverTimestamp(),
        auditTrail: arrayUnion({
          action: 'update',
          user: user.email,
          timestamp: new Date().toISOString(),
          detail: 'Movimiento bancario actualizado desde la mesa maestra',
        }),
      };
      await updateDoc(movementRef, payload);
      await writeAuditLogEntry({
        action: 'update',
        entityType: 'bankMovement',
        entityId: movementId,
        description: `Movimiento bancario actualizado: ${data.description || data.documentNumber || movementId}`,
        userEmail: user.email,
        before: buildMovementSnapshot(bankMovements.find((entry) => entry.id === movementId)),
        after: buildMovementSnapshot(bankMovements.find((entry) => entry.id === movementId), {
          ...payload,
          updatedBy: user.email,
          updatedAt: new Date().toISOString(),
        }),
      });
      return { success: true };
    } catch (updateError) {
      logError('Error updating bank movement:', updateError);
      return { success: false, error: updateError };
    }
  };

  const voidBankMovement = async (movementId, reason = '') => {
    if (!user) return { success: false, error: 'No user' };

    try {
      const movementRef = doc(db, 'artifacts', appId, 'public', 'data', 'bankMovements', movementId);
      const payload = {
        status: MOVEMENT_STATUS.VOID,
        voidReason: reason,
        updatedBy: user.email,
        updatedAt: serverTimestamp(),
        auditTrail: arrayUnion({
          action: 'void',
          user: user.email,
          timestamp: new Date().toISOString(),
          detail: reason || 'Movimiento bancario anulado desde la mesa maestra',
        }),
      };
      await updateDoc(movementRef, payload);
      const currentMovement = bankMovements.find((entry) => entry.id === movementId);
      await writeAuditLogEntry({
        action: 'void',
        entityType: 'bankMovement',
        entityId: movementId,
        description: `Movimiento bancario anulado: ${currentMovement?.description || currentMovement?.documentNumber || movementId}`,
        userEmail: user.email,
        before: buildMovementSnapshot(currentMovement),
        after: buildMovementSnapshot(currentMovement, {
          ...payload,
          updatedAt: new Date().toISOString(),
        }),
        metadata: {
          reason: reason || 'Sin motivo informado',
        },
      });
      return { success: true };
    } catch (updateError) {
      logError('Error voiding bank movement:', updateError);
      return { success: false, error: updateError };
    }
  };

  const reconcileMovement = async (movementId, transactionId) => {
    if (!user) return { success: false, error: 'No user' };

    try {
      const movementRef = doc(db, 'artifacts', appId, 'public', 'data', 'bankMovements', movementId);
      await updateDoc(movementRef, {
        linkedTransactionId: transactionId,
        reconciledAt: serverTimestamp(),
        updatedBy: user.email,
        updatedAt: serverTimestamp(),
        auditTrail: arrayUnion({
          action: 'reconcile',
          user: user.email,
          timestamp: new Date().toISOString(),
          detail: `Conciliado con transacción ${transactionId}`,
        }),
      });
      const currentMovement = bankMovements.find((entry) => entry.id === movementId);
      await writeAuditLogEntry({
        action: 'reconcile',
        entityType: 'bankMovement',
        entityId: movementId,
        description: `Movimiento bancario conciliado: ${currentMovement?.description || currentMovement?.documentNumber || movementId}`,
        userEmail: user.email,
        metadata: {
          linkedTransactionId: transactionId,
        },
      });
      return { success: true };
    } catch (reconcileError) {
      logError('Error reconciling movement:', reconcileError);
      return { success: false, error: reconcileError };
    }
  };

  const unreconcileMovement = async (movementId) => {
    if (!user) return { success: false, error: 'No user' };

    try {
      const movementRef = doc(db, 'artifacts', appId, 'public', 'data', 'bankMovements', movementId);
      await updateDoc(movementRef, {
        linkedTransactionId: null,
        reconciledAt: null,
        updatedBy: user.email,
        updatedAt: serverTimestamp(),
        auditTrail: arrayUnion({
          action: 'unreconcile',
          user: user.email,
          timestamp: new Date().toISOString(),
          detail: 'Conciliación deshecha',
        }),
      });
      const currentMovement = bankMovements.find((entry) => entry.id === movementId);
      await writeAuditLogEntry({
        action: 'unreconcile',
        entityType: 'bankMovement',
        entityId: movementId,
        description: `Conciliación deshecha: ${currentMovement?.description || currentMovement?.documentNumber || movementId}`,
        userEmail: user.email,
      });
      return { success: true };
    } catch (unreconcileError) {
      logError('Error unreconciling movement:', unreconcileError);
      return { success: false, error: unreconcileError };
    }
  };

  /**
   * bulkClassify — assign a classification to many movements at once.
   *
   *   bulkClassify(movementIds, { categoryName, costCenterId, projectId,
   *                               projectName, costScope })
   *     → { success, updated, failed, error? }
   *
   * Only the keys the caller actually supplied are written (`undefined` means
   * "leave it alone"), the same partial-update discipline updateBankMovement
   * uses — both go through buildMovementUpdatePayload.
   *
   * Writes are chunked into batches of BULK_BATCH_LIMIT. A chunk is atomic: if
   * its commit fails, its movements land in `failed` and the remaining chunks
   * still run, so one bad batch never sinks a 1500-movement selection.
   *
   * Every document keeps its own `before` snapshot in its `auditTrail`, so a
   * wrong bulk selection can be reconstructed movement by movement. The global
   * audit log stays a summary on purpose: N per-document snapshots do not
   * belong in one record, and the recovery data has to sit next to the document
   * it belongs to anyway.
   */
  const bulkClassify = async (movementIds, classification = {}) => {
    if (!user) return bulkFailure('No user');

    const ids = (Array.isArray(movementIds) ? movementIds : []).filter(Boolean);
    if (ids.length === 0) return bulkFailure('No hay movimientos seleccionados');

    const { payload, error: invalid } = resolveBulkClassification(classification);
    if (invalid) return bulkFailure(invalid);

    const detail = `Clasificación en lote — ${describeClassification(payload)}`;
    // Indexed once: a 1500-movement selection would otherwise scan the whole
    // ledger per document just to build its before-snapshot.
    const byId = new Map((bankMovements || []).map((entry) => [entry.id, entry]));
    let updated = 0;
    let failed = 0;
    let firstError = null;

    for (const batchIds of chunk(ids, BULK_BATCH_LIMIT)) {
      try {
        const batch = writeBatch(db);
        batchIds.forEach((id) => {
          batch.update(doc(db, 'artifacts', appId, 'public', 'data', 'bankMovements', id), {
            ...payload,
            updatedBy: user.email,
            updatedAt: serverTimestamp(),
            auditTrail: arrayUnion({
              action: 'bulk-classify',
              user: user.email,
              timestamp: new Date().toISOString(),
              detail,
              before: buildClassificationSnapshot(byId.get(id)),
            }),
          });
        });
        await batch.commit();
        updated += batchIds.length;
      } catch (batchError) {
        logError('Error bulk classifying movements:', batchError);
        failed += batchIds.length;
        if (!firstError) firstError = batchError;
      }
    }

    if (updated > 0) {
      await writeAuditLogEntry({
        action: 'bulk-classify',
        entityType: 'bankMovement',
        entityId: ids.join(','),
        description: `${updated} movimiento(s) clasificados — ${describeClassification(payload)}`,
        userEmail: user.email,
        metadata: { ...payload, requested: ids.length, updated, failed },
      });
    }

    return {
      success: failed === 0,
      updated,
      failed,
      ...(firstError ? { error: firstError } : {}),
    };
  };

  /**
   * bulkUpdateCategory — legacy signature kept for TransactionList. Delegates to
   * bulkClassify so there is a single bulk write path.
   */
  const bulkUpdateCategory = async (movementIds, categoryName, costCenterId = '') => {
    const result = await bulkClassify(movementIds, { categoryName, costCenterId });
    return result.success
      ? { success: true, count: result.updated }
      : { success: false, error: result.error };
  };

  return {
    bankMovements,
    loading,
    error,
    createBankMovement,
    updateBankMovement,
    bulkClassify,
    bulkUpdateCategory,
    voidBankMovement,
    reconcileMovement,
    unreconcileMovement,
  };
};

export default useBankMovements;
