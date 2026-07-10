/**
 * Cash-source resolution: anchors-derived balance with legacy fallback.
 *
 * The ledger needs ONE number for "cash today" plus provenance metadata. When
 * reconciliation anchors exist (settings/reconciliation) the balance comes
 * from lib/finance `deriveBalance` (anchor + signed movements after it).
 * When no anchor covers `today` — empty array, malformed anchors, or anchors
 * only in the future — the caller-provided legacy balance wins, so production
 * behaves identically until the anchor seed runs.
 *
 * Pure: no Firebase, no wall clock. The caller passes `today` and the already
 * computed legacy balance (kept OUTSIDE this module so the legacy formula
 * stays byte-identical in useFinanceLedger).
 */

import { deriveBalance, detectImportGap, roundEur } from '../lib/finance';

/**
 * @param {{
 *   anchors: import('../lib/finance/cashPosition.js').ReconciliationAnchor[],
 *   movements: import('../lib/finance/movementAmount.js').BankMovement[],
 *   today: string,
 *   legacyBalance: number,
 * }} params
 * @returns {{
 *   currentCash: number,
 *   source: 'anchors'|'legacy',
 *   cashMeta: {
 *     anchor: object|null,
 *     lastMovementDate: string|null,
 *     staleDays: number|null,
 *     importGap: { hasGap: boolean, lastMovementDate: string|null, quietBusinessDays: number|null },
 *   },
 * }}
 */
export const resolveCashSource = ({ anchors, movements, today, legacyBalance }) => {
  const position = deriveBalance({ anchors: anchors || [], movements: movements || [], today });
  const importGap = detectImportGap({ movements: movements || [], today });

  // `balance === null` means no usable anchor covers `today` → legacy path.
  const anchored = position.balance !== null;

  return {
    currentCash: roundEur(anchored ? position.balance : legacyBalance),
    source: anchored ? 'anchors' : 'legacy',
    cashMeta: {
      anchor: anchored ? position.anchor : null,
      lastMovementDate: position.lastMovementDate,
      staleDays: position.staleDays,
      importGap,
    },
  };
};

export default resolveCashSource;
