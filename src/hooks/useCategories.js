import { logError } from '../utils/logger';
import { useState, useEffect, useMemo } from 'react';
import {
  doc,
  onSnapshot,
  setDoc,
  serverTimestamp
} from 'firebase/firestore';
import { db, appId } from '../services/firebase';
import {
  CATEGORY_GROUPS,
  EXPENSE_CATEGORY_NAMES,
  INCOME_CATEGORY_NAMES,
  INTERNAL_CATEGORY_NAMES,
  TAXONOMY,
  TAXONOMY_VERSION,
  categoryOptions as buildCategoryOptions,
} from '../finance/taxonomy';

/** The lists as the code taxonomy defines them — the fallback and the seed. */
const CODE_LISTS = Object.freeze({
  expense: [...EXPENSE_CATEGORY_NAMES],
  income: [...INCOME_CATEGORY_NAMES],
  internal: [...INTERNAL_CATEGORY_NAMES],
});

const CATEGORY_OPTIONS = Object.freeze(buildCategoryOptions());

/** A stored list is only trusted when it is a non-empty array of names. */
const listOf = (value, fallback) => {
  if (!Array.isArray(value)) return fallback;
  const names = value.filter((entry) => typeof entry === 'string').map((entry) => entry.trim()).filter(Boolean);
  return names.length > 0 ? names : fallback;
};

/**
 * Category catalogue (settings/categories).
 *
 * The taxonomy in `src/finance/taxonomy.js` is the source of truth. The
 * Firestore document is only honoured when it carries the current
 * `TAXONOMY_VERSION`; a missing document or an older version (the flat,
 * free-form lists that produced the duplicates) falls back to the code
 * taxonomy and is NOT re-seeded from here — the migration script writes the
 * versioned document.
 */
export const useCategories = (user) => {
  const [lists, setLists] = useState(CODE_LISTS);
  const [loading, setLoading] = useState(() => !!user);
  const [error, setError] = useState(null);

  const categoriesDocRef = useMemo(() => doc(db, 'artifacts', appId, 'public', 'data', 'settings', 'categories'), []);

  useEffect(() => {
    if (!user) return;

    const unsubscribe = onSnapshot(
      categoriesDocRef,
      (snapshot) => {
        const data = snapshot.exists() ? snapshot.data() : null;
        if (data && Number(data.version) === TAXONOMY_VERSION) {
          setLists({
            expense: listOf(data.expenseCategories, CODE_LISTS.expense),
            income: listOf(data.incomeCategories, CODE_LISTS.income),
            internal: listOf(data.internalCategories, CODE_LISTS.internal),
          });
        } else {
          setLists(CODE_LISTS);
        }
        setLoading(false);
      },
      (err) => {
        logError("Error loading categories:", err);
        setError(err);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [user, categoriesDocRef]);

  const expenseCategories = lists.expense;
  const incomeCategories = lists.income;
  const internalCategories = lists.internal;

  // Kept for compatibility with older callers. The settings screen is read-only
  // now; anything written here is stamped with the current version so the
  // snapshot above keeps honouring it.
  const saveCategories = async (newExpenseCategories, newIncomeCategories, newInternalCategories = internalCategories) => {
    if (!user) return { success: false, error: 'No user' };

    try {
      await setDoc(categoriesDocRef, {
        version: TAXONOMY_VERSION,
        expenseCategories: newExpenseCategories,
        incomeCategories: newIncomeCategories,
        internalCategories: newInternalCategories,
        updatedAt: serverTimestamp(),
        updatedBy: user.email
      });
      return { success: true };
    } catch (err) {
      logError("Error saving categories:", err);
      return { success: false, error: err };
    }
  };

  const addCategory = async (category, type) => {
    if (!user) return { success: false, error: 'No user' };

    const newExpense = type === 'expense'
      ? [...expenseCategories, category]
      : expenseCategories;
    const newIncome = type === 'income'
      ? [...incomeCategories, category]
      : incomeCategories;

    return saveCategories(newExpense, newIncome);
  };

  const updateCategory = async (oldCategory, newCategory, type) => {
    if (!user) return { success: false, error: 'No user' };

    const newExpense = type === 'expense'
      ? expenseCategories.map(c => c === oldCategory ? newCategory : c)
      : expenseCategories;
    const newIncome = type === 'income'
      ? incomeCategories.map(c => c === oldCategory ? newCategory : c)
      : incomeCategories;

    return saveCategories(newExpense, newIncome);
  };

  const deleteCategory = async (category, type) => {
    if (!user) return { success: false, error: 'No user' };

    const newExpense = type === 'expense'
      ? expenseCategories.filter(c => c !== category)
      : expenseCategories;
    const newIncome = type === 'income'
      ? incomeCategories.filter(c => c !== category)
      : incomeCategories;

    return saveCategories(newExpense, newIncome);
  };

  return {
    expenseCategories,
    incomeCategories,
    internalCategories,
    taxonomy: TAXONOMY,
    groups: CATEGORY_GROUPS,
    categoryOptions: CATEGORY_OPTIONS,
    loading,
    error,
    saveCategories,
    addCategory,
    updateCategory,
    deleteCategory
  };
};

export default useCategories;
