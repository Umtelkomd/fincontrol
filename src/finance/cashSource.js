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

import { deriveBalance, detectImportGap, roundEur } from "../lib/finance";

/**
 * @param {{
 *   anchors: import('../lib/finance/cashPosition.js').ReconciliationAnchor[],
 *   movements: import('../lib/finance/movementAmount.js').BankMovement[],
 *   today: string,
 *   legacyBalance: number,
 *   reconciliationLoading?: boolean,
 *   reconciliationError?: Error|null,
 * }} params
 * @returns {{
 *   currentCash: number|null,
 *   source: 'anchors'|'legacy'|'unavailable',
 *   cashMeta: {
 *     status: 'loading'|'error'|'ready',
 *     anchor: object|null,
 *     lastMovementDate: string|null,
 *     staleDays: number|null,
 *     importGap: { hasGap: boolean, lastMovementDate: string|null, quietBusinessDays: number|null },
 *   },
 * }}
 */
export const resolveCashSource = ({
	anchors,
	movements,
	today,
	legacyBalance,
	reconciliationLoading = false,
	reconciliationError = null,
}) => {
	const importGap = detectImportGap({ movements: movements || [], today });
	// A failed/pending read is not evidence of an absent anchor. Retained anchors
	// may aid diagnosis, but never supply an authoritative balance during retry.
	if (reconciliationLoading || reconciliationError) {
		return {
			currentCash: null,
			source: "unavailable",
			cashMeta: {
				status: reconciliationLoading ? "loading" : "error",
				anchor: null,
				lastMovementDate: importGap.lastMovementDate,
				staleDays: null,
				importGap,
			},
		};
	}
	const position = deriveBalance({
		anchors: anchors || [],
		movements: movements || [],
		today,
	});

	// `balance === null` means no usable anchor covers `today` → legacy path.
	const anchored = position.balance !== null;

	return {
		currentCash: roundEur(anchored ? position.balance : legacyBalance),
		source: anchored ? "anchors" : "legacy",
		cashMeta: {
			status: "ready",
			anchor: anchored ? position.anchor : null,
			lastMovementDate: position.lastMovementDate,
			staleDays: position.staleDays,
			importGap,
		},
	};
};

export default resolveCashSource;
