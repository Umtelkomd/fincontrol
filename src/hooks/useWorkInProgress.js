import { useEffect, useMemo, useState } from 'react';
import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import { db, appId } from '../services/firebase';
import { logError } from '../utils/logger';
import { writeAuditLogEntry } from '../utils/auditLog';
import { sanitizeValue } from '../utils/sanitizeFirestore';
import {
  WIP_STAGE,
  WIP_STATUS,
  currentWipByProject,
  summarizeWip,
  totalWip,
} from '../finance/workInProgress';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const STAGES = new Set([WIP_STAGE.EXECUTED, WIP_STAGE.CERTIFIED]);

/**
 * Work in progress (`workInProgress`): executed work that has not become an
 * invoice yet — the 60–80 k € this company had delivered but not certified,
 * which existed nowhere in the app and made the reported position read as
 * bankruptcy.
 *
 * A TOP-LEVEL collection, not a subcollection under `projects`: every collection
 * in this app is flat under `artifacts/{appId}/public/data/…`, the existing
 * catch-all security rule already covers it, and Resumen needs the company-wide
 * total from ONE listener — a subcollection would force a `collectionGroup`
 * query, which needs its own rule and a composite index.
 *
 * ⚠️ WIP IS NOT CASH and NOT A RECEIVABLE. Nothing here touches the ledger, the
 * reconciliation anchors or the forecast, and nothing is ever written into
 * `receivables` (that would pollute aging, DSO and the collection slip). The
 * arithmetic lives in `src/finance/workInProgress.js`; this hook is only I/O.
 */
export const useWorkInProgress = (user, options = {}) => {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(() => !!user);
  const [error, setError] = useState(null);

  const colRef = useMemo(
    () => collection(db, 'artifacts', appId, 'public', 'data', 'workInProgress'),
    [],
  );

  // One reference date per hook instance, mirroring Resumen's `useMemo(() => new
  // Date(), [])`. Injectable so ages are deterministic under test.
  const fallbackToday = useMemo(() => new Date(), []);
  const today = options.today || fallbackToday;

  useEffect(() => {
    if (!user) return undefined;

    const unsubscribe = onSnapshot(
      query(colRef, orderBy('asOf', 'desc')),
      (snapshot) => {
        // sanitizeValue, not raw data: `createdAt` is a Firestore Timestamp and
        // anything non-serializable reaching React state is error 301.
        setEntries(snapshot.docs.map((entry) => ({ id: entry.id, ...sanitizeValue(entry.data()) })));
        setError(null);
        setLoading(false);
      },
      (err) => {
        logError('Error loading work in progress:', err);
        setError(err);
        setLoading(false);
      },
    );

    return () => unsubscribe();
  }, [colRef, user]);

  const current = useMemo(() => currentWipByProject(entries), [entries]);
  const summary = useMemo(() => summarizeWip(entries, today), [entries, today]);
  const total = useMemo(() => totalWip(entries), [entries]);

  /**
   * Record a figure. This SUPERSEDES rather than edits: it always adds a new
   * document, so the previous figure survives as history and the owner can see
   * whether the backlog is growing or shrinking. There is no update path and no
   * delete path by design — a wrong number is corrected by recording the right
   * one, and the newest entry wins.
   */
  const recordWip = async ({
    projectId,
    projectName,
    amount,
    asOf,
    stage = WIP_STAGE.EXECUTED,
    note = '',
  } = {}) => {
    if (!user) return { success: false, error: 'no-user' };

    const id = String(projectId ?? '').trim();
    const name = String(projectName ?? '').trim();
    if (!id && !name) return { success: false, error: 'invalid-project' };

    // Blank must not become 0: `Number('')` is 0, and a silently-zeroed backlog
    // is exactly the invisible-money problem this feature exists to end.
    if (amount === null || amount === undefined || String(amount).trim() === '') {
      return { success: false, error: 'invalid-amount' };
    }
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      return { success: false, error: 'invalid-amount' };
    }

    if (!ISO_DATE_RE.test(String(asOf ?? ''))) return { success: false, error: 'invalid-date' };
    if (!STAGES.has(stage)) return { success: false, error: 'invalid-stage' };

    const rounded = Math.round(numericAmount * 100) / 100;

    try {
      await addDoc(colRef, {
        projectId: id,
        projectName: name || id,
        amount: rounded,
        asOf,
        stage,
        note: String(note ?? '').trim(),
        status: WIP_STATUS.OPEN,
        receivableId: null,
        invoicedAt: null,
        createdBy: user.email,
        createdAt: serverTimestamp(),
      });
      await writeAuditLogEntry({
        action: 'create',
        entityType: 'workInProgress',
        description: `Obra ejecutada registrada: ${name || id} → ${rounded} € (${asOf})`,
        userEmail: user.email,
        after: { projectId: id, projectName: name || id, amount: rounded, asOf, stage },
      });
      return { success: true };
    } catch (err) {
      logError('Error recording work in progress:', err);
      return { success: false, error: err };
    }
  };

  /**
   * Close an entry because the work finally reached an invoice. The document is
   * kept (linked to its receivable when the invoice already exists in the app)
   * so the history of how long that money sat stays readable.
   */
  const markInvoiced = async (entryId, { receivableId = null } = {}) => {
    if (!user) return { success: false, error: 'no-user' };

    const entry = entries.find((item) => item.id === entryId);
    if (!entry) return { success: false, error: 'not-found' };

    try {
      await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'workInProgress', entryId), {
        status: WIP_STATUS.INVOICED,
        receivableId: receivableId || null,
        invoicedAt: new Date().toISOString(),
        updatedBy: user.email,
        updatedAt: serverTimestamp(),
      });
      await writeAuditLogEntry({
        action: 'update',
        entityType: 'workInProgress',
        entityId: entryId,
        description: `Obra facturada: ${entry.projectName || entry.projectId} → ${entry.amount} €`,
        userEmail: user.email,
        before: { status: entry.status, amount: entry.amount },
        after: { status: WIP_STATUS.INVOICED, receivableId: receivableId || null },
      });
      return { success: true };
    } catch (err) {
      logError('Error closing work in progress entry:', err);
      return { success: false, error: err };
    }
  };

  return { entries, current, summary, total, loading, error, recordWip, markInvoiced };
};

export default useWorkInProgress;
