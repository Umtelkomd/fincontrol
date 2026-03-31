import { logError } from '../utils/logger';
import { addDoc, updateDoc, deleteDoc, doc, collection, serverTimestamp, arrayUnion } from 'firebase/firestore';
import { db, appId } from '../services/firebase';
import { writeAuditLogEntry } from '../utils/auditLog';
import { computeNetFromGross, computeTaxFromGross } from '../utils/formatters';
import { TAX_RATES } from '../constants/config';

const buildLegacySnapshot = (transaction, override = {}) => ({
  date: override.date ?? transaction?.date ?? null,
  description: override.description ?? transaction?.description ?? '',
  amount: override.amount ?? parseFloat(transaction?.amount || 0),
  type: override.type ?? transaction?.type ?? '',
  category: override.category ?? transaction?.category ?? '',
  project: override.project ?? transaction?.project ?? '',
  costCenter: override.costCenter ?? transaction?.costCenter ?? '',
  status: override.status ?? transaction?.status ?? '',
  paidAmount: override.paidAmount ?? parseFloat(transaction?.paidAmount || 0),
  lastModifiedBy: override.lastModifiedBy ?? transaction?.lastModifiedBy ?? '',
  lastModifiedAt: override.lastModifiedAt ?? transaction?.lastModifiedAt ?? null,
  // VAT fields — backward compat: if missing, assume STANDARD 19%
  taxRate: override.taxRate ?? transaction?.taxRate ?? TAX_RATES.STANDARD,
  netAmount: override.netAmount ?? transaction?.netAmount ?? null,
  taxAmount: override.taxAmount ?? transaction?.taxAmount ?? null,
});

export const useTransactionActions = (user) => {
  const transactionsRef = collection(db, 'artifacts', appId, 'public', 'data', 'transactions');

  const createTransaction = async (formData) => {
    if (!user) return;

    try {
      const notes = [
        {
          text: `Transacción creada por ${user.email}`,
          timestamp: new Date().toISOString(),
          user: user.email,
          type: 'system'
        }
      ];

      // Si hay comentario inicial, agregarlo como nota
      if (formData.comment && formData.comment.trim()) {
        notes.push({
          text: formData.comment.trim(),
          timestamp: new Date().toISOString(),
          user: user.email,
          type: 'comment'
        });
      }

      // Compute VAT fields from gross amount
      // Backward compat: taxRate defaults to 19% (STANDARD) if not provided
      const grossAmount = parseFloat(formData.amount);
      const taxRate = formData.taxRate ?? TAX_RATES.STANDARD;
      const netAmount = taxRate > 0 ? computeNetFromGross(grossAmount, taxRate) : grossAmount;
      const taxAmount = computeTaxFromGross(grossAmount, taxRate);

      const transactionData = {
        date: formData.date,
        description: formData.description,
        amount: grossAmount,
        type: formData.type,
        category: formData.category,
        project: formData.project,
        costCenter: formData.costCenter || 'Sin asignar',
        status: formData.status,
        notes: notes,
        isRecurring: formData.isRecurring || false,
        recurringFrequency: formData.isRecurring ? formData.recurringFrequency : null,
        recurringEndDate: formData.isRecurring && formData.recurringEndDate ? formData.recurringEndDate : null,
        hasUnreadUpdates: formData.comment ? true : false,
        lastModifiedBy: user.email,
        lastModifiedAt: serverTimestamp(),
        createdAt: serverTimestamp(),
        // VAT fields — German Umsatzsteuer
        taxRate,
        netAmount,
        taxAmount,
      };

      const docRef = await addDoc(transactionsRef, transactionData);
      await writeAuditLogEntry({
        action: 'create',
        entityType: 'transaction',
        entityId: docRef.id,
        description: `Transacción legacy creada: ${formData.description || 'Sin descripción'}`,
        userEmail: user.email,
        after: buildLegacySnapshot(transactionData, {
          lastModifiedAt: new Date().toISOString(),
        }),
      });
      return { success: true, id: docRef.id };
    } catch (error) {
      logError("Error creating transaction:", error);
      return { success: false, error };
    }
  };

  const updateTransaction = async (transactionId, formData, existingNotes = [], existingTransaction = null) => {
    if (!user) return;

    try {
      const transactionDoc = doc(db, 'artifacts', appId, 'public', 'data', 'transactions', transactionId);
      
      const newNotes = [
        ...existingNotes,
        {
          text: `Transacción editada por ${user.email}`,
          timestamp: new Date().toISOString(),
          user: user.email,
          type: 'system'
        }
      ];

      // Si hay comentario, agregarlo al array de notes (no reemplazar)
      if (formData.comment && formData.comment.trim()) {
        newNotes.push({
          text: formData.comment.trim(),
          timestamp: new Date().toISOString(),
          user: user.email,
          type: 'comment'
        });
      }

      // Compute VAT fields from gross amount — backward compat uses existing taxRate or 19%
      const grossAmount = parseFloat(formData.amount);
      const taxRate = formData.taxRate ?? existingTransaction?.taxRate ?? TAX_RATES.STANDARD;
      const netAmount = taxRate > 0 ? computeNetFromGross(grossAmount, taxRate) : grossAmount;
      const taxAmount = computeTaxFromGross(grossAmount, taxRate);

      const payload = {
        date: formData.date,
        description: formData.description,
        amount: grossAmount,
        type: formData.type,
        category: formData.category,
        project: formData.project,
        costCenter: formData.costCenter || 'Sin asignar',
        status: formData.status,
        notes: newNotes,
        isRecurring: formData.isRecurring || false,
        recurringFrequency: formData.isRecurring ? formData.recurringFrequency : null,
        recurringEndDate: formData.isRecurring && formData.recurringEndDate ? formData.recurringEndDate : null,
        hasUnreadUpdates: true,
        lastModifiedBy: user.email,
        lastModifiedAt: serverTimestamp(),
        // VAT fields — German Umsatzsteuer
        taxRate,
        netAmount,
        taxAmount,
      };

      await updateDoc(transactionDoc, payload);
      await writeAuditLogEntry({
        action: 'update',
        entityType: 'transaction',
        entityId: transactionId,
        description: `Transacción legacy editada: ${formData.description || existingTransaction?.description || 'Sin descripción'}`,
        userEmail: user.email,
        before: existingTransaction ? buildLegacySnapshot(existingTransaction) : null,
        after: buildLegacySnapshot(existingTransaction, {
          ...payload,
          lastModifiedBy: user.email,
          lastModifiedAt: new Date().toISOString(),
        }),
      });

      return { success: true };
    } catch (error) {
      logError("Error updating transaction:", error);
      return { success: false, error };
    }
  };

  const deleteTransaction = async (transactionId, transaction = null) => {
    if (!user) return;

    try {
      const transactionDoc = doc(db, 'artifacts', appId, 'public', 'data', 'transactions', transactionId);
      await deleteDoc(transactionDoc);
      await writeAuditLogEntry({
        action: 'delete',
        entityType: 'transaction',
        entityId: transactionId,
        description: `Transacción legacy eliminada: ${transaction?.description || transactionId}`,
        userEmail: user.email,
        before: transaction ? buildLegacySnapshot(transaction) : null,
      });
      return { success: true };
    } catch (error) {
      logError("Error deleting transaction:", error);
      return { success: false, error };
    }
  };

  const toggleStatus = async (transaction, targetStatus = null) => {
    if (!user) return;

    const STATUS_LABELS = {
      pending: 'Pendiente (CXC)',
      paid: 'Liquidado',
      partial: 'Parcial',
      cancelled: 'Anulado',
    };

    try {
      const transactionDoc = doc(db, 'artifacts', appId, 'public', 'data', 'transactions', transaction.id);
      const currentStatus = transaction.status === 'completed' ? 'paid' : transaction.status;
      const newStatus = targetStatus || (currentStatus === 'paid' ? 'pending' : 'paid');
      const newLabel = STATUS_LABELS[newStatus] || newStatus;

      const updatePayload = {
        status: newStatus,
        notes: arrayUnion({
          text: `Estado cambiado de ${STATUS_LABELS[currentStatus] || currentStatus} a ${newLabel} por ${user.email}`,
          timestamp: new Date().toISOString(),
          user: user.email,
          type: 'system'
        }),
        hasUnreadUpdates: true,
        lastModifiedBy: user.email,
        lastModifiedAt: serverTimestamp()
      };

      // If reverting to pending, reset paidAmount so the full amount counts as receivable
      if (newStatus === 'pending' && (currentStatus === 'paid' || currentStatus === 'completed')) {
        updatePayload.paidAmount = 0;
      }

      // If marking as paid, set paidAmount to full amount
      if (newStatus === 'paid' && currentStatus !== 'paid') {
        updatePayload.paidAmount = parseFloat(transaction.amount || 0);
      }

      await updateDoc(transactionDoc, updatePayload);
      await writeAuditLogEntry({
        action: 'status_change',
        entityType: 'transaction',
        entityId: transaction.id,
        description: `Estado cambiado de ${currentStatus} a ${newStatus}: ${transaction.description || transaction.id}`,
        userEmail: user.email,
        before: buildLegacySnapshot(transaction),
        after: buildLegacySnapshot(transaction, {
          status: newStatus,
          paidAmount: updatePayload.paidAmount ?? transaction.paidAmount,
          lastModifiedBy: user.email,
          lastModifiedAt: new Date().toISOString(),
        }),
      });

      return { success: true };
    } catch (error) {
      logError("Error changing status:", error);
      return { success: false, error };
    }
  };

  const addNote = async (transaction, noteText) => {
    if (!user || !noteText.trim()) return { success: false };

    try {
      const transactionDoc = doc(db, 'artifacts', appId, 'public', 'data', 'transactions', transaction.id);

      await updateDoc(transactionDoc, {
        notes: arrayUnion({
          text: noteText.trim(),
          timestamp: new Date().toISOString(),
          user: user.email,
          type: 'comment'
        }),
        hasUnreadUpdates: true,
        lastModifiedBy: user.email,
        lastModifiedAt: serverTimestamp()
      });
      await writeAuditLogEntry({
        action: 'update',
        entityType: 'transaction',
        entityId: transaction.id,
        description: `Comentario agregado a transacción legacy: ${transaction.description || transaction.id}`,
        userEmail: user.email,
        metadata: {
          noteType: 'comment',
          noteLength: noteText.trim().length,
        },
      });
      
      return { success: true };
    } catch (error) {
      logError("Error adding note:", error);
      return { success: false, error };
    }
  };

  const markAsRead = async (transactionId) => {
    if (!user) return;

    try {
      const transactionDoc = doc(db, 'artifacts', appId, 'public', 'data', 'transactions', transactionId);
      await updateDoc(transactionDoc, {
        hasUnreadUpdates: false
      });
      return { success: true };
    } catch (error) {
      logError("Error marking as read:", error);
      return { success: false, error };
    }
  };

  const registerPayment = async (transaction, paymentData) => {
    if (!user) return { success: false };

    try {
      const transactionDoc = doc(db, 'artifacts', appId, 'public', 'data', 'transactions', transaction.id);
      const currentPaid = transaction.paidAmount || 0;
      const newPaidAmount = currentPaid + paymentData.amount;

      // Validate overpayment
      if (newPaidAmount > transaction.amount + 0.01) {
        return { success: false, error: 'El pago excede el monto pendiente' };
      }

      const newStatus = newPaidAmount >= transaction.amount ? 'paid' : 'partial';

      const payment = {
        amount: paymentData.amount,
        date: paymentData.date,
        method: paymentData.method,
        note: paymentData.note || '',
        user: user.email,
        timestamp: new Date().toISOString()
      };

      await updateDoc(transactionDoc, {
        paidAmount: newPaidAmount,
        payments: arrayUnion(payment),
        status: newStatus,
        notes: arrayUnion({
          text: `Pago registrado: €${paymentData.amount.toFixed(2)} vía ${paymentData.method} por ${user.email}${paymentData.note ? ` — ${paymentData.note}` : ''}`,
          timestamp: new Date().toISOString(),
          user: user.email,
          type: 'system'
        }),
        hasUnreadUpdates: true,
        lastModifiedBy: user.email,
        lastModifiedAt: serverTimestamp()
      });
      await writeAuditLogEntry({
        action: 'payment',
        entityType: 'transaction',
        entityId: transaction.id,
        description: `Pago registrado en transacción legacy: ${transaction.description || transaction.id}`,
        userEmail: user.email,
        before: buildLegacySnapshot(transaction),
        after: buildLegacySnapshot(transaction, {
          paidAmount: newPaidAmount,
          status: newStatus,
          lastModifiedBy: user.email,
          lastModifiedAt: new Date().toISOString(),
        }),
        metadata: {
          amount: paymentData.amount,
          method: paymentData.method,
          date: paymentData.date,
          note: paymentData.note || '',
        },
      });

      return { success: true };
    } catch (error) {
      logError("Error registering payment:", error);
      return { success: false, error };
    }
  };

  const markAsCompleted = async (transaction) => {
    if (!user) return { success: false };
    try {
      const transactionDoc = doc(db, 'artifacts', appId, 'public', 'data', 'transactions', transaction.id);
      const isIncome = transaction.type === 'income';
      const label = isIncome ? 'Cobrado' : 'Pagado';
      await updateDoc(transactionDoc, {
        status: 'completed',
        paidDate: new Date().toISOString(),
        paidAmount: transaction.amount,
        notes: arrayUnion({
          text: `Marcado como ${label} por ${user.email}`,
          timestamp: new Date().toISOString(),
          user: user.email,
          type: 'system'
        }),
        hasUnreadUpdates: true,
        lastModifiedBy: user.email,
        lastModifiedAt: serverTimestamp()
      });
      await writeAuditLogEntry({
        action: 'status_change',
        entityType: 'transaction',
        entityId: transaction.id,
        description: `Transacción legacy marcada como ${label}: ${transaction.description || transaction.id}`,
        userEmail: user.email,
        before: buildLegacySnapshot(transaction),
        after: buildLegacySnapshot(transaction, {
          status: 'completed',
          paidAmount: transaction.amount,
          lastModifiedBy: user.email,
          lastModifiedAt: new Date().toISOString(),
        }),
      });
      return { success: true };
    } catch (error) {
      logError("Error marking as completed:", error);
      return { success: false, error };
    }
  };

  return {
    createTransaction,
    updateTransaction,
    deleteTransaction,
    toggleStatus,
    addNote,
    markAsRead,
    registerPayment,
    markAsCompleted
  };
};
