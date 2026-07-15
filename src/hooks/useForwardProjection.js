import { useMemo } from 'react';
import { buildCompanyObligations } from '../finance/companyObligations';
import { buildForwardProjection } from '../finance/forwardProjection';
import { usePayrollPeriods } from '../features/nominas/usePayrollPeriods';
import { useAuth } from './useAuth';
import { useBankAccount } from './useBankAccount';
import { usePayables } from './usePayables';
import { useReceivables } from './useReceivables';
import { useRecurringCosts } from './useRecurringCosts';
import { useTreasurySettings } from './useTreasurySettings';

/**
 * useForwardProjection — projects cashflow N days into the future.
 *
 * Thin subscription wrapper over the pure `buildForwardProjection`:
 *   - Open receivables (CXC) → expected inflows by dueDate
 *   - Open payables (CXP) → expected outflows by dueDate
 *   - Active recurringCosts → expected outflows for upcoming months
 *   - Estimated fiscal obligations (nómina/SV/Lohnsteuer/IVA) from
 *     `buildCompanyObligations` — months with an imported payroll period rely
 *     on their materialized payables instead of estimates.
 *
 * `options.startingBalance` lets callers inject the reconciled cash position
 * (ledger-derived). Without it the legacy static balance is used, matching
 * the pre-anchors behavior.
 */
export const useForwardProjection = (user, horizonDays = 90, options = {}) => {
  const { hasPermission } = useAuth();
  // firestore.rules confines payrollPeriods to manager/admin; editors must not
  // even subscribe (same gating convention as Resumen's payroll allocation).
  const canSeePayroll = hasPermission('cxp');
  const { recurringCosts } = useRecurringCosts(user);
  const { payables } = usePayables(user);
  const { receivables } = useReceivables(user);
  const { bankAccount } = useBankAccount(user);
  const { periods: payrollPeriods } = usePayrollPeriods(canSeePayroll ? user : null);
  const { vatEstimates } = useTreasurySettings(user);
  const startingBalanceOverride = options.startingBalance;

  return useMemo(() => {
    const todayIso = new Date().toISOString().slice(0, 10);

    const obligations = buildCompanyObligations({
      payables: payables || [],
      payrollPeriods: payrollPeriods || [],
      vatEstimates: vatEstimates || [],
      today: todayIso,
      horizonDays,
    });

    const startingBalance = Number.isFinite(Number(startingBalanceOverride))
      ? Number(startingBalanceOverride)
      : Number(bankAccount?.balance) || 0;

    return {
      ...buildForwardProjection({
        startingBalance,
        today: todayIso,
        horizonDays,
        receivables: receivables || [],
        payables: payables || [],
        recurringCosts: recurringCosts || [],
        obligations,
      }),
      obligations,
    };
  }, [
    bankAccount,
    horizonDays,
    payables,
    payrollPeriods,
    receivables,
    recurringCosts,
    startingBalanceOverride,
    vatEstimates,
  ]);
};

export default useForwardProjection;
