import { logError } from '../utils/logger';
import { useState, useEffect, useMemo } from 'react';
import {
  collection, query, onSnapshot, addDoc, updateDoc, deleteDoc, doc,
  serverTimestamp, orderBy, getDocs, where
} from 'firebase/firestore';
import { db, appId } from '../services/firebase';

// Generate a simple unique ID without external dependencies
const generateLineId = () => `line-${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 9)}`;

// Migrate old budget format to new lines format
const migrateBudgetLines = (budget) => {
  // If already has lines array, return as-is
  if (Array.isArray(budget.lines) && budget.lines.length > 0) {
    return budget;
  }

  // Migrate old incomeTarget/expenseLimit format to lines
  const lines = [];

  if (budget.incomeTarget > 0) {
    // Create an income line with monthly breakdown
    // For simplicity, distribute evenly across all months that have passed
    const monthlyAmount = budget.incomeTarget / 12;
    lines.push({
      id: generateLineId(),
      categoryId: 'income',
      categoryName: 'Ingresos',
      type: 'income',
      monthlyBudget: Array(12).fill(monthlyAmount),
      notes: 'Presupuesto migrado',
    });
  }

  if (budget.expenseLimit > 0) {
    const monthlyAmount = budget.expenseLimit / 12;
    lines.push({
      id: generateLineId(),
      categoryId: 'expense',
      categoryName: 'Gastos',
      type: 'expense',
      monthlyBudget: Array(12).fill(monthlyAmount),
      notes: 'Presupuesto migrado',
    });
  }

  return { ...budget, lines };
};

export const useBudgets = (user) => {
  const [budgets, setBudgets] = useState([]);
  const [loading, setLoading] = useState(() => !!user);

  const colRef = useMemo(() => collection(db, 'artifacts', appId, 'public', 'data', 'budgets'), []);

  useEffect(() => {
    if (!user) return;

    const q = query(colRef, orderBy('year', 'desc'));
    const unsub = onSnapshot(q, (snap) => {
      const data = snap.docs.map(d => {
        const raw = d.data();
        const migrated = migrateBudgetLines(raw);
        return {
          id: d.id,
          ...migrated,
          createdAt: raw.createdAt?.toDate?.() ? raw.createdAt.toDate().toISOString() : raw.createdAt,
        };
      });
      setBudgets(data);
      setLoading(false);
    }, (err) => {
      logError('Error loading budgets:', err);
      setLoading(false);
    });

    return () => unsub();
  }, [user]);

  // Create a new budget document with the new lines-based schema
  const createBudget = async (data) => {
    if (!user) return { success: false };
    try {
      const newBudget = {
        projectId: data.projectId || null,
        projectName: data.projectName || 'Empresa',
        year: parseInt(data.year),
        lines: data.lines || [],
        createdBy: user.email,
        createdAt: serverTimestamp(),
      };
      const docRef = await addDoc(colRef, newBudget);
      return { success: true, id: docRef.id };
    } catch (error) {
      logError('Error creating budget:', error);
      return { success: false, error };
    }
  };

  // Update an entire budget document
  const updateBudget = async (budgetId, data) => {
    if (!user) return { success: false };
    try {
      const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'budgets', budgetId);
      await updateDoc(docRef, {
        ...data,
        updatedBy: user.email,
        updatedAt: serverTimestamp(),
      });
      return { success: true };
    } catch (error) {
      logError('Error updating budget:', error);
      return { success: false, error };
    }
  };

  // Add or update a single budget line
  const upsertBudgetLine = async (budgetId, line) => {
    if (!user) return { success: false };
    try {
      const budget = budgets.find(b => b.id === budgetId);
      if (!budget) return { success: false, error: 'Budget not found' };

      const existingLines = budget.lines || [];
      const lineId = line.id || generateLineId();

      const existingIndex = existingLines.findIndex(l => l.id === lineId);
      const updatedLines = existingIndex >= 0
        ? existingLines.map((l, i) => i === existingIndex ? { ...l, ...line, id: lineId } : l)
        : [...existingLines, { ...line, id: lineId }];

      const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'budgets', budgetId);
      await updateDoc(docRef, {
        lines: updatedLines,
        updatedBy: user.email,
        updatedAt: serverTimestamp(),
      });
      return { success: true, lineId };
    } catch (error) {
      logError('Error upserting budget line:', error);
      return { success: false, error };
    }
  };

  // Delete a budget line
  const deleteBudgetLine = async (budgetId, lineId) => {
    if (!user) return { success: false };
    try {
      const budget = budgets.find(b => b.id === budgetId);
      if (!budget) return { success: false, error: 'Budget not found' };

      const updatedLines = (budget.lines || []).filter(l => l.id !== lineId);

      const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'budgets', budgetId);
      await updateDoc(docRef, {
        lines: updatedLines,
        updatedBy: user.email,
        updatedAt: serverTimestamp(),
      });
      return { success: true };
    } catch (error) {
      logError('Error deleting budget line:', error);
      return { success: false, error };
    }
  };

  // Get budget for a specific year and project (company-wide if projectId is null)
  const getBudgetForYear = (year, projectId) => {
    return budgets.find(b =>
      Number(b.year) === Number(year) &&
      (b.projectId || null) === (projectId || null)
    );
  };

  // Get all budgets for a year (all projects + company-wide)
  const getBudgetsForYear = (year) => {
    return budgets.filter(b => Number(b.year) === Number(year));
  };

  // Delete entire budget document
  const deleteBudget = async (budgetId) => {
    if (!user) return { success: false };
    try {
      const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'budgets', budgetId);
      await deleteDoc(docRef);
      return { success: true };
    } catch (error) {
      logError('Error deleting budget:', error);
      return { success: false, error };
    }
  };

  // Import budget lines from another year (copy template)
  const importBudgetLines = async (fromYear, toYear, projectId, options = {}) => {
    if (!user) return { success: false };
    try {
      // Find the source budget for this project/year
      const sourceBudget = budgets.find(b =>
        Number(b.year) === Number(fromYear) &&
        (b.projectId || null) === (projectId || null)
      );

      if (!sourceBudget || !sourceBudget.lines?.length) {
        return { success: false, error: 'No source budget found to import from' };
      }

      // Check if target already exists
      let targetBudget = budgets.find(b =>
        Number(b.year) === Number(toYear) &&
        (b.projectId || null) === (projectId || null)
      );

      const newLines = sourceBudget.lines.map(line => ({
        ...line,
        id: generateLineId(),
        notes: options.includeNotes ? line.notes : '',
      }));

      if (targetBudget) {
        // Update existing budget with new lines
        const mergedLines = options.replaceExisting
          ? newLines
          : [...(targetBudget.lines || []), ...newLines];

        const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'budgets', targetBudget.id);
        await updateDoc(docRef, {
          lines: mergedLines,
          updatedBy: user.email,
          updatedAt: serverTimestamp(),
        });
        return { success: true, budgetId: targetBudget.id, importedLines: newLines.length };
      } else {
        // Create new budget
        const newBudget = {
          projectId: projectId || null,
          projectName: projectId
            ? (budgets.find(b => b.projectId === projectId)?.projectName || 'Proyecto')
            : 'Empresa',
          year: parseInt(toYear),
          lines: newLines,
          createdBy: user.email,
          createdAt: serverTimestamp(),
        };
        const docRef = await addDoc(colRef, newBudget);
        return { success: true, budgetId: docRef.id, importedLines: newLines.length };
      }
    } catch (error) {
      logError('Error importing budget lines:', error);
      return { success: false, error };
    }
  };

  return {
    budgets,
    loading,
    createBudget,
    updateBudget,
    upsertBudgetLine,
    deleteBudgetLine,
    getBudgetForYear,
    getBudgetsForYear,
    deleteBudget,
    importBudgetLines,
  };
};

export default useBudgets;
