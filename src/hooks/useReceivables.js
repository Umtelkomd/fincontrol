import { logError } from '../utils/logger';
import { useEffect, useMemo, useState } from 'react';
import {
  addDoc,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { adaptReceivableDoc } from '../finance/adapters';
import {
  DEFAULT_CURRENCY,
  MAIN_ACCOUNT_ID,
} from '../finance/constants';
import {
  isBulkSettlePayment,
  isReconciliationPending,
  rawPaymentsOf,
  resolveBatchAllocations,
} from '../finance/batchReconciliation';
import { clampMoney, toISODate } from '../finance/utils';
import { LUMEN_SOURCE_SYSTEM, normalizeProjectCode } from '../finance/lumenContract';
import { db, appId } from '../services/firebase';
import { writeAuditLogEntry } from '../utils/auditLog';

/**
 * Firestore commits at most 500 operations in one WriteBatch. A remesa writes
 * one update per invoice plus one for the movement, so this is the hard ceiling
 * on invoices per batch. Unlike `bulkClassify`, which chunks and reports
 * partial success, reconcileBatch REFUSES above the cap: a remesa half applied
 * — invoices closed, movement unlinked — is worse than one not applied at all,
 * and no confirming settlement comes near this many documents anyway.
 */
const BATCH_RECONCILE_LIMIT = 399;

/** Only value that is unanimous across the batch travels onto the movement. */
const commonValue = (allocations, field) => {
  const values = new Set(allocations.map((entry) => entry.receivable?.[field] || ''));
  return values.size === 1 ? [...values][0] : '';
};

/**
 * The money state of one invoice before a batch reconciliation touched it —
 * the recovery record stored next to the document, mirroring the `before`
 * snapshot `bulkClassify` writes into each movement's audit trail.
 */
export const buildReconciliationSnapshot = (receivable) => ({
  openAmount: clampMoney(receivable?.openAmount ?? 0),
  paidAmount: clampMoney(receivable?.paidAmount ?? 0),
  status: receivable?.status ?? '',
  reconciliationPending: isReconciliationPending(receivable),
});

const buildReceivableSnapshot = (receivable, override = {}) => ({
  grossAmount: override.grossAmount ?? override.amount ?? clampMoney(receivable?.grossAmount ?? receivable?.amount ?? 0),
  openAmount: override.openAmount ?? clampMoney(receivable?.openAmount ?? 0),
  pendingAmount: override.pendingAmount ?? clampMoney(receivable?.pendingAmount ?? receivable?.openAmount ?? 0),
  paidAmount: override.paidAmount ?? clampMoney(receivable?.paidAmount ?? 0),
  status: override.status ?? receivable?.status ?? 'issued',
  issueDate: override.issueDate ?? receivable?.issueDate ?? null,
  dueDate: override.dueDate ?? receivable?.dueDate ?? null,
  description: override.description ?? receivable?.description ?? '',
  counterpartyName: override.counterpartyName ?? receivable?.counterpartyName ?? receivable?.client ?? '',
  documentNumber: override.documentNumber ?? receivable?.documentNumber ?? receivable?.invoiceNumber ?? '',
  projectId: override.projectId ?? receivable?.projectId ?? '',
  projectName: override.projectName ?? receivable?.projectName ?? '',
  costCenterId: override.costCenterId ?? receivable?.costCenterId ?? '',
  updatedBy: override.updatedBy ?? receivable?.updatedBy ?? receivable?.createdBy ?? '',
  updatedAt: override.updatedAt ?? receivable?.updatedAt ?? receivable?.createdAt ?? null,
});


export const useReceivables = (user) => {
  const [receivables, setReceivables] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const receivablesRef = useMemo(
    () => collection(db, 'artifacts', appId, 'public', 'data', 'receivables'),
    [],
  );

  useEffect(() => {
    if (!user) return undefined;

    const q = query(receivablesRef, orderBy('dueDate', 'asc'));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const data = snapshot.docs.map((entry) => adaptReceivableDoc({ id: entry.id, ...entry.data() }));
        setReceivables(data);
        setError(null);
        setLoading(false);
      },
      (snapshotError) => {
        logError('Error loading receivables:', snapshotError);
        setError(snapshotError);
        setLoading(false);
      },
    );

    return () => unsubscribe();
  }, [receivablesRef, user]);

  const createReceivable = async (data) => {
    if (!user) return { success: false };

    try {
      const amount = clampMoney(data.amount);
      const payload = {
        accountId: data.accountId || MAIN_ACCOUNT_ID,
        currency: data.currency || DEFAULT_CURRENCY,
        invoiceNumber: data.invoiceNumber || '',
        documentNumber: data.documentNumber || data.invoiceNumber || '',
        client: data.client,
        counterpartyName: data.client,
        projectId: data.projectId || '',
        projectName: data.projectName || data.project || '',
        projectCode: normalizeProjectCode(data.projectCode || data.projectName || ''),
        costCenterId: data.costCenterId || '',
        description: data.description || '',
        grossAmount: amount,
        amount,
        openAmount: amount,
        pendingAmount: amount,
        paidAmount: 0,
        issueDate: toISODate(data.issueDate) || toISODate(new Date()),
        dueDate: toISODate(data.dueDate) || toISODate(data.issueDate) || toISODate(new Date()),
        paymentTerms: data.paymentTerms || 'net30',
        status: 'issued',
        payments: [],
        notes: data.notes || '',
        productionWeekRef: data.productionWeekRef || '',
        source: typeof data.source === 'string' ? data.source : null,
        sourceKey: data.sourceKey || '',
        sourceSystem: data.sourceSystem || (data.sourceKey ? LUMEN_SOURCE_SYSTEM : ''),
        lumenWorkOrderId: data.lumenWorkOrderId || '',
        lumenOrderNumber: data.lumenOrderNumber || data.documentNumber || '',
        lumenCycleId: data.lumenCycleId || '',
        linkedTransactionId: data.linkedTransactionId || null,
        legacyTransactionId: data.legacyTransactionId || null,
        createdBy: user.email,
        createdAt: serverTimestamp(),
        updatedBy: user.email,
        updatedAt: serverTimestamp(),
        auditTrail: arrayUnion({
          action: 'create',
          user: user.email,
          timestamp: new Date().toISOString(),
          detail: 'Factura CXC creada',
        }),
      };
      const docRef = await addDoc(receivablesRef, payload);
      await writeAuditLogEntry({
        action: 'create',
        entityType: 'receivable',
        entityId: docRef.id,
        description: `Factura CXC creada: ${payload.documentNumber || payload.counterpartyName || docRef.id}`,
        userEmail: user.email,
        after: buildReceivableSnapshot(payload, {
          updatedAt: new Date().toISOString(),
        }),
      });
      return { success: true, id: docRef.id };
    } catch (error) {
      logError('Error creating receivable:', error);
      return { success: false, error };
    }
  };

  const registerPayment = async (receivable, paymentData) => {
    if (!user) return { success: false };

    // POLICY GUARD: every status change must reference a real bankMovement
    // (typically imported from DATEV). The Bandeja flow uses linkToReceivable
    // (in useClassifier) which is the canonical path. registerPayment is a
    // legacy entry point — only honor it when the caller provides
    // paymentData.bankMovementId.
    if (!paymentData?.bankMovementId) {
      return {
        success: false,
        error: new Error(
          'Política UMTELKOMD: todo cobro debe vincularse a un movimiento bancario (DATEV). ' +
          'Usá la página de CXC para conciliar con el extracto importado.',
        ),
      };
    }

    let nextOpenAmount;
    let nextPaidAmount;
    let nextStatus;
    const paymentAmount = clampMoney(paymentData.amount);
    const payment = {
      date: toISODate(paymentData.date) || toISODate(new Date()),
      amount: paymentAmount,
      method: paymentData.method,
      reference: paymentData.reference || '',
      note: paymentData.note || '',
      bankMovementId: paymentData.bankMovementId,
      registeredBy: user.email,
      timestamp: new Date().toISOString(),
    };

    try {
      const receivableRef = doc(db, 'artifacts', appId, 'public', 'data', 'receivables', receivable.id);

      // Atomic read-modify-write: read current amounts from Firestore inside the
      // transaction so concurrent payments do not race on stale client state.
      await runTransaction(db, async (txn) => {
        const snap = await txn.get(receivableRef);
        if (!snap.exists()) throw new Error('Receivable document not found');

        const data = snap.data();
        const currentPaid = clampMoney(data.paidAmount ?? 0);
        const currentOpen = clampMoney(data.openAmount ?? data.pendingAmount ?? (data.grossAmount ?? data.amount ?? 0) - currentPaid);
        if (paymentAmount > currentOpen + 0.01) {
          throw new Error(
            `El cobro (${paymentAmount.toFixed(2)}) excede el saldo abierto (${currentOpen.toFixed(2)}) de esta factura.`,
          );
        }
        nextOpenAmount = clampMoney(currentOpen - paymentAmount);
        nextPaidAmount = clampMoney(currentPaid + paymentAmount);
        nextStatus = nextOpenAmount <= 0 ? 'settled' : 'partial';

        txn.update(receivableRef, {
          openAmount: Math.max(0, nextOpenAmount),
          pendingAmount: Math.max(0, nextOpenAmount),
          paidAmount: nextPaidAmount,
          status: nextStatus,
          payments: arrayUnion(payment),
          updatedAt: serverTimestamp(),
          updatedBy: user.email,
          auditTrail: arrayUnion({
            action: 'payment',
            user: user.email,
            timestamp: new Date().toISOString(),
            detail: `Cobro registrado por ${paymentAmount.toFixed(2)} ${receivable.currency || DEFAULT_CURRENCY}`,
          }),
        });
      });

      await writeAuditLogEntry({
        action: 'payment',
        entityType: 'receivable',
        entityId: receivable.id,
        description: `Cobro registrado en CXC: ${receivable.documentNumber || receivable.counterpartyName || receivable.id}`,
        userEmail: user.email,
        before: buildReceivableSnapshot(receivable),
        after: buildReceivableSnapshot(receivable, {
          openAmount: Math.max(0, nextOpenAmount),
          pendingAmount: Math.max(0, nextOpenAmount),
          paidAmount: nextPaidAmount,
          status: nextStatus,
          updatedBy: user.email,
          updatedAt: new Date().toISOString(),
        }),
        metadata: {
          amount: payment.amount,
          method: payment.method,
          date: payment.date,
          reference: payment.reference || '',
        },
      });

      return { success: true };
    } catch (error) {
      logError('Error registering receivable payment:', error);
      return { success: false, error };
    }
  };

  const updateReceivable = async (receivable, data) => {
    if (!user) return { success: false };

    try {
      const grossAmount = clampMoney(data.amount);
      const currentPaid = clampMoney(receivable.paidAmount ?? 0);

      let nextStatus;
      let nextOpenAmount;
      let nextPaidAmount = currentPaid;
      const extraFields = {};

      if (data.forceStatus) {
        nextStatus = data.forceStatus;
        if (data.forceStatus === 'issued') {
          nextOpenAmount = grossAmount;
          nextPaidAmount = 0;
          extraFields.paidAmount = 0;
          extraFields.payments = [];
        } else if (data.forceStatus === 'settled') {
          nextOpenAmount = 0;
          nextPaidAmount = grossAmount;
          extraFields.paidAmount = grossAmount;
        } else if (data.forceStatus === 'cancelled') {
          nextOpenAmount = 0;
        } else {
          nextOpenAmount = clampMoney(grossAmount - currentPaid);
        }
      } else {
        if (grossAmount < currentPaid) {
          return { success: false, error: new Error('El importe no puede quedar por debajo de lo ya cobrado') };
        }
        nextOpenAmount = clampMoney(grossAmount - currentPaid);
        nextStatus = nextOpenAmount <= 0 ? 'settled' : currentPaid > 0 ? 'partial' : 'issued';
      }

      const receivableRef = doc(db, 'artifacts', appId, 'public', 'data', 'receivables', receivable.id);

      const payload = {
        grossAmount,
        amount: grossAmount,
        openAmount: clampMoney(nextOpenAmount),
        pendingAmount: clampMoney(nextOpenAmount),
        issueDate: toISODate(data.issueDate) || receivable.issueDate,
        dueDate: toISODate(data.dueDate) || receivable.dueDate,
        description: data.description || '',
        counterpartyName: data.counterpartyName || '',
        client: data.counterpartyName || '',
        documentNumber: data.documentNumber || '',
        invoiceNumber: data.documentNumber || '',
        projectId: data.projectId || '',
        projectName: data.projectName || '',
        costCenterId: data.costCenterId || '',
        ...(Object.prototype.hasOwnProperty.call(data, 'categoryName')
          ? { categoryName: data.categoryName ?? '' }
          : {}),
        status: nextStatus,
        ...extraFields,
        updatedAt: serverTimestamp(),
        updatedBy: user.email,
        auditTrail: arrayUnion({
          action: data.forceStatus ? 'status-override' : 'update',
          user: user.email,
          timestamp: new Date().toISOString(),
          detail: data.forceStatus
            ? `Estado corregido a "${data.forceStatus}" por admin. Motivo: ${data.correctionReason || 'sin motivo'}`
            : 'Factura CXC actualizada desde la mesa maestra',
        }),
      };
      await updateDoc(receivableRef, payload);
      await writeAuditLogEntry({
        action: data.forceStatus ? 'status-override' : 'update',
        entityType: 'receivable',
        entityId: receivable.id,
        description: data.forceStatus
          ? `Estado CXC corregido a "${data.forceStatus}": ${data.documentNumber || receivable.documentNumber || receivable.id}`
          : `Factura CXC actualizada: ${data.documentNumber || receivable.documentNumber || receivable.id}`,
        userEmail: user.email,
        before: buildReceivableSnapshot(receivable),
        after: buildReceivableSnapshot(receivable, {
          ...payload,
          paidAmount: nextPaidAmount,
          updatedBy: user.email,
          updatedAt: new Date().toISOString(),
        }),
        ...(data.forceStatus ? { metadata: { correctionReason: data.correctionReason, forceStatus: data.forceStatus } } : {}),
      });

      return { success: true };
    } catch (error) {
      logError('Error updating receivable:', error);
      return { success: false, error };
    }
  };

  const convertToPayable = async (receivable) => {
    if (!user) return { success: false };
    if ((receivable.paidAmount || 0) > 0) {
      return { success: false, error: new Error('No se puede convertir una CXC con cobros registrados') };
    }

    try {
      const amount = clampMoney(receivable.grossAmount ?? receivable.amount ?? 0);
      const payablesRef = collection(db, 'artifacts', appId, 'public', 'data', 'payables');

      const payload = {
        accountId: receivable.accountId || MAIN_ACCOUNT_ID,
        currency: receivable.currency || DEFAULT_CURRENCY,
        vendor: receivable.counterpartyName || receivable.client || '',
        counterpartyName: receivable.counterpartyName || receivable.client || '',
        documentNumber: receivable.documentNumber || receivable.invoiceNumber || '',
        invoiceNumber: receivable.documentNumber || receivable.invoiceNumber || '',
        projectId: receivable.projectId || '',
        projectName: receivable.projectName || '',
        costCenterId: receivable.costCenterId || '',
        description: receivable.description || '',
        grossAmount: amount,
        amount,
        openAmount: amount,
        pendingAmount: amount,
        paidAmount: 0,
        issueDate: receivable.issueDate || null,
        dueDate: receivable.dueDate || null,
        paymentTerms: receivable.paymentTerms || 'net30',
        status: 'issued',
        payments: [],
        notes: receivable.notes || '',
        _convertedFrom: { collection: 'receivables', id: receivable.id },
        createdBy: user.email,
        createdAt: serverTimestamp(),
        updatedBy: user.email,
        updatedAt: serverTimestamp(),
        auditTrail: arrayUnion({
          action: 'create',
          user: user.email,
          timestamp: new Date().toISOString(),
          detail: `Convertida desde CXC (ID: ${receivable.id}) por corrección de error`,
        }),
      };

      const newDocRef = await addDoc(payablesRef, payload);
      const receivableRef = doc(db, 'artifacts', appId, 'public', 'data', 'receivables', receivable.id);
      await deleteDoc(receivableRef);

      await writeAuditLogEntry({
        action: 'convert',
        entityType: 'receivable',
        entityId: receivable.id,
        description: `CXC convertida a CXP: ${receivable.documentNumber || receivable.counterpartyName || receivable.id}`,
        userEmail: user.email,
        before: buildReceivableSnapshot(receivable),
        after: { convertedTo: 'payable', newId: newDocRef.id },
        metadata: { source: 'cxc-to-cxp-conversion', newPayableId: newDocRef.id },
      });

      return { success: true, newId: newDocRef.id };
    } catch (error) {
      logError('Error converting receivable to payable:', error);
      return { success: false, error };
    }
  };

  const cancelReceivable = async (receivable) => {
    if (!user) return { success: false };
    if ((receivable.paidAmount || 0) > 0) {
      return { success: false, error: new Error('No se puede cancelar una CXC con cobros registrados') };
    }

    try {
      const receivableRef = doc(db, 'artifacts', appId, 'public', 'data', 'receivables', receivable.id);
      const payload = {
        status: 'cancelled',
        openAmount: 0,
        pendingAmount: 0,
        updatedAt: serverTimestamp(),
        updatedBy: user.email,
        auditTrail: arrayUnion({
          action: 'cancel',
          user: user.email,
          timestamp: new Date().toISOString(),
          detail: 'Factura CXC cancelada desde la mesa maestra',
        }),
      };
      await updateDoc(receivableRef, payload);
      await writeAuditLogEntry({
        action: 'cancel',
        entityType: 'receivable',
        entityId: receivable.id,
        description: `Factura CXC cancelada: ${receivable.documentNumber || receivable.counterpartyName || receivable.id}`,
        userEmail: user.email,
        before: buildReceivableSnapshot(receivable),
        after: buildReceivableSnapshot(receivable, {
          ...payload,
          updatedAt: new Date().toISOString(),
        }),
      });
      return { success: true };
    } catch (error) {
      logError('Error cancelling receivable:', error);
      return { success: false, error };
    }
  };

  // Deprecated: status-only shortcut — violates the "always link to bankMovement"
  // policy. Returns an explicit error so legacy callers fail loudly.
  const markAsPaid = async () => ({
    success: false,
    error: new Error(
      'Política UMTELKOMD: no se puede marcar una CXC como cobrada sin vincular un ' +
      'movimiento bancario. Usá /cxc → Conciliar.',
    ),
  });

  /**
   * S2/S4: create or update receivable by sourceKey (Lumen client_accepted).
   */
  const upsertReceivableBySourceKey = async (data) => {
    if (!user) return { success: false, error: new Error('No user') };
    const sourceKey = String(data.sourceKey || '').trim();
    if (!sourceKey) return { success: false, error: new Error('sourceKey requerido') };

    try {
      const q = query(receivablesRef, where('sourceKey', '==', sourceKey), limit(1));
      const snap = await getDocs(q);
      const amount = clampMoney(data.amount);

      if (!snap.empty) {
        const existing = adaptReceivableDoc({ id: snap.docs[0].id, ...snap.docs[0].data() });
        if (existing.status === 'settled' || existing.status === 'cancelled') {
          return { success: true, id: existing.id, action: 'skipped', reason: existing.status };
        }
        const paid = clampMoney(existing.paidAmount || 0);
        const nextGross = Math.max(amount, paid);
        const nextOpen = clampMoney(nextGross - paid);
        const ref = doc(db, 'artifacts', appId, 'public', 'data', 'receivables', existing.id);
        await updateDoc(ref, {
          grossAmount: nextGross,
          amount: nextGross,
          openAmount: nextOpen,
          pendingAmount: nextOpen,
          description: data.description || existing.description,
          counterpartyName: data.client || data.counterpartyName || existing.counterpartyName,
          client: data.client || data.counterpartyName || existing.client,
          projectId: data.projectId || existing.projectId || '',
          projectName: data.projectName || existing.projectName || '',
          projectCode: normalizeProjectCode(data.projectCode || existing.projectCode || ''),
          productionWeekRef: data.productionWeekRef || existing.productionWeekRef || '',
          lumenWorkOrderId: data.lumenWorkOrderId || existing.lumenWorkOrderId || '',
          lumenOrderNumber: data.lumenOrderNumber || existing.lumenOrderNumber || '',
          documentNumber: data.documentNumber || existing.documentNumber || '',
          dueDate: toISODate(data.dueDate) || existing.dueDate,
          sourceSystem: LUMEN_SOURCE_SYSTEM,
          updatedAt: serverTimestamp(),
          updatedBy: user.email,
          auditTrail: arrayUnion({
            action: 'upsert-sourceKey',
            user: user.email,
            timestamp: new Date().toISOString(),
            detail: `Upsert Lumen ${sourceKey}`,
          }),
        });
        return { success: true, id: existing.id, action: 'updated' };
      }

      const created = await createReceivable({
        ...data,
        amount,
        sourceKey,
        sourceSystem: LUMEN_SOURCE_SYSTEM,
        source: 'lumen',
      });
      return { ...created, action: created.success ? 'created' : 'error' };
    } catch (error) {
      logError('upsertReceivableBySourceKey:', error);
      return { success: false, error };
    }
  };

  /**
   * reconcileBatch — settle ONE incoming transfer against SEVERAL invoices.
   *
   *   reconcileBatch(movement, [{ receivableId, amount }])
   *     → { success, count, total, difference, status } | { success: false, error }
   *
   * Insyte pays through confirming, so a single arrival from CaixaBank, BBVA or
   * Santander covers a handful of invoices and matches none of them. This is
   * the write behind that screen.
   *
   * Takes the MOVEMENT, not just its id: every invariant worth enforcing —
   * "never allocate more than the bank sent", "only an incoming, live movement
   * settles a receivable" — needs its amount, direction and date, and this hook
   * does not subscribe to bankMovements. A bare id is refused rather than
   * silently reconciled against nothing.
   *
   * All rules live in `resolveBatchAllocations` (pure, unit-tested). What
   * happens here is Firestore-specific and comes down to three decisions:
   *
   *   ONE COMMIT. The movement and every invoice go into a single writeBatch.
   *     `bulkClassify` chunks because a partially classified selection is
   *     recoverable; a partially applied remesa is not, so this refuses to
   *     exceed what one batch holds instead of splitting.
   *   SUPERSEDE, NOT STACK. An invoice closed by the bulk settling script
   *     carries a `bulk-settle-*` payment line. Appending next to it would show
   *     the invoice paid twice, so that line is REPLACED — and the replacement
   *     array is rebuilt from `raw.payments`, because the adapter strips
   *     `bankMovementId` from every payment it reads. Invoices without such a
   *     line keep the append-only `arrayUnion` path, which cannot race.
   *   CASH IS NOT TOUCHED. The movement update carries links and provenance
   *     only. `amount`, `signedAmount`, `direction`, `postedDate`, `valueDate`
   *     and `status` are never written, so the cash position — derived from
   *     anchors plus signed movements — cannot move by reconciling.
   */
  const reconcileBatch = async (movement, allocations) => {
    if (!user) return { success: false, error: new Error('No user') };
    if (typeof movement === 'string') {
      return {
        success: false,
        error: new Error('reconcileBatch necesita el movimiento bancario completo, no solo su id'),
      };
    }

    const draft = Array.isArray(allocations) ? allocations : [];
    if (draft.length > BATCH_RECONCILE_LIMIT) {
      return {
        success: false,
        error: new Error(
          `Una remesa no puede cubrir más de ${BATCH_RECONCILE_LIMIT} facturas en una escritura atómica`,
        ),
      };
    }

    const plan = resolveBatchAllocations({ movement, allocations: draft, receivables });
    if (plan.error) return { success: false, error: new Error(plan.error) };

    try {
      const nowIso = new Date().toISOString();
      const ids = plan.allocations.map((entry) => entry.receivableId);
      const batch = writeBatch(db);

      // A remesa may be finished in two sittings, so an earlier pass's links
      // are extended, never overwritten. `resolveBatchAllocations` has already
      // capped this pass at what that earlier one left unexplained.
      const priorAllocations = Array.isArray(movement.receivableAllocations)
        ? movement.receivableAllocations
        : [];
      const priorIds = Array.isArray(movement.receivableIds) ? movement.receivableIds : [];
      const priorAmount = clampMoney(
        priorAllocations.reduce((sum, entry) => sum + (Number(entry?.amount) || 0), 0),
      );

      batch.update(doc(db, 'artifacts', appId, 'public', 'data', 'bankMovements', movement.id), {
        receivableId: movement.receivableId || ids[0],
        receivableIds: [...new Set([...priorIds, ...ids])],
        receivableAllocations: [
          ...priorAllocations,
          ...plan.allocations.map((entry) => ({
            documentId: entry.receivableId,
            amount: entry.amount,
            openAmountBefore: entry.openAmountBefore,
            openAmountAfter: entry.openAmountAfter,
          })),
        ],
        reconciledAt: serverTimestamp(),
        reconciliationId: movement.reconciliationId || `movement:${movement.id}`,
        reconciliationMode: 'batch-confirming',
        reconciledAmount: clampMoney(priorAmount + plan.total),
        categoryName: commonValue(plan.allocations, 'categoryName') || movement.categoryName || '',
        projectId: commonValue(plan.allocations, 'projectId') || movement.projectId || '',
        projectName:
          commonValue(plan.allocations, 'projectName') ||
          (plan.allocations.length > 1 ? 'Múltiples proyectos' : ''),
        costCenterId: commonValue(plan.allocations, 'costCenterId') || movement.costCenterId || '',
        updatedBy: user.email,
        updatedAt: serverTimestamp(),
        auditTrail: arrayUnion({
          action: 'batch-reconcile',
          user: user.email,
          timestamp: nowIso,
          detail: `Remesa conciliada con ${ids.length} CXC por ${plan.total.toFixed(2)} ${movement.currency || DEFAULT_CURRENCY}${
            plan.difference > 0 ? ` (quedan ${plan.difference.toFixed(2)} sin explicar)` : ''
          }`,
        }),
      });

      plan.allocations.forEach((entry) => {
        const payment = {
          date: movement.postedDate || toISODate(new Date()),
          amount: entry.amount,
          method: 'Confirming',
          reference: movement.description || '',
          note: 'Conciliado en remesa agrupada (confirming)',
          bankMovementId: movement.id,
          reconciliationMode: 'batch-confirming',
          registeredBy: user.email,
          timestamp: nowIso,
        };
        // Replacing the placeholder needs the whole array; everything else stays
        // append-only so two operators cannot clobber each other's payments.
        const payments = entry.supersededPayments.length
          ? [...rawPaymentsOf(entry.receivable).filter((line) => !isBulkSettlePayment(line)), payment]
          : arrayUnion(payment);

        batch.update(doc(db, 'artifacts', appId, 'public', 'data', 'receivables', entry.receivableId), {
          openAmount: entry.openAmountAfter,
          pendingAmount: entry.openAmountAfter,
          paidAmount: entry.paidAmountAfter,
          status: entry.nextStatus,
          reconciliationPending: false,
          payments,
          updatedBy: user.email,
          updatedAt: serverTimestamp(),
          auditTrail: arrayUnion({
            action: 'batch-reconcile',
            user: user.email,
            timestamp: nowIso,
            detail: `Conciliada en remesa con el movimiento ${movement.id} por ${entry.amount.toFixed(2)}${
              entry.supersededAmount > 0
                ? ` (reemplaza el cierre masivo de ${entry.supersededAmount.toFixed(2)})`
                : ''
            }`,
            before: buildReconciliationSnapshot(entry.receivable),
          }),
        });
      });

      await batch.commit();

      await Promise.all([
        writeAuditLogEntry({
          action: 'batch-reconcile',
          entityType: 'bankMovement',
          entityId: movement.id,
          description: `Remesa conciliada con ${ids.length} CXC: ${movement.description || movement.id}`,
          userEmail: user.email,
          metadata: {
            documentIds: ids,
            reconciliationMode: 'batch-confirming',
            amount: plan.total,
            movementAmount: plan.movementAmount,
            difference: plan.difference,
          },
        }),
        ...plan.allocations.map((entry) =>
          writeAuditLogEntry({
            action: 'batch-reconcile',
            entityType: 'receivable',
            entityId: entry.receivableId,
            description: `CXC conciliada en remesa: ${entry.receivable.documentNumber || entry.receivableId}`,
            userEmail: user.email,
            before: buildReceivableSnapshot(entry.receivable),
            after: buildReceivableSnapshot(entry.receivable, {
              openAmount: entry.openAmountAfter,
              pendingAmount: entry.openAmountAfter,
              paidAmount: entry.paidAmountAfter,
              status: entry.nextStatus,
              updatedBy: user.email,
              updatedAt: nowIso,
            }),
            metadata: {
              bankMovementId: movement.id,
              amount: entry.amount,
              supersededAmount: entry.supersededAmount,
              reconciliationMode: 'batch-confirming',
            },
          }),
        ),
      ]);

      return {
        success: true,
        count: plan.allocations.length,
        total: plan.total,
        difference: plan.difference,
        status: plan.status,
      };
    } catch (batchError) {
      logError('Error reconciling receivable batch:', batchError);
      return { success: false, error: batchError };
    }
  };

  return {
    receivables,
    loading,
    error,
    createReceivable,
    reconcileBatch,
    registerPayment,
    updateReceivable,
    cancelReceivable,
    convertToPayable,
    markAsPaid,
    upsertReceivableBySourceKey,
  };
};

export default useReceivables;
