import { logError } from '../utils/logger';
import { useEffect, useMemo, useState } from 'react';
import {
  addDoc,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import { adaptPayableDoc } from '../finance/adapters';
import {
  DEFAULT_CURRENCY,
  MAIN_ACCOUNT_ID,
} from '../finance/constants';
import { clampMoney, toISODate } from '../finance/utils';
import { assertPayablePaymentAllowed } from '../finance/opsControl';
import { db, appId } from '../services/firebase';
import { writeAuditLogEntry } from '../utils/auditLog';

const buildPayableSnapshot = (payable, override = {}) => ({
  grossAmount: override.grossAmount ?? override.amount ?? clampMoney(payable?.grossAmount ?? payable?.amount ?? 0),
  openAmount: override.openAmount ?? clampMoney(payable?.openAmount ?? 0),
  pendingAmount: override.pendingAmount ?? clampMoney(payable?.pendingAmount ?? payable?.openAmount ?? 0),
  paidAmount: override.paidAmount ?? clampMoney(payable?.paidAmount ?? 0),
  status: override.status ?? payable?.status ?? 'issued',
  issueDate: override.issueDate ?? payable?.issueDate ?? null,
  dueDate: override.dueDate ?? payable?.dueDate ?? null,
  description: override.description ?? payable?.description ?? '',
  counterpartyName: override.counterpartyName ?? payable?.counterpartyName ?? payable?.vendor ?? '',
  documentNumber: override.documentNumber ?? payable?.documentNumber ?? payable?.invoiceNumber ?? '',
  projectId: override.projectId ?? payable?.projectId ?? '',
  projectName: override.projectName ?? payable?.projectName ?? '',
  costCenterId: override.costCenterId ?? payable?.costCenterId ?? '',
  updatedBy: override.updatedBy ?? payable?.updatedBy ?? payable?.createdBy ?? '',
  updatedAt: override.updatedAt ?? payable?.updatedAt ?? payable?.createdAt ?? null,
});


export const usePayables = (user) => {
  const [payables, setPayables] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const payablesRef = useMemo(
    () => collection(db, 'artifacts', appId, 'public', 'data', 'payables'),
    [],
  );

  useEffect(() => {
    if (!user) return undefined;

    const q = query(payablesRef, orderBy('dueDate', 'asc'));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const data = snapshot.docs.map((entry) => adaptPayableDoc({ id: entry.id, ...entry.data() }));
        setPayables(data);
        setError(null);
        setLoading(false);
      },
      (snapshotError) => {
        logError('Error loading payables:', snapshotError);
        setError(snapshotError);
        setLoading(false);
      },
    );

    return () => unsubscribe();
  }, [payablesRef, user]);

  const createPayable = async (data) => {
    if (!user) return { success: false };

    try {
      const amount = clampMoney(data.amount);
      const payload = {
        accountId: data.accountId || MAIN_ACCOUNT_ID,
        currency: data.currency || DEFAULT_CURRENCY,
        invoiceNumber: data.invoiceNumber || '',
        documentNumber: data.documentNumber || data.invoiceNumber || '',
        vendor: data.vendor,
        counterpartyName: data.vendor,
        projectId: data.projectId || '',
        projectName: data.projectName || data.project || '',
        // NEW (Phase 2A): array of employee doc ids attached to this payable.
        // Persists which technicians the invoice is FOR (e.g., "this CXP from
        // subcontractor X covers Jorge + Andres for week Y"). Defaults to [].
        employeeIds: Array.isArray(data.employeeIds) ? data.employeeIds : [],
        costCenterId: data.costCenterId || '',
        categoryName: data.categoryName || '',
        // Payroll markers (Nóminas): link a payable back to its payroll period.
        // Null for ordinary CXP. Persisted so the Nóminas view can match each
        // obligation to its live payable by payrollPeriodId.
        payrollPeriod: data.payrollPeriod || null,
        payrollPeriodId: data.payrollPeriodId || null,
        payrollKind: data.payrollKind || null,
        // F1: production gate. Payroll never requires ops clear.
        // New operational CXP defaults to gated until Bauleiter validates week.
        opsGateRequired:
          data.opsGateRequired != null
            ? Boolean(data.opsGateRequired)
            : !(data.payrollPeriodId || data.payrollKind),
        opsCleared: Boolean(data.opsCleared),
        opsClearedAt: data.opsCleared ? new Date().toISOString() : null,
        opsClearedBy: data.opsCleared ? user.email : '',
        productionWeekRef: data.productionWeekRef || '',
        // `source` is an origin TAG and must stay a string — external ingestions
        // have passed provenance objects here, which render as "[object Object]"
        // in every origin breakdown. Objects are rerouted to sourceDocument.
        source: typeof data.source === 'string' ? data.source : data.source ? 'external-import' : null,
        // Document fingerprint: which PDF/attachment this payable came from.
        sourceDocument:
          data.sourceDocument
          || (data.source && typeof data.source === 'object' ? data.source : null),
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
          detail: 'Factura CXP creada',
        }),
      };
      const docRef = await addDoc(payablesRef, payload);
      await writeAuditLogEntry({
        action: 'create',
        entityType: 'payable',
        entityId: docRef.id,
        description: `Factura CXP creada: ${payload.documentNumber || payload.counterpartyName || docRef.id}`,
        userEmail: user.email,
        after: buildPayableSnapshot(payload, {
          updatedAt: new Date().toISOString(),
        }),
      });
      return { success: true, id: docRef.id };
    } catch (error) {
      logError('Error creating payable:', error);
      return { success: false, error };
    }
  };

  const registerPayment = async (payable, paymentData) => {
    if (!user) return { success: false };

    // F1: production gate before any payment path.
    const gate = assertPayablePaymentAllowed(payable, {
      adminOverride: Boolean(paymentData?.adminOpsOverride),
      overrideReason: paymentData?.opsOverrideReason || '',
    });
    if (!gate.allowed) {
      return { success: false, error: gate.error };
    }

    // POLICY GUARD: every status change must reference a real bankMovement
    // (typically imported from DATEV). The Bandeja flow uses linkToPayable
    // (in useClassifier) which is the canonical path. registerPayment is a
    // legacy entry point — only honor it when the caller provides
    // paymentData.bankMovementId.
    if (!paymentData?.bankMovementId) {
      return {
        success: false,
        error: new Error(
          'Política UMTELKOMD: todo pago debe vincularse a un movimiento bancario (DATEV). ' +
          'Usá la página de CXP para conciliar con el extracto importado.',
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
      const payableRef = doc(db, 'artifacts', appId, 'public', 'data', 'payables', payable.id);

      // Atomic read-modify-write: read current amounts from Firestore inside the
      // transaction so concurrent payments do not race on stale client state.
      await runTransaction(db, async (txn) => {
        const snap = await txn.get(payableRef);
        if (!snap.exists()) throw new Error('Payable document not found');

        const data = snap.data();
        const currentPaid = clampMoney(data.paidAmount ?? 0);
        const currentOpen = clampMoney(data.openAmount ?? data.pendingAmount ?? (data.grossAmount ?? data.amount ?? 0) - currentPaid);
        if (paymentAmount > currentOpen + 0.01) {
          throw new Error(
            `El pago (${paymentAmount.toFixed(2)}) excede el saldo abierto (${currentOpen.toFixed(2)}) de esta factura.`,
          );
        }
        nextOpenAmount = clampMoney(currentOpen - paymentAmount);
        nextPaidAmount = clampMoney(currentPaid + paymentAmount);
        nextStatus = nextOpenAmount <= 0 ? 'settled' : 'partial';

        txn.update(payableRef, {
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
            detail: `Pago registrado por ${paymentAmount.toFixed(2)} ${payable.currency || DEFAULT_CURRENCY}`,
          }),
        });
      });

      await writeAuditLogEntry({
        action: 'payment',
        entityType: 'payable',
        entityId: payable.id,
        description: `Pago registrado en CXP: ${payable.documentNumber || payable.counterpartyName || payable.id}`,
        userEmail: user.email,
        before: buildPayableSnapshot(payable),
        after: buildPayableSnapshot(payable, {
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
      logError('Error registering payable payment:', error);
      return { success: false, error };
    }
  };

  const updatePayable = async (payable, data) => {
    if (!user) return { success: false };

    try {
      const grossAmount = clampMoney(data.amount);
      const currentPaid = clampMoney(payable.paidAmount ?? 0);

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
          return { success: false, error: new Error('El importe no puede quedar por debajo de lo ya pagado') };
        }
        nextOpenAmount = clampMoney(grossAmount - currentPaid);
        nextStatus = nextOpenAmount <= 0 ? 'settled' : currentPaid > 0 ? 'partial' : 'issued';
      }

      const payableRef = doc(db, 'artifacts', appId, 'public', 'data', 'payables', payable.id);

      const payload = {
        grossAmount,
        amount: grossAmount,
        openAmount: clampMoney(nextOpenAmount),
        pendingAmount: clampMoney(nextOpenAmount),
        issueDate: toISODate(data.issueDate) || payable.issueDate,
        dueDate: toISODate(data.dueDate) || payable.dueDate,
        description: data.description || '',
        counterpartyName: data.counterpartyName || '',
        vendor: data.counterpartyName || '',
        documentNumber: data.documentNumber || '',
        invoiceNumber: data.documentNumber || '',
        projectId: data.projectId || '',
        projectName: data.projectName || '',
        costCenterId: data.costCenterId || '',
        categoryName: data.categoryName || '',
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
            : 'Factura CXP actualizada desde la mesa maestra',
        }),
      };
      await updateDoc(payableRef, payload);
      await writeAuditLogEntry({
        action: data.forceStatus ? 'status-override' : 'update',
        entityType: 'payable',
        entityId: payable.id,
        description: data.forceStatus
          ? `Estado CXP corregido a "${data.forceStatus}": ${data.documentNumber || payable.documentNumber || payable.id}`
          : `Factura CXP actualizada: ${data.documentNumber || payable.documentNumber || payable.id}`,
        userEmail: user.email,
        before: buildPayableSnapshot(payable),
        after: buildPayableSnapshot(payable, {
          ...payload,
          paidAmount: nextPaidAmount,
          updatedBy: user.email,
          updatedAt: new Date().toISOString(),
        }),
        ...(data.forceStatus ? { metadata: { correctionReason: data.correctionReason, forceStatus: data.forceStatus } } : {}),
      });

      return { success: true };
    } catch (error) {
      logError('Error updating payable:', error);
      return { success: false, error };
    }
  };

  const convertToReceivable = async (payable) => {
    if (!user) return { success: false };
    if ((payable.paidAmount || 0) > 0) {
      return { success: false, error: new Error('No se puede convertir una CXP con pagos registrados') };
    }

    try {
      const amount = clampMoney(payable.grossAmount ?? payable.amount ?? 0);
      const receivablesRef = collection(db, 'artifacts', appId, 'public', 'data', 'receivables');

      const payload = {
        accountId: payable.accountId || MAIN_ACCOUNT_ID,
        currency: payable.currency || DEFAULT_CURRENCY,
        client: payable.counterpartyName || payable.vendor || '',
        counterpartyName: payable.counterpartyName || payable.vendor || '',
        documentNumber: payable.documentNumber || payable.invoiceNumber || '',
        invoiceNumber: payable.documentNumber || payable.invoiceNumber || '',
        projectId: payable.projectId || '',
        projectName: payable.projectName || '',
        costCenterId: payable.costCenterId || '',
        description: payable.description || '',
        grossAmount: amount,
        amount,
        openAmount: amount,
        pendingAmount: amount,
        paidAmount: 0,
        issueDate: payable.issueDate || null,
        dueDate: payable.dueDate || null,
        paymentTerms: payable.paymentTerms || 'net30',
        status: 'issued',
        payments: [],
        notes: payable.notes || '',
        _convertedFrom: { collection: 'payables', id: payable.id },
        createdBy: user.email,
        createdAt: serverTimestamp(),
        updatedBy: user.email,
        updatedAt: serverTimestamp(),
        auditTrail: arrayUnion({
          action: 'create',
          user: user.email,
          timestamp: new Date().toISOString(),
          detail: `Convertida desde CXP (ID: ${payable.id}) por corrección de error`,
        }),
      };

      const newDocRef = await addDoc(receivablesRef, payload);
      const payableRef = doc(db, 'artifacts', appId, 'public', 'data', 'payables', payable.id);
      await deleteDoc(payableRef);

      await writeAuditLogEntry({
        action: 'convert',
        entityType: 'payable',
        entityId: payable.id,
        description: `CXP convertida a CXC: ${payable.documentNumber || payable.counterpartyName || payable.id}`,
        userEmail: user.email,
        before: buildPayableSnapshot(payable),
        after: { convertedTo: 'receivable', newId: newDocRef.id },
        metadata: { source: 'cxp-to-cxc-conversion', newReceivableId: newDocRef.id },
      });

      return { success: true, newId: newDocRef.id };
    } catch (error) {
      logError('Error converting payable to receivable:', error);
      return { success: false, error };
    }
  };

  const cancelPayable = async (payable) => {
    if (!user) return { success: false };
    if ((payable.paidAmount || 0) > 0) {
      return { success: false, error: new Error('No se puede cancelar una CXP con pagos registrados') };
    }

    try {
      const payableRef = doc(db, 'artifacts', appId, 'public', 'data', 'payables', payable.id);
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
          detail: 'Factura CXP cancelada desde la mesa maestra',
        }),
      };
      await updateDoc(payableRef, payload);
      await writeAuditLogEntry({
        action: 'cancel',
        entityType: 'payable',
        entityId: payable.id,
        description: `Factura CXP cancelada: ${payable.documentNumber || payable.counterpartyName || payable.id}`,
        userEmail: user.email,
        before: buildPayableSnapshot(payable),
        after: buildPayableSnapshot(payable, {
          ...payload,
          updatedAt: new Date().toISOString(),
        }),
      });
      return { success: true };
    } catch (error) {
      logError('Error cancelling payable:', error);
      return { success: false, error };
    }
  };

  // Deprecated: status-only shortcut — violates the "always link to bankMovement"
  // policy. Returns an explicit error so legacy callers fail loudly.
  const markAsPaid = async () => ({
    success: false,
    error: new Error(
      'Política UMTELKOMD: no se puede marcar una CXP como pagada sin vincular un ' +
      'movimiento bancario. Usá /cxp → Conciliar.',
    ),
  });

  /**
   * F1: Bauleiter / admin validates production for a CXP week.
   * cleared=true unlocks DATEV reconcile / payment.
   */
  const setOpsCleared = async (payable, { cleared = true, productionWeekRef = '', note = '' } = {}) => {
    if (!user) return { success: false, error: new Error('No user') };
    if (!payable?.id) return { success: false, error: new Error('CXP inválida') };

    try {
      const payableRef = doc(db, 'artifacts', appId, 'public', 'data', 'payables', payable.id);
      const nowIso = new Date().toISOString();
      const week = (productionWeekRef || payable.productionWeekRef || '').trim();
      const payload = {
        opsCleared: Boolean(cleared),
        opsClearedAt: cleared ? nowIso : null,
        opsClearedBy: cleared ? user.email : '',
        productionWeekRef: week,
        // Once touched, keep gate on (unless payroll)
        opsGateRequired: payable.payrollPeriodId || payable.payrollKind ? false : true,
        updatedAt: serverTimestamp(),
        updatedBy: user.email,
        auditTrail: arrayUnion({
          action: cleared ? 'ops-clear' : 'ops-unclear',
          user: user.email,
          timestamp: nowIso,
          detail: cleared
            ? `Producción validada${week ? ` (${week})` : ''}${note ? `: ${note}` : ''}`
            : `Validación de producción retirada${note ? `: ${note}` : ''}`,
        }),
      };
      await updateDoc(payableRef, payload);
      await writeAuditLogEntry({
        action: cleared ? 'ops-clear' : 'ops-unclear',
        entityType: 'payable',
        entityId: payable.id,
        description: cleared
          ? `CXP producción validada: ${payable.documentNumber || payable.counterpartyName || payable.id}`
          : `CXP producción invalidada: ${payable.documentNumber || payable.counterpartyName || payable.id}`,
        userEmail: user.email,
        before: buildPayableSnapshot(payable),
        after: buildPayableSnapshot(payable, {
          ...payload,
          updatedAt: nowIso,
        }),
        metadata: { productionWeekRef: week, note },
      });
      return { success: true };
    } catch (error) {
      logError('Error setOpsCleared:', error);
      return { success: false, error };
    }
  };

  return {
    payables,
    loading,
    error,
    createPayable,
    registerPayment,
    updatePayable,
    cancelPayable,
    convertToReceivable,
    markAsPaid,
    setOpsCleared,
  };
};

export default usePayables;
