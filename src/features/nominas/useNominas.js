import { useEffect, useMemo, useState } from 'react';
import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import { db, appId } from '../../services/firebase';
import { logError } from '../../utils/logger';
import { monthLabel, computePayrollTotals, buildPayrollPayables } from './lib/payroll';

const PAYROLL_PERIODS_COLLECTION = 'payrollPeriods';

/**
 * useNominas — hook for payroll period management.
 *
 * Accepts { user, costCenters, createPayable } so callers inject dependencies
 * rather than this hook spawning its own subscriptions for those resources.
 *
 * @param {{ user: object, costCenters: Array, createPayable: Function }} params
 */
export const useNominas = ({ user, costCenters = [], createPayable }) => {
  const [periods, setPeriods] = useState([]);
  const [loading, setLoading] = useState(true);

  const periodsRef = useMemo(
    () => collection(db, 'artifacts', appId, 'public', 'data', PAYROLL_PERIODS_COLLECTION),
    [],
  );

  // Resolve the CC-NOM cost center id from the live list.
  const nomCostCenterId = useMemo(() => {
    const cc = costCenters.find((c) => c.code === 'CC-NOM');
    return cc?.id || '';
  }, [costCenters]);

  useEffect(() => {
    if (!user) return undefined;

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
            status: raw.status || 'loaded',
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
            createdBy: raw.createdBy || '',
            createdAt: raw.createdAt?.toDate?.()?.toISOString() || null,
            updatedAt: raw.updatedAt?.toDate?.()?.toISOString() || null,
            auditTrail: Array.isArray(raw.auditTrail) ? raw.auditTrail : [],
          };
        });
        setPeriods(data);
        setLoading(false);
      },
      (err) => {
        logError('Error loading payroll periods:', err);
        setLoading(false);
      },
    );

    return () => unsubscribe();
  }, [periodsRef, user]);

  /**
   * Load a payroll period:
   * 1. Creates the payrollPeriods doc.
   * 2. Creates the 6 payable obligations via createPayable.
   * 3. Writes the obligations references back to the period doc.
   *
   * @param {{
   *   period: string,           // 'YYYY-MM'
   *   krankenkassen: Array<{payee: string, amount: number, dueDate?: string}>,
   *   tax: {amount: number, payee?: string, dueDate?: string},
   *   netWages: {amount: number, dueDate?: string},
   *   lines: Array<{employeeId: string, name: string, netto: number, brutto: number, gesamtkosten: number}>
   * }} formData
   */
  const loadPayrollPeriod = async (formData) => {
    if (!user) return { success: false, error: new Error('No user') };
    if (!createPayable) return { success: false, error: new Error('createPayable not injected') };

    try {
      const { period, krankenkassen, tax, netWages, lines } = formData;
      const label = monthLabel(period);

      const totals = computePayrollTotals({ krankenkassen, tax, netWages, lines });

      // Step 1 — create the payroll period document
      const periodPayload = {
        period,
        label,
        status: 'loaded',
        netWagesTotal: totals.netWagesTotal,
        socialTotal: totals.socialTotal,
        taxTotal: totals.taxTotal,
        cashTotal: totals.cashTotal,
        employerCostTotal: totals.employerCostTotal,
        employeeCount: totals.employeeCount,
        payCount: totals.payCount,
        // Sanitized per-employee snapshot (plain objects only — no Firestore types)
        lines: lines.map((l) => ({
          employeeId: l.employeeId || '',
          name: l.name || '',
          netto: Number(l.netto) || 0,
          brutto: Number(l.brutto) || 0,
          gesamtkosten: Number(l.gesamtkosten) || 0,
        })),
        obligations: [],   // filled in step 3
        documents: [],     // Phase 2
        createdBy: user.email || '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        auditTrail: [
          {
            action: 'create',
            user: user.email || '',
            timestamp: new Date().toISOString(),
            detail: `Nómina ${label} cargada`,
          },
        ],
      };

      const periodDocRef = await addDoc(periodsRef, periodPayload);
      const periodId = periodDocRef.id;

      // Step 2 — build and create the 6 payable payloads
      const payablePayloads = buildPayrollPayables({
        period,
        periodId,
        label,
        costCenterId: nomCostCenterId,
        krankenkassen,
        tax,
        netWages,
      });

      const obligations = [];
      for (const payload of payablePayloads) {
         
        const result = await createPayable({
          ...payload,
          issueDate: new Date().toISOString().slice(0, 10),
        });

        if (!result?.success) {
          logError('Failed to create payroll payable', payload);
        }

        obligations.push({
          kind: payload.payrollKind,
          payee: payload.vendor,
          amount: payload.amount,
          dueDate: payload.dueDate || null,
          // payableId will be available once createPayable returns an id.
          // usePayables.createPayable currently does not return the doc id,
          // so we store what we have and rely on payrollPeriodId matching.
          payableId: result?.id || null,
        });
      }

      // Step 3 — write obligations references back to the period doc
      const periodRef = doc(db, 'artifacts', appId, 'public', 'data', PAYROLL_PERIODS_COLLECTION, periodId);
      await updateDoc(periodRef, {
        obligations,
        updatedAt: serverTimestamp(),
      });

      return { success: true, id: periodId };
    } catch (err) {
      logError('Error loading payroll period:', err);
      return { success: false, error: err };
    }
  };

  return {
    periods,
    loading,
    loadPayrollPeriod,
    nomCostCenterId,
  };
};

export default useNominas;
