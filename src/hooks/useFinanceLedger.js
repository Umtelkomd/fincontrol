import { useMemo } from 'react';
import { balances2025 } from '../data/balances2025';
import { adaptPayableDoc, adaptReceivableDoc } from '../finance/adapters';
import { resolveCashSource } from '../finance/cashSource';
import { DEFAULT_CURRENCY, LEDGER_OPENING_DATE, MAIN_ACCOUNT_ID, MOVEMENT_STATUS } from '../finance/constants';
import { compareIsoDate, getSignedMovementAmount, sumMoney } from '../finance/utils';
import { useAllTransactions } from './useAllTransactions';
import { useBankAccount } from './useBankAccount';
import { useBankMovements } from './useBankMovements';
import { useBudgets } from './useBudgets';
import { usePayables } from './usePayables';
import { useProjects } from './useProjects';
import { useReceivables } from './useReceivables';
import { useReconciliation } from './useReconciliation';

const sortByDueDate = (left, right) => {
  const dueComparison = compareIsoDate(left.dueDate, right.dueDate);
  if (dueComparison !== 0) return dueComparison;
  return (left.counterpartyName || '').localeCompare(right.counterpartyName || '');
};

export const useFinanceLedger = (user) => {
  const { allTransactions, loading: txLoading, error: txError } = useAllTransactions(user);
  const { bankAccount, loading: accountLoading, error: accountError } = useBankAccount(user);
  const { bankMovements, loading: movementLoading, error: movementError } = useBankMovements(user);
  const { receivables, loading: receivablesLoading, error: receivablesError } = useReceivables(user);
  const { payables, loading: payablesLoading, error: payablesError } = usePayables(user);
  const { budgets, loading: budgetsLoading, error: budgetsError } = useBudgets(user);
  const { projects, loading: projectsLoading, error: projectsError } = useProjects(user);
  const { anchors, loading: anchorsLoading } = useReconciliation(user);

  return useMemo(() => {
    const loading =
      txLoading ||
      accountLoading ||
      movementLoading ||
      receivablesLoading ||
      payablesLoading ||
      budgetsLoading ||
      projectsLoading ||
      anchorsLoading;

    // A failed source must never render as "€0, everything fine". Consumers check
    // `error` (first failure) or `sourceErrors` (per-collection detail) and show a
    // partial-data warning instead of presenting incomplete figures as real.
    const sourceErrors = {
      transactions: txError || null,
      bankAccount: accountError || null,
      bankMovements: movementError || null,
      receivables: receivablesError || null,
      payables: payablesError || null,
      budgets: budgetsError || null,
      projects: projectsError || null,
    };
    const error =
      movementError || accountError || receivablesError || payablesError ||
      txError || budgetsError || projectsError || null;

    const canonicalReceivables = receivables.map((entry) => adaptReceivableDoc(entry, 'receivable'));
    const canonicalPayables = payables.map((entry) => adaptPayableDoc(entry, 'payable'));

    // Cash ledger is DATEV-only: bankMovements is the single source of truth for
    // posted cash movements. The static 2025 P&L sheet (allTransactions) is kept
    // for historical budget/project reporting but must NOT feed the cash ledger —
    // it is a categorized P&L view, not a bank statement, and mixing it would
    // double-count 2025 (DATEV already contains all 966 2025 bank movements).
    // AR/AP rows: live Firestore canonicals only — synthetic legacy openings were
    // retired with the anchors model (treasury-anchors PR).
    const receivableRows = [...canonicalReceivables].sort(sortByDueDate);
    const payableRows = [...canonicalPayables].sort(sortByDueDate);
    const postedMovements = bankMovements
      .filter((entry) => entry.status === MOVEMENT_STATUS.POSTED)
      .sort((left, right) => compareIsoDate(left.postedDate, right.postedDate));

    const mainAccount = {
      id: MAIN_ACCOUNT_ID,
      currency: DEFAULT_CURRENCY,
      name: bankAccount?.bankName || 'Cuenta principal',
      openingBalance: Number(bankAccount?.balance ?? balances2025.bancoDic2025),
      openingDate: bankAccount?.balanceDate || LEDGER_OPENING_DATE,
      creditLineLimit: Number(bankAccount?.creditLineLimit || 0),
      taxReserveBalance: balances2025.ivaDic2025,
    };

    // Legacy formula kept byte-identical: it is the fallback until a
    // reconciliation anchor exists (see resolveCashSource).
    const legacyCash = sumMoney(
      postedMovements.filter(
        (entry) =>
          entry.accountId === MAIN_ACCOUNT_ID && compareIsoDate(entry.postedDate, mainAccount.openingDate) > 0,
      ),
      getSignedMovementAmount,
    ) + mainAccount.openingBalance;

    const todayIso = new Date().toISOString().slice(0, 10);
    const mainAccountMovements = postedMovements.filter(
      (entry) => entry.accountId === MAIN_ACCOUNT_ID,
    );
    const { currentCash, source: cashSource, cashMeta } = resolveCashSource({
      anchors,
      movements: mainAccountMovements,
      today: todayIso,
      legacyBalance: legacyCash,
    });

    const currentBalance = currentCash;
    const creditUsed = currentBalance < 0 ? Math.abs(currentBalance) : 0;
    const availableCredit = currentBalance - mainAccount.creditLineLimit;

    return {
      loading,
      error,
      sourceErrors,
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
      anchors,
      cashSource,
      cashMeta,
      summary: {
        currentCash: currentBalance,
        creditUsed,
        availableCredit,
        pendingReceivables: receivableRows.reduce((sum, entry) => sum + entry.openAmount, 0),
        pendingPayables: payableRows.reduce((sum, entry) => sum + entry.openAmount, 0),
      },
    };
  }, [
    accountError,
    accountLoading,
    bankAccount,
    bankMovements,
    anchors,
    anchorsLoading,
    budgets,
    budgetsError,
    budgetsLoading,
    movementError,
    movementLoading,
    payables,
    payablesError,
    payablesLoading,
    projects,
    projectsError,
    projectsLoading,
    receivables,
    receivablesError,
    receivablesLoading,
    txError,
    txLoading,
    allTransactions,
  ]);
};

export default useFinanceLedger;
