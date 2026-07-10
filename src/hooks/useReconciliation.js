import { useEffect, useMemo, useState } from 'react';
import { doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { db, appId } from '../services/firebase';
import { logError } from '../utils/logger';
import { writeAuditLogEntry } from '../utils/auditLog';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const sortByDateDesc = (left, right) => (right.date || '').localeCompare(left.date || '');

/**
 * Reconciliation anchors (settings/reconciliation): verified bank balances
 * the cash position derives from. The newest anchor ≤ today wins; movements
 * after it complete the balance. Managed from Configuración → Tesorería.
 */
export const useReconciliation = (user) => {
  const [anchors, setAnchors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const docRef = useMemo(
    () => doc(db, 'artifacts', appId, 'public', 'data', 'settings', 'reconciliation'),
    [],
  );

  useEffect(() => {
    if (!user) return undefined;

    const unsubscribe = onSnapshot(
      docRef,
      (snapshot) => {
        const data = snapshot.exists() ? snapshot.data() : null;
        const list = Array.isArray(data?.anchors) ? data.anchors : [];
        setAnchors([...list].sort(sortByDateDesc));
        setLoading(false);
      },
      (err) => {
        logError('Error loading reconciliation anchors:', err);
        setError(err);
        setLoading(false);
      },
    );

    return () => unsubscribe();
  }, [docRef, user]);

  const persist = async (nextAnchors, description) => {
    if (!user) return { success: false, error: 'No user' };
    try {
      await setDoc(docRef, {
        anchors: nextAnchors,
        updatedAt: serverTimestamp(),
        updatedBy: user.email,
      });
      await writeAuditLogEntry({
        action: 'update',
        entityType: 'settings',
        entityId: 'reconciliation',
        description,
        userEmail: user.email,
        after: { anchors: nextAnchors },
      });
      return { success: true };
    } catch (err) {
      logError('Error saving reconciliation anchors:', err);
      return { success: false, error: err };
    }
  };

  const addAnchor = async ({ date, balance, source, note = '' }) => {
    if (!ISO_DATE_RE.test(date || '')) return { success: false, error: 'invalid-date' };
    const numericBalance = Number(balance);
    if (!Number.isFinite(numericBalance)) return { success: false, error: 'invalid-balance' };
    if (!source || !source.trim()) return { success: false, error: 'missing-source' };

    const anchor = {
      date,
      balance: Math.round(numericBalance * 100) / 100,
      source: source.trim(),
      note: note.trim(),
      confirmedBy: user?.email || '',
      confirmedAt: new Date().toISOString(),
    };
    const next = [...anchors.filter((entry) => entry.date !== date), anchor].sort(sortByDateDesc);
    return persist(next, `Ancla de conciliación registrada: ${date} → ${anchor.balance} €`);
  };

  const removeAnchor = async (date) => {
    const next = anchors.filter((entry) => entry.date !== date);
    if (next.length === anchors.length) return { success: false, error: 'not-found' };
    return persist(next, `Ancla de conciliación eliminada: ${date}`);
  };

  return { anchors, loading, error, addAnchor, removeAnchor };
};

export default useReconciliation;
