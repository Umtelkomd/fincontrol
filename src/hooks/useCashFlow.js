import { useMemo } from 'react';
import { useAllTransactions } from './useAllTransactions';
import { FINANCIAL_CONSTANTS } from '../constants/config';
import { OPERATIONAL_DATA_START } from '../finance/constants';

// Last year-month of the static 2025 dataset: one month before OPERATIONAL_DATA_START.
// Anything with ym <= STATIC_DATA_LAST_YM is static 2025 data.
const _epochDate = new Date(OPERATIONAL_DATA_START);
_epochDate.setMonth(_epochDate.getMonth() - 1);
const STATIC_DATA_LAST_YM = `${_epochDate.getFullYear()}-${String(_epochDate.getMonth() + 1).padStart(2, '0')}`;

// Categories excluded from Operating CF
const FINANCING_CATEGORIES = ['EGR-FIN', 'Intereses', 'Financiero'];
const ARREARS_CATEGORIES = ['EGR-ARR', 'Alquiler vehiculo', 'Cuotas vehiculos'];
const CAPEX_CATEGORIES = ['EGR-EQP', 'Equipos'];

const TOTAL_CASH_DEC2025 = FINANCIAL_CONSTANTS.INITIAL_BANK_BALANCE + FINANCIAL_CONSTANTS.IVA_BALANCE_DEC2025;

const MONTH_NAMES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const toLabel = (ym) => {
  const [year, month] = ym.split('-');
  return `${MONTH_NAMES[parseInt(month) - 1]} ${year}`;
};

/**
 * useCashFlow — uses allTransactions (2025 static + 2026 Firebase).
 * Anchors cumulative balance so end of Dec 2025 = €35,782.94 (bank + IVA).
 */
export const useCashFlow = (user) => {
  const { allTransactions, loading } = useAllTransactions(user);

  const result = useMemo(() => {
    if (loading) {
      return { monthlyData: [], kpis: {}, fcfData: [], projectionData: [], allMonths: [] };
    }

    // Build monthly buckets from ALL transactions
    const buckets = {};
    allTransactions.forEach((t) => {
      const ym = t.date?.substring(0, 7);
      if (!ym) return;
      if (!buckets[ym]) {
        buckets[ym] = { month: ym, label: toLabel(ym), ingresos: 0, egresos: 0, opIncome: 0, opExpense: 0, capex: 0 };
      }
      const b = buckets[ym];
      if (t.type === 'income') {
        b.ingresos += t.amount;
        b.opIncome += t.amount;
      } else {
        b.egresos += t.amount;
        const cat = t.category || '';
        const isFinancing = FINANCING_CATEGORIES.some(c => cat.includes(c));
        const isArrears = ARREARS_CATEGORIES.some(c => cat.includes(c));
        const isCapex = CAPEX_CATEGORIES.some(c => cat.includes(c));
        if (isCapex) {
          b.capex += t.amount;
        } else if (!isFinancing && !isArrears) {
          b.opExpense += t.amount;
        }
      }
    });

    const sortedMonths = Object.keys(buckets).sort();

    // Calculate cumulative net through Dec 2025
    let netThruDec2025 = 0;
    sortedMonths.forEach(ym => {
      if (ym <= STATIC_DATA_LAST_YM) {
        netThruDec2025 += buckets[ym].ingresos - buckets[ym].egresos;
      }
    });

    // Offset: we know that at end of Dec 2025, actual cash = €35,782.94
    // So starting balance (before Oct 2025) = TOTAL_CASH_DEC2025 - netThruDec2025
    const startingBalance = TOTAL_CASH_DEC2025 - netThruDec2025;

    // Now compute cumulative from the beginning
    let accumulated = startingBalance;
    sortedMonths.forEach(ym => {
      const b = buckets[ym];
      b.neto = b.ingresos - b.egresos;
      accumulated += b.neto;
      b.acumulado = accumulated;
      b.opCF = b.opIncome - b.opExpense;
      b.fcf = b.opCF - b.capex;
      b.fcfMargin = b.ingresos > 0 ? (b.fcf / b.ingresos * 100) : 0;
    });

    // Display from Oct 2025
    const displayMonths = sortedMonths.filter(ym => ym >= '2025-10');
    const monthlyData = displayMonths.map(ym => buckets[ym]);

    // KPIs
    let totalIngresos = 0, totalEgresos = 0, totalFCF = 0;
    sortedMonths.forEach(ym => {
      totalIngresos += buckets[ym].ingresos;
      totalEgresos += buckets[ym].egresos;
      totalFCF += buckets[ym].fcf;
    });

    const latestBalance = sortedMonths.length > 0 
      ? buckets[sortedMonths[sortedMonths.length - 1]].acumulado 
      : TOTAL_CASH_DEC2025;

    // Burn rate = avg monthly egresos (last 3 months with data)
    const recentMonths = displayMonths.slice(-3);
    const burnRate = recentMonths.length > 0
      ? recentMonths.reduce((s, ym) => s + buckets[ym].egresos, 0) / recentMonths.length
      : 0;

    // Runway = current balance / monthly burn
    const runway = burnRate > 0 ? latestBalance / burnRate : 99;

    const kpis = {
      totalIngresos,
      totalEgresos,
      flujoNeto: totalIngresos - totalEgresos,
      balance: latestBalance,
      fcf: totalFCF,
      burnRate,
      runway,
      bankDec2025: FINANCIAL_CONSTANTS.INITIAL_BANK_BALANCE,
      ivaDec2025: FINANCIAL_CONSTANTS.IVA_BALANCE_DEC2025,
      startingBalance,
    };

    // FCF data
    const fcfData = monthlyData.map(b => ({ ...b }));

    // 3-month projection
    const last3 = monthlyData.slice(-3);
    const avgIng = last3.reduce((s, b) => s + b.ingresos, 0) / (last3.length || 1);
    const avgEgr = last3.reduce((s, b) => s + b.egresos, 0) / (last3.length || 1);

    const lastMonth = sortedMonths[sortedMonths.length - 1] || '2026-02';
    let [y, m] = lastMonth.split('-').map(Number);
    let runBal = latestBalance;
    const projectionData = [];
    for (let i = 0; i < 3; i++) {
      m += 1;
      if (m > 12) { m = 1; y += 1; }
      const ym = `${y}-${String(m).padStart(2, '0')}`;
      runBal += avgIng - avgEgr;
      projectionData.push({
        month: ym, label: toLabel(ym),
        ingresos: avgIng, egresos: avgEgr,
        neto: avgIng - avgEgr, acumulado: runBal,
        isProjection: true,
      });
    }

    const allMonths = [...monthlyData, ...projectionData];

    return { monthlyData, kpis, fcfData, projectionData, allMonths };
  }, [allTransactions, loading]);

  return { loading, ...result };
};
