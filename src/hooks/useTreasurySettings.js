import { useEffect, useMemo, useState } from 'react';
import { doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { db, appId } from '../services/firebase';
import { logError } from '../utils/logger';
import { writeAuditLogEntry } from '../utils/auditLog';

const MONTH_KEY_RE = /^\d{4}-\d{2}$/;

export const DEFAULT_ALERT_BUFFER_EUR = 10000;

const sortByMonthDesc = (left, right) => (right.month || '').localeCompare(left.month || '');

/**
 * Treasury settings (settings/treasury): monthly VAT estimates (the company
 * files with Dauerfristverlängerung — VAT for month M is due the 10th of
 * M+2) and the projected-cash alert buffer.
 */
export const useTreasurySettings = (user) => {
  const [treasurySettings, setTreasurySettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const docRef = useMemo(
    () => doc(db, 'artifacts', appId, 'public', 'data', 'settings', 'treasury'),
    [],
  );

  useEffect(() => {
    if (!user) return undefined;

    const unsubscribe = onSnapshot(
      docRef,
      (snapshot) => {
        setTreasurySettings(snapshot.exists() ? snapshot.data() : null);
        setLoading(false);
      },
      (err) => {
        logError('Error loading treasury settings:', err);
        setError(err);
        setLoading(false);
      },
    );

    return () => unsubscribe();
  }, [docRef, user]);

  const vatEstimates = useMemo(() => {
    const list = Array.isArray(treasurySettings?.vatEstimates)
      ? treasurySettings.vatEstimates
      : [];
    return [...list].sort(sortByMonthDesc);
  }, [treasurySettings]);

  const alertBufferEur = Number.isFinite(Number(treasurySettings?.alertBufferEur))
    ? Number(treasurySettings.alertBufferEur)
    : DEFAULT_ALERT_BUFFER_EUR;

  const persist = async (partial, description) => {
    if (!user) return { success: false, error: 'No user' };
    try {
      await setDoc(
        docRef,
        { ...partial, updatedAt: serverTimestamp(), updatedBy: user.email },
        { merge: true },
      );
      await writeAuditLogEntry({
        action: 'update',
        entityType: 'settings',
        entityId: 'treasury',
        description,
        userEmail: user.email,
        after: partial,
      });
      return { success: true };
    } catch (err) {
      logError('Error saving treasury settings:', err);
      return { success: false, error: err };
    }
  };

  const saveVatEstimate = async ({ month, amount }) => {
    if (!MONTH_KEY_RE.test(month || '')) return { success: false, error: 'invalid-month' };
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount < 0) {
      return { success: false, error: 'invalid-amount' };
    }
    const next = [
      ...vatEstimates.filter((entry) => entry.month !== month),
      { month, amount: Math.round(numericAmount * 100) / 100 },
    ].sort(sortByMonthDesc);
    return persist(
      { vatEstimates: next },
      `Estimado de IVA actualizado: ${month} → ${numericAmount} €`,
    );
  };

  const removeVatEstimate = async (month) => {
    const next = vatEstimates.filter((entry) => entry.month !== month);
    return persist({ vatEstimates: next }, `Estimado de IVA eliminado: ${month}`);
  };

  const saveAlertBuffer = async (amount) => {
    // Number('') === 0 — an emptied input must NOT silently persist a 0 €
    // buffer (that would disable the early-warning alert).
    if (amount === null || amount === undefined || String(amount).trim() === '') {
      return { success: false, error: 'invalid-amount' };
    }
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount < 0) {
      return { success: false, error: 'invalid-amount' };
    }
    return persist(
      { alertBufferEur: Math.round(numericAmount) },
      `Colchón de alertas actualizado: ${numericAmount} €`,
    );
  };

  return {
    treasurySettings,
    vatEstimates,
    alertBufferEur,
    loading,
    error,
    saveVatEstimate,
    removeVatEstimate,
    saveAlertBuffer,
  };
};

export default useTreasurySettings;
