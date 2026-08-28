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
} from 'firebase/firestore';
import { adaptReceivableDoc } from '../finance/adapters';
import {
  DEFAULT_CURRENCY,
  MAIN_ACCOUNT_ID,
} from '../finance/constants';
import { clampMoney, toISODate } from '../finance/utils';
import { LUMEN_SOURCE_SYSTEM, normalizeProjectCode } from '../finance/lumenContract';
import {
  INSYTE_SOURCE_SYSTEM,
  INSYTE_OPEN_SIN_PEDIDO,
  insyteSourceKey,
  padPresupuesto,
  padPedido,
  parseKw,
} from '../finance/insyteContract';
import { CORRECTION_TARGET, applyCorrection } from '../lib/finance';
import { db, appId } from '../services/firebase';
import { writeAuditLogEntry } from '../utils/auditLog';

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
        productionWeekRef: data.productionWeekRef || data.kw || parseKw(data.referenciaObra || data.description || ''),
        source: typeof data.source === 'string' ? data.source : null,
        sourceKey: data.sourceKey || '',
        sourceSystem: data.sourceSystem || (String(data.sourceKey || '').startsWith('insyte:') ? INSYTE_SOURCE_SYSTEM : data.sourceKey ? LUMEN_SOURCE_SYSTEM : ''),
        lumenWorkOrderId: data.lumenWorkOrderId || '',
        lumenOrderNumber: data.lumenOrderNumber || data.documentNumber || '',
        lumenCycleId: data.lumenCycleId || '',
        numeroPresupuesto: padPresupuesto(data.numeroPresupuesto || ''),
        numeroPedido: padPedido(data.numeroPedido || ''),
        fechaPresupuesto: data.fechaPresupuesto || '',
        fechaPedido: data.fechaPedido || '',
        referenciaObra: data.referenciaObra || '',
        kw: data.kw || parseKw(data.referenciaObra || data.description || ''),
        tipoObra: data.tipoObra || '',
        obraPueblo: data.obraPueblo || '',
        pep: data.pep || '',
        estadoInsyte: data.estadoInsyte || '',
        importePedido: data.importePedido ?? null,
        importePresupuesto: data.importePresupuesto ?? null,
        rechnungId: data.rechnungId || '',
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
        // Status is no longer settable by decree. `applyCorrection` allows only
        // two honest outcomes — cancel a duplicate, or reopen a document whose
        // paid claim has no bank movement behind it — and refuses 'settled'
        // outright. See src/lib/finance/documentLifecycle.js.
        const correction = applyCorrection(
          { ...receivable, grossAmount },
          {
            target: data.forceStatus === 'issued' ? CORRECTION_TARGET.REOPENED : data.forceStatus,
            reason: data.correctionReason || '',
            actor: user.email,
          },
        );
        if (!correction.ok) return { success: false, error: new Error(correction.message) };

        nextStatus = correction.next.status;
        nextOpenAmount = correction.next.openAmount;
        nextPaidAmount = correction.next.paidAmount;
        extraFields.paidAmount = correction.next.paidAmount;
        extraFields.payments = correction.next.payments;
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
   * Insyte 2026+: create or update CxC by numero_presupuesto (pad 10).
   * Does not touch Lumen sourceKeys. Skips settled/cancelled.
   */
  const upsertReceivableByInsyteKey = async (data) => {
    if (!user) return { success: false, error: new Error('No user') };
    const numeroPresupuesto = padPresupuesto(data.numeroPresupuesto || data.sourceKey);
    const sourceKey = insyteSourceKey(numeroPresupuesto);
    if (!sourceKey) return { success: false, error: new Error('numero_presupuesto requerido') };

    try {
      const q = query(receivablesRef, where('sourceKey', '==', sourceKey), limit(1));
      const snap = await getDocs(q);
      const amount = clampMoney(
        data.importePedido ?? data.importePresupuesto ?? data.amount ?? 0,
      );
      const patch = {
        numeroPresupuesto,
        numeroPedido: padPedido(data.numeroPedido || ''),
        fechaPresupuesto: data.fechaPresupuesto || '',
        fechaPedido: data.fechaPedido || '',
        referenciaObra: data.referenciaObra || '',
        kw: data.kw || parseKw(data.referenciaObra || ''),
        tipoObra: data.tipoObra || '',
        obraPueblo: data.obraPueblo || '',
        pep: data.pep || '',
        estadoInsyte: data.estadoInsyte || '',
        importePedido: data.importePedido ?? null,
        importePresupuesto: data.importePresupuesto ?? amount,
        rechnungId: data.rechnungId || '',
        productionWeekRef: data.kw || parseKw(data.referenciaObra || ''),
        sourceSystem: INSYTE_SOURCE_SYSTEM,
        sourceKey,
        source: 'insyte',
        description: data.description || data.referenciaObra || '',
        client: data.client || 'INSYTE',
        counterpartyName: data.client || 'INSYTE',
        documentNumber: numeroPresupuesto,
        issueDate: data.fechaPresupuesto || data.fechaPedido || data.issueDate,
        dueDate: data.dueDate || data.fechaPresupuesto || data.fechaPedido,
        projectName: data.projectName || data.obraPueblo || data.tipoObra || '',
      };

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
          ...patch,
          grossAmount: nextGross,
          amount: nextGross,
          openAmount: nextOpen,
          pendingAmount: nextOpen,
          updatedAt: serverTimestamp(),
          updatedBy: user.email,
          auditTrail: arrayUnion({
            action: 'upsert-insyte',
            user: user.email,
            timestamp: new Date().toISOString(),
            detail: `Upsert Insyte ${sourceKey}`,
          }),
        });
        return { success: true, id: existing.id, action: 'updated' };
      }

      const created = await createReceivable({
        ...patch,
        amount,
        invoiceNumber: numeroPresupuesto,
      });
      return { ...created, action: created.success ? 'created' : 'error' };
    } catch (error) {
      logError('upsertReceivableByInsyteKey:', error);
      return { success: false, error };
    }
  };

  const importInsyteOpenSinPedido = async () => {
    const results = [];
    for (const row of INSYTE_OPEN_SIN_PEDIDO) {
      results.push(await upsertReceivableByInsyteKey({
        ...row,
        numeroPresupuesto: row.numero_presupuesto,
        numeroPedido: row.numero_pedido,
        fechaPresupuesto: row.fecha_presupuesto,
        referenciaObra: row.referencia_obra,
        tipoObra: row.tipo_obra,
        obraPueblo: row.obra_pueblo,
        estadoInsyte: row.estado_insyte,
        importePresupuesto: row.importe_presupuesto,
        amount: row.importe_presupuesto,
      }));
    }
    return results;
  };

  return {
    receivables,
    loading,
    error,
    createReceivable,
    registerPayment,
    updateReceivable,
    cancelReceivable,
    convertToPayable,
    markAsPaid,
    upsertReceivableBySourceKey,
    upsertReceivableByInsyteKey,
    importInsyteOpenSinPedido,
  };
};

export default useReceivables;
