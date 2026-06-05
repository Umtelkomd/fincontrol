import { useEffect, useMemo, useRef, useState } from 'react';
import {
  addDoc,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import { db, appId } from '../../services/firebase';
import { logError } from '../../utils/logger';
import { writeAuditLogEntry } from '../../utils/auditLog';
import {
  monthLabel,
  computePayrollTotals,
  buildPayrollPayables,
  findDuplicatePeriod,
  buildPayrollAuditEntry,
} from './lib/payroll';
import { resolveEmployeeIdsByPersNr } from './lib/payrollIdentity';
import { buildDueReminders } from './lib/payrollReminders';

const PAYROLL_PERIODS_COLLECTION = 'payrollPeriods';

const todayIso = () => new Date().toISOString().slice(0, 10);

const periodPath = (periodId) =>
  doc(db, 'artifacts', appId, 'public', 'data', PAYROLL_PERIODS_COLLECTION, periodId);

/**
 * useNominas — hook for payroll period management (the thin Firestore orchestrator).
 *
 * Callers inject every external dependency:
 *   - createPayable / cancelPayable / payables  (from usePayables)
 *   - employees                                  (from useEmployees)
 *   - costCenters                                (from useCostCenters)
 *
 * @param {{
 *   user: object,
 *   costCenters?: Array,
 *   createPayable: Function,
 *   cancelPayable?: Function,
 *   payables?: Array,
 *   employees?: Array
 * }} params
 */
export const useNominas = ({
  user,
  costCenters = [],
  createPayable,
  cancelPayable,
  payables = [],
  employees = [],
  createNotification,
  notifications = [],
}) => {
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

  // The open payroll payables (the 6 monthly obligations across all periods).
  const payrollPayables = useMemo(
    () =>
      (payables || []).filter(
        (p) =>
          p.payrollKind &&
          p.status !== 'settled' &&
          p.status !== 'cancelled' &&
          p.status !== 'void',
      ),
    [payables],
  );

  // Item 6 — escalating SV + Lohnsteuer due-date reminders from the real parsed
  // Fälligkeit dates. Idempotent: a reminder is emitted once per
  // (payableId + dueDate + severity tier). Dedup uses BOTH the persisted
  // notifications list AND an in-session ref, closing the race window between
  // a createNotification call and the snapshot that reflects it.
  const emittedRemindersRef = useRef(new Set());
  useEffect(() => {
    if (!user || !createNotification) return;
    const reminders = buildDueReminders(payrollPayables, todayIso());
    if (reminders.length === 0) return;

    const existingKeys = new Set(
      (notifications || [])
        .filter((n) => n.type === 'payroll-due')
        .map((n) => {
          const e = n.relatedEntity || {};
          return `${e.payableId || ''}|${e.dueDate || ''}|${n.severity || ''}`;
        }),
    );

    reminders.forEach((r) => {
      const key = `${r.payableId}|${r.dueDate}|${r.severity}`;
      if (existingKeys.has(key) || emittedRemindersRef.current.has(key)) return;
      emittedRemindersRef.current.add(key);
      createNotification({
        type: 'payroll-due',
        severity: r.severity,
        title: r.title,
        message: r.message,
        relatedEntity: {
          entityType: 'payrollPeriod',
          entityId: r.payrollPeriodId,
          payableId: r.payableId,
          payrollKind: r.payrollKind,
          dueDate: r.dueDate,
        },
        userId: user.email || '',
      });
    });
    // notifications intentionally drives dedup; payrollPayables drives triggers.
  }, [user, createNotification, payrollPayables, notifications]);

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
            // Normalize the legacy 'loaded' marker to the derived lifecycle word
            // 'cargada' so viewing a period never triggers a spurious status write.
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
            unmatched: Array.isArray(raw.unmatched) ? raw.unmatched : [],
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
   * Whether any of a period's obligations is backed by a payable that already
   * has a payment. Used as an early pre-flight so a replace aborts BEFORE
   * creating anything (never start a replace we can't finish cleanly).
   */
  const periodHasPaidObligation = (period) => {
    const obligations = Array.isArray(period?.obligations) ? period.obligations : [];
    return obligations.some((ob) => {
      if (!ob.payableId) return false;
      const live = payables.find((p) => p.id === ob.payableId);
      return Boolean(live) && (live.paidAmount || 0) > 0;
    });
  };

  /**
   * Cancel the payables backing a period's obligations.
   * Looks each up in the live `payables` list by payableId and calls
   * cancelPayable (which adapts/guards). Refuses the whole operation if any
   * obligation already carries a payment — never orphan a paid obligation.
   *
   * @returns {{ ok: boolean, error?: Error }}
   */
  const cancelPeriodObligations = async (period) => {
    if (!cancelPayable) return { ok: false, error: new Error('cancelPayable no inyectado') };
    const obligations = Array.isArray(period?.obligations) ? period.obligations : [];

    // Pre-flight: refuse if any backing payable already has a payment.
    for (const ob of obligations) {
      if (!ob.payableId) continue;
      const live = payables.find((p) => p.id === ob.payableId);
      if (live && (live.paidAmount || 0) > 0) {
        return {
          ok: false,
          error: new Error(
            `No se puede modificar la nómina: la obligación "${ob.payee || ob.kind}" ya tiene un pago registrado.`,
          ),
        };
      }
    }

    // Cancel each backing payable.
    for (const ob of obligations) {
      if (!ob.payableId) continue;
      const live = payables.find((p) => p.id === ob.payableId) || { id: ob.payableId, paidAmount: 0 };
      const res = await cancelPayable(live);
      if (!res?.success) {
        return { ok: false, error: res?.error || new Error('No se pudo cancelar una obligación') };
      }
    }
    return { ok: true };
  };

  /**
   * Best-effort rollback of payables created during a single load run.
   * Each id refers to a payable created in THIS run, so paidAmount is 0 and
   * cancelPayable's guard passes.
   */
  const rollbackCreatedPayables = async (createdIds) => {
    if (!cancelPayable) return;
    for (const id of createdIds) {
      try {
        await cancelPayable({ id, paidAmount: 0 });
      } catch (err) {
        logError('Rollback: failed to cancel payable', id, err);
      }
    }
  };

  /**
   * Load a payroll period (create the doc + its 6 obligations atomically).
   *
   * Duplicate guard: if a period with the same YYYY-MM already exists and the
   * caller did not pass `replace:true`, returns { success:false, code:'duplicate', existing }.
   * With `replace:true`, the prior period's payables are cancelled and its doc
   * deleted before the new one is created (aborts if any prior obligation is paid).
   *
   * Atomicity: if any of the 6 createPayable calls fails, every payable created
   * in this run is cancelled and the just-created period doc is deleted, then
   * the real failure is surfaced — no half-loaded period is ever left behind.
   *
   * @param {object} formData - { period, krankenkassen, tax, netWages, lines, documents?, replace? }
   */
  const loadPayrollPeriod = async (formData) => {
    if (!user) return { success: false, error: new Error('No user') };
    if (!createPayable) return { success: false, error: new Error('createPayable not injected') };

    const { period, krankenkassen, tax, netWages, lines, documents = [], replace = false } = formData;

    // ── Duplicate-period guard ────────────────────────────────────────────────
    const existing = findDuplicatePeriod(periods, { period });
    if (existing && !replace) {
      return { success: false, code: 'duplicate', existing };
    }

    try {
      // ── Replace flow: pre-flight only. We create the replacement FIRST and
      // tear down the prior period only AFTER all 6 obligations succeed, so a
      // mid-run failure leaves the original period fully intact. ──────────────
      if (existing && replace && periodHasPaidObligation(existing)) {
        return {
          success: false,
          error: new Error(
            'No se puede reemplazar la nómina: una obligación ya tiene un pago registrado.',
          ),
        };
      }

      const label = monthLabel(period);
      const totals = computePayrollTotals({ krankenkassen, tax, netWages, lines });

      // Resolve employeeId per line via Pers.-Nr (fallback to name). Persist persNr.
      const { resolved, unmatched } = resolveEmployeeIdsByPersNr({ lines, employees });
      const sanitizedLines = resolved.map((l) => ({
        employeeId: l.employeeId || '',
        persNr: l.persNr || '',
        name: l.name || '',
        netto: Number(l.netto) || 0,
        brutto: Number(l.brutto) || 0,
        gesamtkosten: Number(l.gesamtkosten) || 0,
        // Phase 3, item 7 — optional Sonderzahlung tag (bonus / Urlaubsgeld /
        // Weihnachtsgeld / einmalig). Additive, plain string, sanitizer-safe.
        sonderzahlung: l.sonderzahlung || '',
      }));

      // Sanitized document descriptors (plain objects only).
      const sanitizedDocuments = (documents || []).map((d) => ({
        hash: d.hash || '',
        fileName: d.fileName || '',
        kind: d.kind || '',
        pageCount: Number(d.pageCount) || 0,
        importedAt: d.importedAt || new Date().toISOString(),
      }));

      // Step 1 — create the payroll period document
      const periodPayload = {
        period,
        label,
        status: 'cargada',
        netWagesTotal: totals.netWagesTotal,
        socialTotal: totals.socialTotal,
        taxTotal: totals.taxTotal,
        cashTotal: totals.cashTotal,
        employerCostTotal: totals.employerCostTotal,
        employeeCount: totals.employeeCount,
        payCount: totals.payCount,
        lines: sanitizedLines,
        obligations: [], // filled in step 3
        documents: sanitizedDocuments,
        unmatched: unmatched.map((u) => ({ persNr: u.persNr || '', name: u.name || '' })),
        createdBy: user.email || '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        auditTrail: [
          buildPayrollAuditEntry({
            action: replace ? 'replace' : 'create',
            user: user.email || '',
            detail: replace ? `Nómina ${label} recargada (reemplazo)` : `Nómina ${label} cargada`,
          }),
        ],
      };

      const periodDocRef = await addDoc(periodsRef, periodPayload);
      const periodId = periodDocRef.id;

      // Step 2 — build and create the 6 payable payloads (atomically)
      const primaryDoc = sanitizedDocuments[0] || null;
      const documentRef = primaryDoc
        ? { periodId, kind: primaryDoc.kind, fileName: primaryDoc.fileName, hash: primaryDoc.hash }
        : null;

      const payablePayloads = buildPayrollPayables({
        period,
        periodId,
        label,
        costCenterId: nomCostCenterId,
        krankenkassen,
        tax,
        netWages,
        documentRef,
      });

      const obligations = [];
      const createdIds = [];
      const issueDate = new Date().toISOString().slice(0, 10);

      for (const payload of payablePayloads) {
        const result = await createPayable({ ...payload, issueDate });

        if (!result?.success || !result?.id) {
          // ── Partial-failure rollback ──────────────────────────────────────
          logError('Failed to create payroll payable — rolling back', payload, result?.error);
          await rollbackCreatedPayables(createdIds);
          await deleteDoc(periodPath(periodId));
          return {
            success: false,
            error:
              result?.error ||
              new Error(`No se pudo crear la obligación "${payload.vendor}". Se revirtió la carga.`),
          };
        }

        createdIds.push(result.id);
        obligations.push({
          kind: payload.payrollKind,
          payee: payload.vendor,
          amount: payload.amount,
          dueDate: payload.dueDate || null,
          payableId: result.id,
        });
      }

      // Step 3 — write obligations references back to the period doc
      await updateDoc(periodPath(periodId), {
        obligations,
        updatedAt: serverTimestamp(),
      });

      await writeAuditLogEntry({
        action: replace ? 'replace' : 'create',
        entityType: 'payrollPeriod',
        entityId: periodId,
        description: `Nómina ${label} cargada (${obligations.length} obligaciones)`,
        userEmail: user.email,
        after: { period, label, cashTotal: totals.cashTotal, employeeCount: totals.employeeCount },
      });

      // ── Replace flow: the new period is fully created — now tear down the
      // prior one. If teardown fails the new period still stands (transient
      // duplicate); log a warning rather than lose data. ──────────────────────
      if (existing && replace) {
        const cancelRes = await cancelPeriodObligations(existing);
        if (cancelRes.ok) {
          await deleteDoc(periodPath(existing.id));
          await writeAuditLogEntry({
            action: 'delete',
            entityType: 'payrollPeriod',
            entityId: existing.id,
            description: `Nómina ${existing.label || period} reemplazada`,
            userEmail: user.email,
          });
        } else {
          logError('Replace: new period created but prior teardown failed', existing.id, cancelRes.error);
        }
      }

      return { success: true, id: periodId };
    } catch (err) {
      logError('Error loading payroll period:', err);
      return { success: false, error: err };
    }
  };

  /**
   * Patch a payroll period in place (e.g. linking an unmatched line to an
   * employee, or correcting metadata). Appends an audit entry and mirrors to
   * the central audit log.
   */
  const updatePayrollPeriod = async (periodId, patch = {}, detail = 'Nómina actualizada') => {
    if (!user) return { success: false, error: new Error('No user') };
    try {
      const period = periods.find((p) => p.id === periodId);
      await updateDoc(periodPath(periodId), {
        ...patch,
        updatedAt: serverTimestamp(),
        auditTrail: arrayUnion(
          buildPayrollAuditEntry({ action: 'update', user: user.email || '', detail }),
        ),
      });
      await writeAuditLogEntry({
        action: 'update',
        entityType: 'payrollPeriod',
        entityId: periodId,
        description: `Nómina actualizada: ${period?.label || periodId} — ${detail}`,
        userEmail: user.email,
      });
      return { success: true };
    } catch (err) {
      logError('Error updating payroll period:', err);
      return { success: false, error: err };
    }
  };

  /**
   * Delete a payroll period and cancel its 6 backing payables.
   * Refuses if any obligation already has a payment (never orphan a paid one).
   */
  const deletePayrollPeriod = async (periodId) => {
    if (!user) return { success: false, error: new Error('No user') };
    try {
      const period = periods.find((p) => p.id === periodId);
      if (!period) return { success: false, error: new Error('Período no encontrado') };

      const cancelRes = await cancelPeriodObligations(period);
      if (!cancelRes.ok) {
        return { success: false, error: cancelRes.error };
      }

      await deleteDoc(periodPath(periodId));
      await writeAuditLogEntry({
        action: 'delete',
        entityType: 'payrollPeriod',
        entityId: periodId,
        description: `Nómina eliminada: ${period.label || periodId}`,
        userEmail: user.email,
        before: { period: period.period, label: period.label, cashTotal: period.cashTotal },
      });
      return { success: true };
    } catch (err) {
      logError('Error deleting payroll period:', err);
      return { success: false, error: err };
    }
  };

  return {
    periods,
    loading,
    loadPayrollPeriod,
    updatePayrollPeriod,
    deletePayrollPeriod,
    nomCostCenterId,
    payrollPayables,
  };
};

export default useNominas;
