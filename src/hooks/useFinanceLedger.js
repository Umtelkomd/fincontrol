import { useMemo } from 'react';
import { balances2025 } from '../data/balances2025';
import {
  adaptPayableDoc,
  adaptReceivableDoc,
  createLegacyOpeningPayables,
  createLegacyOpeningReceivables,
} from '../finance/adapters';
import { DEFAULT_CURRENCY, MAIN_ACCOUNT_ID, MOVEMENT_STATUS } from '../finance/constants';
import { compareIsoDate, getSignedMovementAmount, sumMoney } from '../finance/utils';
import { useAllTransactions } from './useAllTransactions';
import { useBankAccount } from './useBankAccount';
import { useBankMovements } from './useBankMovements';
import { useBudgets } from './useBudgets';
import { usePayables } from './usePayables';
import { useProjects } from './useProjects';
import { useReceivables } from './useReceivables';

const sortByDueDate = (left, right) => {
  const dueComparison = compareIsoDate(left.dueDate, right.dueDate);
  if (dueComparison !== 0) return dueComparison;
  return (left.counterpartyName || '').localeCompare(right.counterpartyName || '');
};

export const useFinanceLedger = (user) => {
  const { allTransactions, loading: txLoading } = useAllTransactions(user);
  const { bankAccount, loading: accountLoading } = useBankAccount(user);
  const { bankMovements, loading: movementLoading } = useBankMovements(user);
  const { receivables, loading: receivablesLoading } = useReceivables(user);
  const { payables, loading: payablesLoading } = usePayables(user);
  const { budgets, loading: budgetsLoading } = useBudgets(user);
  const { projects, loading: projectsLoading } = useProjects(user);

  return useMemo(() => {
    const loading =
      txLoading ||
      accountLoading ||
      movementLoading ||
      receivablesLoading ||
      payablesLoading ||
      budgetsLoading ||
      projectsLoading;

    const canonicalReceivables = receivables.map((entry) => adaptReceivableDoc(entry, 'receivable'));
    const canonicalPayables = payables.map((entry) => adaptPayableDoc(entry, 'payable'));

    // Cash ledger is DATEV-only: bankMovements is the single source of truth for
    // posted cash movements. The static 2025 P&L sheet (allTransactions) is kept
    // for historical budget/project reporting but must NOT feed the cash ledger —
    // it is a categorized P&L view, not a bank statement, and mixing it would
    // double-count 2025 (DATEV already contains all 966 2025 bank movements).
    const openingReceivables = createLegacyOpeningReceivables();
    const openingPayables = createLegacyOpeningPayables();

    // AR/AP rows: opening anchors + live Firestore canonicals only.
    // Legacy sheet entries are excluded — they were 2025 operational data that has
    // since been superseded by the canonical receivables/payables collections.
    const receivableRows = [...openingReceivables, ...canonicalReceivables].sort(sortByDueDate);
    const payableRows = [...openingPayables, ...canonicalPayables].sort(sortByDueDate);

    // postedMovements = DATEV bank movements only, filtered to POSTED status and
    // sorted chronologically. No legacy sheet entries.
    const postedMovements = bankMovements
      .filter((entry) => entry.status === MOVEMENT_STATUS.POSTED)
      .sort((left, right) => compareIsoDate(left.postedDate, right.postedDate));

    const mainAccount = {
      id: MAIN_ACCOUNT_ID,
      currency: DEFAULT_CURRENCY,
      name: bankAccount?.bankName || 'Cuenta principal',
      openingBalance: Number(bankAccount?.balance ?? balances2025.bancoDic2025),
      openingDate: bankAccount?.balanceDate || '2025-12-31',
      creditLineLimit: Number(bankAccount?.creditLineLimit || 0),
      taxReserveBalance: balances2025.ivaDic2025,
    };

    // currentCash: opening balance (Dec 2025) + all DATEV movements posted after
    // the opening date. Since DATEV covers full 2025 + 2026 and postedMovements is
    // now DATEV-only, movements before or on the opening date are correctly excluded
    // by the compareIsoDate > 0 guard (same as before).
    const currentCash = sumMoney(
      postedMovements.filter(
        (entry) =>
          entry.accountId === MAIN_ACCOUNT_ID && compareIsoDate(entry.postedDate, mainAccount.openingDate) > 0,
      ),
      getSignedMovementAmount,
    ) + mainAccount.openingBalance;

    const currentBalance = Math.round(currentCash * 100) / 100;
    const creditUsed = currentBalance < 0 ? Math.abs(currentBalance) : 0;
    const availableCredit = currentBalance - mainAccount.creditLineLimit;

    return {
      loading,
      // allTransactions (static 2025 P&L sheet) is exposed so consumers that need
      // the classified historical dataset (BudgetVsActual, DrillDown, etc.) can
      // read it. It does NOT feed postedMovements, receivables, or payables.
      allTransactions,
      bankAccount: mainAccount,
      postedMovements,
      bankMovements,
      receivables: receivableRows,
      payables: payableRows,
      budgets,
      projects,
      summary: {
        currentCash: currentBalance,
        creditUsed,
        availableCredit,
        pendingReceivables: receivableRows.reduce((sum, entry) => sum + entry.openAmount, 0),
        pendingPayables: payableRows.reduce((sum, entry) => sum + entry.openAmount, 0),
      },
    };
  }, [
    accountLoading,
    allTransactions,
    bankAccount,
    bankMovements,
    budgets,
    budgetsLoading,
    movementLoading,
    payables,
    payablesLoading,
    projects,
    projectsLoading,
    receivables,
    receivablesLoading,
    txLoading,
  ]);
};

export default useFinanceLedger;
