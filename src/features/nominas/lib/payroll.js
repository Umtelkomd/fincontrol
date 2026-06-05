/**
 * Payroll pure functions — no side effects, no Firebase imports.
 * All monetary math uses Math.round to 2 decimal places to avoid float drift.
 */

const SPANISH_MONTHS = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

/**
 * Converts a YYYY-MM string to a Spanish month label.
 * @param {string} period - e.g. '2026-04'
 * @returns {string} - e.g. 'Abril 2026'
 */
export const monthLabel = (period) => {
  const [year, month] = period.split('-');
  const monthName = SPANISH_MONTHS[parseInt(month, 10) - 1] || '';
  return `${monthName} ${year}`;
};

/**
 * Round a number to 2 decimal places (cent precision).
 * @param {number} n
 * @returns {number}
 */
const cents = (n) => Math.round(n * 100) / 100;

/**
 * Compute payroll totals from KK, tax, netWages, and per-employee lines.
 *
 * @param {{
 *   krankenkassen: Array<{payee: string, amount: number}>,
 *   tax: {amount: number},
 *   netWages: {amount: number},
 *   lines: Array<{employeeId: string, name: string, netto: number, brutto: number, gesamtkosten: number}>
 * }} params
 *
 * @returns {{
 *   socialTotal: number,
 *   taxTotal: number,
 *   netWagesTotal: number,
 *   cashTotal: number,
 *   employerCostTotal: number,
 *   employeeCount: number,
 *   payCount: number
 * }}
 */
export const computePayrollTotals = ({ krankenkassen, tax, netWages, lines }) => {
  const socialTotal = cents(
    (krankenkassen || []).reduce((sum, kk) => sum + (Number(kk.amount) || 0), 0),
  );
  const taxTotal = cents(Number(tax?.amount) || 0);
  const netWagesTotal = cents(Number(netWages?.amount) || 0);
  const cashTotal = cents(socialTotal + taxTotal + netWagesTotal);

  const employerCostTotal = cents(
    (lines || []).reduce((sum, line) => sum + (Number(line.gesamtkosten) || 0), 0),
  );

  const employeeCount = (lines || []).length;
  const payCount = (lines || []).filter((line) => (Number(line.netto) || 0) > 0).length;

  return {
    socialTotal,
    taxTotal,
    netWagesTotal,
    cashTotal,
    employerCostTotal,
    employeeCount,
    payCount,
  };
};

/**
 * Build the 6 payable payloads for a payroll period.
 * 4 Krankenkassen + 1 Lohnsteuer + 1 aggregate net wages.
 *
 * @param {{
 *   period: string,
 *   periodId: string,
 *   label: string,
 *   costCenterId: string,
 *   krankenkassen: Array<{payee: string, amount: number, dueDate?: string}>,
 *   tax: {amount: number, payee?: string, dueDate?: string},
 *   netWages: {amount: number, dueDate?: string}
 * }} params
 *
 * @returns {Array<Object>} - array of 6 payable payloads (ready for createPayable)
 */
export const buildPayrollPayables = ({
  period,
  periodId,
  label,
  costCenterId,
  krankenkassen,
  tax,
  netWages,
  documentRef = null,
}) => {
  // Source-document fingerprint stamped on every payable (Phase 1, item 6).
  // Plain object only — sanitizer-safe. Null when no document was imported.
  const sourceDocument = documentRef
    ? {
        periodId: documentRef.periodId || periodId || '',
        kind: documentRef.kind || '',
        fileName: documentRef.fileName || '',
        hash: documentRef.hash || '',
      }
    : null;

  // Shared marker fields added to every payable
  const markers = {
    payrollPeriod: period,
    payrollPeriodId: periodId,
    source: 'payroll',
    categoryName: 'Salarios',
    costCenterId: costCenterId || '',
    sourceDocument,
  };

  // 4 Krankenkassen payables
  const kkPayables = (krankenkassen || []).map((kk) => ({
    vendor: kk.payee,
    counterpartyName: kk.payee,
    amount: cents(Number(kk.amount) || 0),
    dueDate: kk.dueDate || null,
    payrollKind: 'krankenkasse',
    ...markers,
  }));

  // 1 Lohnsteuer / Finanzamt payable
  const taxPayee = tax?.payee || 'Finanzamt';
  const taxPayable = {
    vendor: taxPayee,
    counterpartyName: taxPayee,
    amount: cents(Number(tax?.amount) || 0),
    dueDate: tax?.dueDate || null,
    payrollKind: 'tax',
    ...markers,
  };

  // 1 aggregate net wages payable
  const wagesPayable = {
    vendor: `Sueldos netos ${label}`,
    counterpartyName: `Sueldos netos ${label}`,
    amount: cents(Number(netWages?.amount) || 0),
    dueDate: netWages?.dueDate || null,
    payrollKind: 'wages',
    ...markers,
  };

  return [...kkPayables, taxPayable, wagesPayable];
};

// ─── Duplicate-period detection (Phase 1, item 1) ─────────────────────────────

/**
 * Normalize a period object (or raw string) to its 'YYYY-MM' key.
 * @param {object|string|null} period
 * @returns {string}
 */
export const periodKey = (period) => {
  if (!period) return '';
  if (typeof period === 'string') return period;
  return period.period || '';
};

/**
 * Find an already-loaded period that shares the same 'YYYY-MM' key.
 * @param {Array<{period:string}>} periods - currently loaded periods
 * @param {object|string} candidate - the period being loaded
 * @returns {object|null} the existing period, or null
 */
export const findDuplicatePeriod = (periods, candidate) => {
  const key = periodKey(candidate);
  if (!key) return null;
  return (periods || []).find((p) => periodKey(p) === key) || null;
};

// ─── Net-wages reconciliation (Phase 1, item 4) ───────────────────────────────

/**
 * Compare the sum of per-employee net pay against the aggregate net-wages
 * obligation. ok=true within a 0.01 tolerance (blocking-warning predicate).
 *
 * @param {{ lines: Array<{netto:number}>, netWages: number|{amount:number} }} params
 * @returns {{ sumLines:number, aggregate:number, diff:number, ok:boolean }}
 */
export const reconcileNetWages = ({ lines, netWages }) => {
  const sumLines = cents(
    (lines || []).reduce((sum, l) => sum + (Number(l.netto) || 0), 0),
  );
  const aggregate = cents(
    typeof netWages === 'object' && netWages !== null
      ? Number(netWages.amount) || 0
      : Number(netWages) || 0,
  );
  const diff = cents(Math.abs(sumLines - aggregate));
  // Tolerance of a single cent: a 0.01 rounding gap reconciles, 0.02 does not.
  return { sumLines, aggregate, diff, ok: diff <= 0.01 };
};

// ─── Per-line variance check vs employee reference (Phase 1, item 4) ──────────

const VARIANCE_THRESHOLD = 0.05; // 5%

/**
 * Compute the relative deviation of a single field against its reference.
 * Returns pct=0 (and flagged=false) when the reference is 0 — no divide-by-zero.
 */
const fieldDelta = (ref, value) => {
  const refNum = Number(ref) || 0;
  const valNum = Number(value) || 0;
  const pct = refNum === 0 ? 0 : Math.abs(valNum - refNum) / refNum;
  return {
    ref: refNum,
    value: valNum,
    pct,
    flagged: refNum !== 0 && pct > VARIANCE_THRESHOLD,
  };
};

/**
 * For each parsed line, compare netto/brutto/gesamtkosten against the matched
 * employee's monthly reference values. Flags deviations strictly greater than
 * 5%. A missing reference (employee not found, or 0) is never flagged.
 *
 * @param {{
 *   lines: Array<{employeeId:string, persNr?:string, name?:string, netto:number, brutto:number, gesamtkosten:number}>,
 *   employeesById: Object<string, {nettoMonthly:number, bruttoMonthly:number, gesamtkostenMonthly:number}>
 * }} params
 * @returns {Array<{employeeId, persNr, name, deltas:{netto,brutto,gesamtkosten}}>}
 */
export const computeLineVariances = ({ lines, employeesById }) => {
  const byId = employeesById || {};
  return (lines || []).map((line) => {
    const ref = byId[line.employeeId] || {};
    return {
      employeeId: line.employeeId || '',
      persNr: line.persNr || '',
      name: line.name || '',
      deltas: {
        netto: fieldDelta(ref.nettoMonthly, line.netto),
        brutto: fieldDelta(ref.bruttoMonthly, line.brutto),
        gesamtkosten: fieldDelta(ref.gesamtkostenMonthly, line.gesamtkosten),
      },
    };
  });
};

// ─── Document fingerprint descriptor (Phase 1, item 6) ────────────────────────

/**
 * Shape a precomputed sha-256 hex + file metadata into a sanitizer-safe plain
 * object for payrollPeriods.documents[] and payable.sourceDocument.
 * No crypto here (hashHex is precomputed) so this stays jsdom-testable.
 *
 * @param {{ hashHex:string, fileName:string, kind:string, pageCount?:number }} params
 * @returns {{ hash:string, fileName:string, kind:string, pageCount:number, importedAt:string }}
 */
export const buildDocumentDescriptor = ({ hashHex, fileName, kind, pageCount } = {}) => ({
  hash: hashHex || '',
  fileName: fileName || '',
  kind: kind || '',
  pageCount: Number(pageCount) || 0,
  importedAt: new Date().toISOString(),
});

// ─── Audit-trail entry (Phase 1, item 7) ──────────────────────────────────────

/**
 * Build a normalized, sanitizer-safe audit entry for payrollPeriods.auditTrail[].
 * Timestamp is an ISO string (never a Date) and all fields default to '' so the
 * object never carries `undefined` into Firestore.
 *
 * @param {{ action:string, user?:string, detail?:string, period?:object }} params
 * @returns {{ action:string, user:string, timestamp:string, detail:string }}
 */
export const buildPayrollAuditEntry = ({ action, user, detail } = {}) => ({
  action: action || '',
  user: user || '',
  timestamp: new Date().toISOString(),
  detail: detail || '',
});
