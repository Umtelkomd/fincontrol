import { useMemo } from 'react';
import { buildCashForecast } from '../finance/cashForecast';
import { TREASURY_PROJECTION_WEEKS } from '../finance/constants';
import { usePayrollPeriods } from '../features/nominas/usePayrollPeriods';
import { useAuth } from './useAuth';
import { useFinanceLedger } from './useFinanceLedger';
import { useRecurringCosts } from './useRecurringCosts';
import { useTreasurySettings } from './useTreasurySettings';
import { useVatRates } from './useVatRates';

/**
 * useCashForecast — the ONE cash-flow projection subscription.
 *
 * Thin wrapper over the pure `buildCashForecast`. Every screen showing a
 * forward cash figure uses this hook, which guarantees the two things that
 * were broken before:
 *
 *   1. ONE day zero. The start balance is always the anchor-derived cash
 *      (`ledger.summary.currentCash`), never the stale static
 *      `bankAccount.balance`. Callers cannot override it — that is deliberate.
 *   2. ONE set of assumptions. Collection slip, obligations and horizon come
 *      from the engine, not from each screen.
 *
 * Pass `ledger: useFinanceLedgerContext()` to reuse the shared Firestore
 * listeners (same convention as `useTreasuryMetrics`); without it the hook
 * opens its own ledger instance.
 *
 * `ledger.receivables` is handed over WHOLE — settled invoices included — on
 * purpose: they are the collection history the engine measures the slip from.
 * Filtering them out here would silently drop the forecast back to the
 * hardcoded default.
 *
 * `options.collectionSlipDays` exists for sensitivity analysis only. Leave it
 * unset to get the slip measured from that history (and the honest
 * `collectionSlip.confidence` that goes with it).
 *
 * @param {Object|null} user
 * @param {{
 *   ledger?: Object,
 *   weeks?: number,
 *   today?: string,
 *   collectionSlipDays?: number,
 * }} [options]
 */
export const useCashForecast = (user, options = {}) => {
  const { weeks = TREASURY_PROJECTION_WEEKS, today, collectionSlipDays } = options;

  const { hasPermission } = useAuth();
  // firestore.rules confines payrollPeriods to manager/admin; editors must not
  // even subscribe (same gating convention as Resumen's payroll allocation).
  const canSeePayroll = hasPermission('cxp');

  // Accept a pre-fetched ledger from FinanceLedgerContext to avoid opening a
  // duplicate set of Firestore listeners.
  const localLedger = useFinanceLedger(options.ledger ? null : user);
  const ledger = options.ledger ?? localLedger;

  const { recurringCosts } = useRecurringCosts(user);
  const { periods: payrollPeriods } = usePayrollPeriods(canSeePayroll ? user : null);
  const { vatEstimates } = useTreasurySettings(user);
  // VAT per category (settings/vatRates) turns the posted movements into the
  // derived Umsatzsteuer the manual estimates almost never cover.
  const { categoryRates } = useVatRates(user);

  return useMemo(() => {
    const todayIso = today || new Date().toISOString().slice(0, 10);

    const forecast = buildCashForecast({
      startBalance: ledger.summary?.currentCash ?? 0,
      today: todayIso,
      weeks,
      receivables: ledger.receivables || [],
      payables: ledger.payables || [],
      recurringCosts: recurringCosts || [],
      payrollPeriods: payrollPeriods || [],
      vatEstimates: vatEstimates || [],
      movements: ledger.postedMovements || [],
      categoryRates: categoryRates || {},
      ...(collectionSlipDays === undefined ? {} : { collectionSlipDays }),
    });

    return {
      ...forecast,
      today: todayIso,
      loading: ledger.loading,
      error: ledger.error,
    };
  }, [
    categoryRates,
    collectionSlipDays,
    ledger,
    payrollPeriods,
    recurringCosts,
    today,
    vatEstimates,
    weeks,
  ]);
};

export default useCashForecast;
