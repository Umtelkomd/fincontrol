import { useEffect, useMemo, useState } from 'react';
import { useTransactions } from './useTransactions';

/**
 * useAllTransactions — merges 2025 static data + 2026 Firebase transactions.
 *
 * The 2025 dataset (112 kB, 419 records) is loaded via a dynamic import so it
 * lands in its own chunk and does not inflate the main bundle. A module-level
 * cache (data2025Cache) means the chunk is fetched exactly once per session
 * regardless of how many components mount this hook simultaneously; subsequent
 * mounts receive the cached array synchronously via the useState initializer.
 *
 * Loading semantics: the hook stays in loading=true until BOTH the live
 * Firebase snapshot AND the 2025 chunk have resolved. This prevents opening
 * balances from rendering with only half the data (e.g. cashflow anchoring on
 * Dec 2025 totals would produce a wrong intermediate number if 2025 data
 * arrived late).
 */

// Module-level cache — survives remounts, cleared only on full page reload.
let data2025Cache = null;
let data2025Promise = null;

const load2025 = () => {
  if (data2025Cache) return Promise.resolve(data2025Cache);
  if (!data2025Promise) {
    data2025Promise = import('../data/transactions2025').then((mod) => {
      data2025Cache = mod.transactions2025 || mod.default || [];
      return data2025Cache;
    });
  }
  return data2025Promise;
};

export const useAllTransactions = (user) => {
  const { transactions: firebaseTransactions, loading: fbLoading, error: fbError } = useTransactions(user);

  // Initialise with the cache if already populated (avoids a loading flash on
  // subsequent mounts after the chunk has been fetched the first time).
  const [data2025, setData2025] = useState(() => data2025Cache || null);

  useEffect(() => {
    if (data2025Cache) return; // already loaded
    let active = true;
    load2025().then((data) => {
      if (active) setData2025(data);
    });
    return () => { active = false; };
  }, []);

  const liveTransactions = useMemo(() => {
    if (!firebaseTransactions) return [];
    return firebaseTransactions.map((t) => ({
      ...t,
      source: t.source || 'firebase-live',
      year: t.date ? new Date(t.date).getFullYear() : null,
    }));
  }, [firebaseTransactions]);

  const allTransactions = useMemo(() => {
    if (!data2025) return liveTransactions;
    return [...data2025, ...liveTransactions].sort(
      (a, b) => new Date(b.date) - new Date(a.date),
    );
  }, [data2025, liveTransactions]);

  // Stay in loading state until BOTH sources are ready.
  const loading = fbLoading || !data2025;

  return {
    allTransactions,
    loading,
    error: fbError || null,
    csvError: null,
    transactions2025: data2025 || [],
    transactions2026: liveTransactions,
  };
};
