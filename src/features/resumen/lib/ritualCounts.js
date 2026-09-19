import { isPendingBatch } from "../../../finance/batchReconciliation.js";
import { OPERATIONAL_DATA_START } from "../../../finance/constants.js";
import { pendingReasonOf } from "../../../finance/costScope.js";
import { isInternalTransfer } from "../../../lib/finance/movementAmount.js";

const asMovements = (value) => (Array.isArray(value) ? value : []);

/**
 * Classifier inbox: operational, non-void movements with a pendingReasonOf.
 * Missing-invoice is a separate signal and is not counted here.
 */
export const pendingInboxCount = (movements) => {
	let count = 0;
	for (const movement of asMovements(movements)) {
		if (!movement || typeof movement !== "object") continue;
		if (movement.status === "void") continue;
		if ((movement.postedDate || "") < OPERATIONAL_DATA_START) continue;
		if (pendingReasonOf(movement) != null) count += 1;
	}
	return count;
};

/**
 * Confirming remesas still waiting for an explanation, excluding own-account
 * transfers.
 */
export const pendingRemesasCount = (movements) => {
	let count = 0;
	for (const movement of asMovements(movements)) {
		if (!movement || typeof movement !== "object") continue;
		if (isPendingBatch(movement) && !isInternalTransfer(movement)) count += 1;
	}
	return count;
};
