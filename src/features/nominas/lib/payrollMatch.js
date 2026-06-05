/**
 * Payroll-aware match boost — pure scorer, unit-testable in isolation.
 *
 * useClassifier.suggestMatches already scores amount (=100) + date proximity
 * (≤30). This helper returns an ADDITIVE bonus that pushes the 6 monthly
 * payroll debits to a one-click confirmable score (>= PAYROLL_MATCH_THRESHOLD)
 * when:
 *   - the movement is an OUT-flow,
 *   - the candidate payable carries a payrollKind,
 *   - the amount matches within a cent,
 *   - the movement's postedDate is within a banking-day window of the due date.
 *
 * Settlement is unchanged — this only re-ranks suggestions.
 */

import { bankingDaysBetween } from './bankingCalendar.js';

export const PAYROLL_MATCH_THRESHOLD = 130;

// How many banking days around the due date still count as "the payroll window".
const DUE_WINDOW_BANKING_DAYS = 5;

const AMOUNT_TOLERANCE = 0.01;

/**
 * @param {{ movement:object, payable:object, dueWindowDays?:number }} params
 * @returns {number} additive payroll bonus (0 when not applicable)
 */
export const scorePayrollMatch = ({ movement, payable, dueWindowDays = DUE_WINDOW_BANKING_DAYS }) => {
  if (!movement || !payable) return 0;
  if (movement.direction !== 'out') return 0;
  if (!payable.payrollKind) return 0;

  const moveAmount = Math.abs(Number(movement.amount) || 0);
  const open = Math.abs(Number(payable.openAmount ?? payable.amount) || 0);
  if (Math.abs(open - moveAmount) > AMOUNT_TOLERANCE) return 0;

  const posted = movement.postedDate;
  const due = payable.dueDate;
  if (!posted || !due) return 0;

  const bankingDays = Math.abs(bankingDaysBetween(posted, due));
  if (bankingDays > dueWindowDays) return 0;

  // Base bonus (40) clears 100 → 140 so payroll debits always pass the
  // PAYROLL_MATCH_THRESHOLD; tighter due windows get a small extra nudge.
  const proximityBonus = Math.max(0, dueWindowDays - bankingDays);
  return 40 + proximityBonus;
};

export default { scorePayrollMatch, PAYROLL_MATCH_THRESHOLD };
