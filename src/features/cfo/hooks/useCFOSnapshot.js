import { useCallback, useEffect, useRef, useState } from 'react';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
} from 'firebase/firestore';
import { db, appId } from '../../../services/firebase';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from '../../../constants/categories';
import { logError } from '../../../utils/logger';

/**
 * useCFOSnapshot — single-fetch snapshot of the CFO-relevant Firestore
 * collections, with localStorage cache and explicit refresh.
 *
 * IMPORTANT (Firestore quota mitigation):
 *  - Uses getDocs / getDoc, NOT onSnapshot listeners
 *  - bankMovements is filtered to the last 120 days (enough for forecast 13W
 *    + 90d lookback) to keep read counts low
 *  - Snapshot is cached in localStorage under CACHE_KEY for TTL_MS; cache hit
 *    is returned immediately, fetch only happens when expired or refresh()
 *    is called explicitly
 *
 * Return shape:
 *   {
 *     snapshot: {
 *       bankMovements: [],
 *       receivables: [],
 *       payables: [],
 *       projects: [],
 *       costCenters: [],
 *       recurringCosts: [],
 *       employees: [],
 *       budgets: [],
 *       transactions: [],
 *       categories: { expense: [], income: [] },
 *     } | null,
 *     loading: boolean,
 *     error: Error | null,
 *     fetchedAt: ISO string | null,
 *     fromCache: boolean,
 *     refetch: () => Promise<void>,   // forces network read
 *   }
 *
 * The hook does NOT perform any writes and does NOT subscribe to changes —
 * the CFO views are intentionally read-mostly.
 */

export const CFO_SNAPSHOT_CACHE_KEY = 'cfo:snapshot:v2';
export const CFO_SNAPSHOT_TTL_MS = 60 * 60 * 1000; // 1 hour
export const CFO_BANKMOVEMENTS_LOOKBACK_DAYS = 120;

const todayIso = () => new Date().toISOString().slice(0, 10);

const isoDaysAgo = (days) => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
};

const dataPath = (...segments) =>
  collection(db, 'artifacts', appId, 'public', 'data', ...segments);

const settingsDoc = (name) =>
  doc(db, 'artifacts', appId, 'public', 'data', 'settings', name);

const mapDocs = (snapshot) =>
  snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));

const readCache = () => {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  try {
    const raw = window.localStorage.getItem(CFO_SNAPSHOT_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (!parsed.fetchedAt || !parsed.snapshot) return null;
    const fetched = new Date(parsed.fetchedAt).getTime();
    if (!Number.isFinite(fetched)) return null;
    if (Date.now() - fetched > CFO_SNAPSHOT_TTL_MS) return { ...parsed, expired: true };
    return { ...parsed, expired: false };
  } catch (err) {
    logError('useCFOSnapshot: cache read failed', err);
    return null;
  }
};

const writeCache = (snapshot, fetchedAt) => {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(
      CFO_SNAPSHOT_CACHE_KEY,
      JSON.stringify({ snapshot, fetchedAt }),
    );
  } catch (err) {
    // Quota exceeded or storage disabled — non-fatal.
    logError('useCFOSnapshot: cache write failed', err);
  }
};

export const fetchCFOSnapshot = async () => {
  const cutoffDate = isoDaysAgo(CFO_BANKMOVEMENTS_LOOKBACK_DAYS);

  const bankMovementsQuery = query(
    dataPath('bankMovements'),
    where('postedDate', '>=', cutoffDate),
  );

  const [
    bankMovementsSnap,
    receivablesSnap,
    payablesSnap,
    projectsSnap,
    costCentersSnap,
    recurringCostsSnap,
    employeesSnap,
    budgetsSnap,
    transactionsSnap,
    categoriesDocSnap,
    bankAccountDocSnap,
  ] = await Promise.all([
    getDocs(bankMovementsQuery),
    getDocs(dataPath('receivables')),
    getDocs(dataPath('payables')),
    getDocs(dataPath('projects')),
    getDocs(dataPath('costCenters')),
    getDocs(dataPath('recurringCosts')),
    getDocs(dataPath('employees')),
    getDocs(dataPath('budgets')),
    getDocs(dataPath('transactions')),
    getDoc(settingsDoc('categories')),
    getDoc(settingsDoc('bankAccount')),
  ]);

  const categoriesData = categoriesDocSnap.exists() ? categoriesDocSnap.data() : {};
  const bankAccountData = bankAccountDocSnap.exists() ? bankAccountDocSnap.data() : null;

  return {
    bankMovements: mapDocs(bankMovementsSnap),
    receivables: mapDocs(receivablesSnap),
    payables: mapDocs(payablesSnap),
    projects: mapDocs(projectsSnap),
    costCenters: mapDocs(costCentersSnap),
    recurringCosts: mapDocs(recurringCostsSnap),
    employees: mapDocs(employeesSnap),
    budgets: mapDocs(budgetsSnap),
    transactions: mapDocs(transactionsSnap),
    categories: {
      expense: categoriesData.expenseCategories || EXPENSE_CATEGORIES,
      income: categoriesData.incomeCategories || INCOME_CATEGORIES,
    },
    bankAccount: bankAccountData
      ? {
          bankName: bankAccountData.bankName || '',
          balance: Number(bankAccountData.balance) || 0,
          balanceDate: bankAccountData.balanceDate || null,
          creditLineLimit: Number(bankAccountData.creditLineLimit) || 0,
        }
      : null,
    meta: {
      bankMovementsLookbackDays: CFO_BANKMOVEMENTS_LOOKBACK_DAYS,
      bankMovementsCutoffDate: cutoffDate,
      generatedAt: todayIso(),
    },
  };
};

export const useCFOSnapshot = (user) => {
  const hasUser = Boolean(user);
  const [snapshot, setSnapshot] = useState(null);
  const [fetchedAt, setFetchedAt] = useState(null);
  const [fromCache, setFromCache] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Track latest invocation so a stale fetch can't overwrite a fresh one
  const requestIdRef = useRef(0);

  const runFetch = useCallback(async ({ skipCache = false } = {}) => {
    const myId = ++requestIdRef.current;

    if (!skipCache) {
      const cached = readCache();
      if (cached && !cached.expired) {
        if (requestIdRef.current === myId) {
          setSnapshot(cached.snapshot);
          setFetchedAt(cached.fetchedAt);
          setFromCache(true);
          setError(null);
          setLoading(false);
        }
        return;
      }
    }

    setLoading(true);
    setError(null);
    try {
      const data = await fetchCFOSnapshot();
      const ts = new Date().toISOString();
      writeCache(data, ts);
      if (requestIdRef.current === myId) {
        setSnapshot(data);
        setFetchedAt(ts);
        setFromCache(false);
        setLoading(false);
      }
    } catch (err) {
      logError('useCFOSnapshot: fetch failed', err);
      if (requestIdRef.current === myId) {
        setError(err);
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!hasUser) return undefined;

    let active = true;
    Promise.resolve().then(() => {
      if (active) runFetch();
    });

    return () => {
      active = false;
    };
  }, [hasUser, runFetch]);

  const refetch = useCallback(() => runFetch({ skipCache: true }), [runFetch]);

  return {
    snapshot: hasUser ? snapshot : null,
    loading: hasUser ? loading : false,
    error: hasUser ? error : null,
    fetchedAt: hasUser ? fetchedAt : null,
    fromCache: hasUser ? fromCache : false,
    refetch,
  };
};

export default useCFOSnapshot;
