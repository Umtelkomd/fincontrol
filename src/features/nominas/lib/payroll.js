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
}) => {
  // Shared marker fields added to every payable
  const markers = {
    payrollPeriod: period,
    payrollPeriodId: periodId,
    source: 'payroll',
    categoryName: 'Salarios',
    costCenterId: costCenterId || '',
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
