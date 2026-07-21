import { useMemo } from 'react';
import { useTransactions } from './useTransactions';
import { OPERATIONAL_DATA_START } from '../finance/constants';

/**
 * useAllTransactions — all transactions (2025 historical + 2026+ operational)
 * read from the live Firestore `transactions` collection via useTransactions.
 *
 * History: until Plan 003 the 2025 records (419 rows, ids `sheet-2025-N`,
 * source `2025-sheet`) were bundled as a static JS chunk and merged with the
 * live snapshot here. They now live in Firestore alongside operational data
 * (migrated by scripts/migrate2025ToFirestore.mjs), so this hook is a thin
 * derivation over the single live source.
 *
 * The return shape is unchanged for the 6 consumers:
 *   - allTransactions: every record, sorted descending by date.
 *   - loading / error: passed through from the live snapshot. loading is true
 *     until the snapshot resolves — with a single source, "both sources ready"
 *     collapses to "snapshot ready", preserving the old gate semantics.
 *   - transactions2025 / transactions2026: split on OPERATIONAL_DATA_START
 *     (the deliberate architecture boundary in src/finance/constants.js) —
 *     records dated before it are the historical sheet, the rest operational.
 */
export const useAllTransactions = (user) => {
  const {
    transactions: firebaseTransactions,
    loading,
    error,
  } = useTransactions(user);

  const allTransactions = useMemo(() => {
    if (!firebaseTransactions) return [];
    return firebaseTransactions
      .map((t) => ({
        ...t,
        source: t.source || 'firebase-live',
        year: t.date ? new Date(t.date).getFullYear() : null,
      }))
      .sort((a, b) => new Date(b.date) - new Date(a.date));
  }, [firebaseTransactions]);

  const transactions2025 = useMemo(
    () => allTransactions.filter((t) => t.date && String(t.date) < OPERATIONAL_DATA_START),
    [allTransactions],
  );

  const transactions2026 = useMemo(
    () => allTransactions.filter((t) => !t.date || String(t.date) >= OPERATIONAL_DATA_START),
    [allTransactions],
  );

  return {
    allTransactions,
    loading,
    error: error || null,
    csvError: null,
    transactions2025,
    transactions2026,
  };
};
