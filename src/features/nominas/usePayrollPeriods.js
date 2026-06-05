import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db, appId } from '../../services/firebase';
import { logError } from '../../utils/logger';

const PAYROLL_PERIODS_COLLECTION = 'payrollPeriods';

/**
 * usePayrollPeriods — read-only payroll-periods subscription.
 *
 * A thin slice of useNominas (no payable orchestration, no employee/cost-center
 * dependencies) for consumers that only need to READ periods: ProyectoDashboard
 * labor allocation (Phase 3, item 3) and BudgetVsActual Salarios actuals (item 4).
 *
 * Maps each doc with the same sanitizer-safe defaults useNominas uses so the
 * shape stays identical across readers.
 *
 * @param {object} user
 * @returns {{ periods: Array, loading: boolean }}
 */
export const usePayrollPeriods = (user) => {
  const [periods, setPeriods] = useState([]);
  const [loading, setLoading] = useState(true);

  const periodsRef = useMemo(
    () => collection(db, 'artifacts', appId, 'public', 'data', PAYROLL_PERIODS_COLLECTION),
    [],
  );

  useEffect(() => {
    if (!user) {
      setPeriods([]);
      setLoading(false);
      return undefined;
    }

    const q = query(periodsRef, orderBy('period', 'desc'));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const data = snapshot.docs.map((d) => {
          const raw = d.data();
          return {
            id: d.id,
            period: raw.period || '',
            label: raw.label || '',
            status: raw.status === 'loaded' ? 'cargada' : raw.status || 'cargada',
            netWagesTotal: Number(raw.netWagesTotal) || 0,
            socialTotal: Number(raw.socialTotal) || 0,
            taxTotal: Number(raw.taxTotal) || 0,
            cashTotal: Number(raw.cashTotal) || 0,
            employerCostTotal: Number(raw.employerCostTotal) || 0,
            employeeCount: Number(raw.employeeCount) || 0,
            payCount: Number(raw.payCount) || 0,
            lines: Array.isArray(raw.lines) ? raw.lines : [],
            obligations: Array.isArray(raw.obligations) ? raw.obligations : [],
            documents: Array.isArray(raw.documents) ? raw.documents : [],
          };
        });
        setPeriods(data);
        setLoading(false);
      },
      (err) => {
        logError('Error loading payroll periods (read-only):', err);
        setLoading(false);
      },
    );

    return () => unsubscribe();
  }, [periodsRef, user]);

  return { periods, loading };
};

export default usePayrollPeriods;
