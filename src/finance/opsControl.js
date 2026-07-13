/**
 * Ops-control helpers for FinControl F0 (gerencia integration).
 * Pure functions — safe for unit tests and UI badges.
 */

export const COMPLIANCE_DOC_TYPES = [
  { key: 'freistellungExpiresAt', label: 'Freistellung §48b', critical: true },
  { key: 'mindestlohnExpiresAt', label: 'Mindestlohn', critical: true },
  { key: 'insuranceExpiresAt', label: 'Seguro RC / Haftpflicht', critical: false },
  { key: 'a1ExpiresAt', label: 'A1 / posted workers', critical: false },
  { key: 'tradeLicenseExpiresAt', label: 'Gewerbeanmeldung', critical: false },
];

export const COMPLIANCE_WARN_DAYS = 30;

const toIsoDate = (value) => {
  if (!value) return '';
  if (typeof value === 'string') return value.slice(0, 10);
  if (value?.toDate) return value.toDate().toISOString().slice(0, 10);
  try {
    return new Date(value).toISOString().slice(0, 10);
  } catch {
    return '';
  }
};

const daysUntil = (iso, todayIso) => {
  const a = new Date(`${iso}T00:00:00`);
  const b = new Date(`${todayIso}T00:00:00`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  return Math.round((a - b) / (1000 * 60 * 60 * 24));
};

/**
 * Worst compliance status across partner docs.
 * @returns {{ status: 'ok'|'warn'|'expired'|'missing', label: string, worstDays: number|null, items: Array }}
 */
export function partnerComplianceStatus(partner, todayIso = new Date().toISOString().slice(0, 10)) {
  if (!partner) {
    return { status: 'missing', label: 'Sin datos', worstDays: null, items: [] };
  }

  // Only vendors / both need subcontractor compliance gates.
  const needsCompliance = partner.type === 'vendor' || partner.type === 'both';
  if (!needsCompliance) {
    return { status: 'ok', label: 'N/A (cliente)', worstDays: null, items: [] };
  }

  const items = COMPLIANCE_DOC_TYPES.map((doc) => {
    const expiresAt = toIsoDate(partner[doc.key]);
    if (!expiresAt) {
      return {
        ...doc,
        expiresAt: '',
        days: null,
        status: doc.critical ? 'missing' : 'ok',
      };
    }
    const days = daysUntil(expiresAt, todayIso);
    let status = 'ok';
    if (days != null && days < 0) status = 'expired';
    else if (days != null && days <= COMPLIANCE_WARN_DAYS) status = 'warn';
    return { ...doc, expiresAt, days, status };
  });

  const rank = { expired: 0, missing: 1, warn: 2, ok: 3 };
  let worst = 'ok';
  let worstDays = null;
  for (const item of items) {
    if (rank[item.status] < rank[worst]) worst = item.status;
    if (item.status === 'expired' || item.status === 'warn') {
      if (worstDays == null || (item.days != null && item.days < worstDays)) {
        worstDays = item.days;
      }
    }
  }

  const labels = {
    ok: 'Compliance OK',
    warn: worstDays != null ? `Vence en ${worstDays}d` : 'Por vencer',
    expired: 'Documento vencido',
    missing: 'Falta Freistellung/Mindestlohn',
  };

  return { status: worst, label: labels[worst], worstDays, items };
}

/** Active assignment if date window covers today (open-ended to allowed). */
export function isAssignmentActive(assignment, todayIso = new Date().toISOString().slice(0, 10)) {
  if (!assignment?.projectId) return false;
  const from = toIsoDate(assignment.from);
  const to = toIsoDate(assignment.to);
  if (from && todayIso < from) return false;
  if (to && todayIso > to) return false;
  return true;
}

/**
 * Rented/leased vehicles or housing properties without a current project assignment.
 */
export function assetsMissingProjectAssignment(assets, { todayIso, costTypes = ['rented', 'leased'] } = {}) {
  const today = todayIso || new Date().toISOString().slice(0, 10);
  return (assets || []).filter((asset) => {
    if (asset.status && asset.status !== 'active') return false;
    if (costTypes.length && !costTypes.includes(asset.type)) return false;
    const assignment = asset.currentAssignment || {};
    if (isAssignmentActive(assignment, today)) return false;
    // Fallback: legacy multi-project tags count as "assigned" if present.
    if (Array.isArray(asset.projectIds) && asset.projectIds.length > 0) return false;
    return true;
  });
}

/** Operational expense without projectId (for alerts / gates). */
export function lacksProject(record) {
  if (!record) return true;
  const id = record.projectId || record.rawRecord?.projectId || '';
  const name = record.projectName || record.project || record.rawRecord?.projectName || '';
  if (String(id).trim()) return false;
  if (String(name).trim() && String(name).trim() !== 'Sin proyecto') return false;
  return true;
}

/**
 * F1 — production gate on CXP (subcontractor payables).
 * - Payroll: never gated
 * - opsGateRequired === false: never gated (rent, Sixt, software…)
 * - opsGateRequired === true: gated (new operational CXP from createPayable)
 * - Legacy (field missing): only gated if productionWeekRef or employeeIds set
 */
export function payableRequiresOpsClear(payable) {
  if (!payable) return false;
  if (payable.payrollPeriodId || payable.payrollKind) return false;
  if (payable.opsGateRequired === false) return false;
  if (payable.opsGateRequired === true) return true;
  if (payable.productionWeekRef) return true;
  if (Array.isArray(payable.employeeIds) && payable.employeeIds.length > 0) return true;
  return false;
}

export function payableIsOpsCleared(payable) {
  if (!payableRequiresOpsClear(payable)) return true;
  return Boolean(payable.opsCleared);
}

/**
 * Whether a payment / DATEV reconcile is allowed.
 * Admin can override with a non-empty reason.
 */
export function assertPayablePaymentAllowed(payable, { adminOverride = false, overrideReason = '' } = {}) {
  if (payableIsOpsCleared(payable)) {
    return { allowed: true };
  }
  if (adminOverride && String(overrideReason || '').trim().length >= 5) {
    return { allowed: true, override: true };
  }
  const name = payable?.counterpartyName || payable?.vendor || payable?.documentNumber || payable?.id || 'CXP';
  return {
    allowed: false,
    error: new Error(
      `CXP sin producción validada (ops): ${name}. ` +
        'Marcá "Validar producción" o importá la semana en /ops-semana. ' +
        'Admin puede forzar con motivo ≥5 caracteres.',
    ),
  };
}

export function isoWeekLabel(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

export function emptyAssignment() {
  return {
    projectId: '',
    projectName: '',
    from: '',
    to: '',
    notes: '',
  };
}

export function normalizeAssignment(raw = {}) {
  return {
    projectId: String(raw.projectId || '').trim(),
    projectName: String(raw.projectName || '').trim(),
    from: toIsoDate(raw.from),
    to: toIsoDate(raw.to),
    notes: String(raw.notes || '').trim(),
  };
}
