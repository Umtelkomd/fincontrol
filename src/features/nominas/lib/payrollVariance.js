/**
 * Payroll variance — pure comparison of the DATEV obligation amount (expected)
 * vs the amount actually reconciled against the linked bank movement.
 *
 * We read the payable's paidAmount — the PER-ALLOCATION share written by
 * useClassifier when a bank movement is linked. We deliberately do NOT read
 * reconciledAmount: that field lives on the BANK MOVEMENT (the full allocated
 * total), so for a grouped DATEV debit covering several payables it would
 * compare the movement total against a single payable's expected amount and
 * produce a false 'descuadre'.
 */

const TOLERANCE = 0.01;
const cents = (n) => Math.round((Number(n) || 0) * 100) / 100;

const isReconciled = (payable) =>
  Boolean(payable) && (payable.status === 'settled' || payable.status === 'partial');

/**
 * Compare one obligation's expected amount against its reconciled amount.
 * @param {{ obligation:{amount:number}, payable:object|null }} params
 * @returns {{
 *   expected:number, reconciled:number, diff:number, ok:boolean,
 *   status:'pending'|'cuadra'|'descuadre', payee?:string
 * }}
 */
export const obligationVariance = ({ obligation, payable }) => {
  const expected = cents(obligation?.amount);
  const payee = obligation?.payee || payable?.vendor || payable?.counterpartyName || '';

  if (!isReconciled(payable)) {
    return { expected, reconciled: 0, diff: 0, ok: false, status: 'pending', payee };
  }

  // paidAmount is the per-allocation share on the payable (see module note);
  // reconciledAmount lives on the movement and must NOT be used here.
  const reconciled = cents(payable.paidAmount);
  const diff = cents(Math.abs(expected - reconciled));
  const ok = diff <= TOLERANCE;
  return {
    expected,
    reconciled,
    diff,
    ok,
    status: ok ? 'cuadra' : 'descuadre',
    payee,
  };
};

/**
 * Roll per-obligation variances up into a period verdict.
 * pending obligations are excluded from the cuadra/descuadre judgment.
 * @param {Array<{status:string, diff:number, payee?:string}>} rows
 * @returns {{
 *   allReconciled:boolean, totalDiff:number,
 *   descuadres:Array, label:'todo cuadra'|'descuadre'
 * }}
 */
export const periodVarianceSummary = (rows) => {
  const list = Array.isArray(rows) ? rows : [];
  const descuadres = list.filter((r) => r.status === 'descuadre');
  const reconciledRows = list.filter((r) => r.status === 'cuadra' || r.status === 'descuadre');
  const allReconciled = list.length > 0 && reconciledRows.length === list.length && descuadres.length === 0;
  const totalDiff = cents(descuadres.reduce((sum, r) => sum + (Number(r.diff) || 0), 0));

  return {
    allReconciled,
    totalDiff,
    descuadres,
    label: descuadres.length === 0 ? 'todo cuadra' : 'descuadre',
  };
};

export default { obligationVariance, periodVarianceSummary };
