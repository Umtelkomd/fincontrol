import { useMemo } from 'react';
import { balances2025 } from '../data/balances2025';
import { adaptPayableDoc, adaptReceivableDoc } from '../finance/adapters';
import { resolveCashSource } from '../finance/cashSource';
import { DEFAULT_CURRENCY, MAIN_ACCOUNT_ID, MOVEMENT_STATUS } from '../finance/constants';
import { compareIsoDate, getSignedMovementAmount, sumMoney } from '../finance/utils';
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
  const { bankAccount, loading: accountLoading } = useBankAccount(user);
  const { bankMovements, loading: movementLoading } = useBankMovements(user);
  const { receivables, loading: receivablesLoading } = useReceivables(user);
  const { payables, loading: payablesLoading } = usePayables(user);
  const { budgets, loading: budgetsLoading } = useBudgets(user);
  const { projects, loading: projectsLoading } = useProjects(user);
  const { anchors, loading: anchorsLoading } = useReconciliation(user);

  return useMemo(() => {
    const loading =
      accountLoading ||
      movementLoading ||
      receivablesLoading ||
      payablesLoading ||
      budgetsLoading ||
      projectsLoading ||
      anchorsLoading;

    const canonicalReceivables = receivables.map((entry) => adaptReceivableDoc(entry, 'receivable'));
    const canonicalPayables = payables.map((entry) => adaptPayableDoc(entry, 'payable'));

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
      openingDate: bankAccount?.balanceDate || '2025-12-31',
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
    accountLoading,
    bankAccount,
    bankMovements,
    anchors,
    anchorsLoading,
    budgets,
    budgetsLoading,
    movementLoading,
    payables,
    payablesLoading,
    projects,
    projectsLoading,
    receivables,
    receivablesLoading,
  ]);
};

export default useFinanceLedger;
