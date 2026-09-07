import {
	arrayUnion,
	doc,
	runTransaction,
	serverTimestamp,
} from "firebase/firestore";
import {
	adaptBankMovementDoc,
	adaptPayableDoc,
	adaptReceivableDoc,
} from "../finance/adapters";
import {
	buildMovementAllocations,
	RECONCILIATION_EPSILON as EPSILON,
} from "../finance/reconciliation";
import { assertPayablePaymentAllowed } from "../finance/opsControl";
import {
	clampMoney,
	getAccountId,
	getCurrency,
	toISODate,
} from "../finance/utils";

const validId = (id) =>
	typeof id === "string" &&
	/^[^/]{1,200}$/.test(id) &&
	![".", ".."].includes(id);
const fail = (message) => {
	throw new Error(message);
};
const conflict = () =>
	fail("Reconciliation conflict: existing linkage needs review");
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const near = (a, b) => Math.abs(clampMoney(a - b)) <= EPSILON;
const common = (documents, field) => {
	const values = [
		...new Set(documents.map((item) => item[field]).filter(Boolean)),
	];
	return values.length === 1 ? values[0] : "";
};
const descriptor = (kind, ids, movement) => ({
	version: 1,
	kind,
	documentIds: [...ids],
	amount: clampMoney(Math.abs(Number(movement.amount))),
	currency: getCurrency(movement.currency),
	accountId: getAccountId(movement.accountId),
});
const sameRequest = (a, b) =>
	a &&
	a.version === b.version &&
	a.kind === b.kind &&
	equal(a.documentIds, b.documentIds) &&
	a.amount === b.amount &&
	a.currency === b.currency &&
	a.accountId === b.accountId;
export const reconciliationAuditId = (movementId, kind, id) =>
	`reconcile:${encodeURIComponent(`movement:${movementId}`)}:${kind}:${encodeURIComponent(id)}`;

function validateDocument(raw, canonical) {
	for (const field of [
		"grossAmount",
		"amount",
		"paidAmount",
		"openAmount",
		"pendingAmount",
	]) {
		if (
			raw[field] != null &&
			(!Number.isFinite(Number(raw[field])) || Number(raw[field]) < 0)
		)
			fail("Invalid document balance");
	}
	if (
		![
			"",
			"issued",
			"open",
			"pending",
			"partial",
			"overdue",
			"settled",
			"paid",
			"completed",
		].includes(String(raw.status || "").toLowerCase())
	)
		fail("Unsupported document status");
	if (!Array.isArray(raw.payments ?? [])) fail("Invalid payment history");
	if (
		canonical.grossAmount <= 0 ||
		canonical.paidAmount < 0 ||
		canonical.openAmount < 0 ||
		!near(canonical.paidAmount + canonical.openAmount, canonical.grossAmount) ||
		(raw.pendingAmount != null &&
			!near(Number(raw.pendingAmount), canonical.openAmount)) ||
		(canonical.status === "settled" && canonical.openAmount > EPSILON)
	)
		fail("Conflicting document balances");
}

/** Canonical DATEV linking only. All references are confined to the injected tenant. */
export async function reconcileMovement(
	{ db, appId, actor },
	{
		movement,
		documentIds,
		kind,
		adminOpsOverride = false,
		opsOverrideReason = "",
	},
) {
	try {
		if (
			!validId(appId) ||
			!validId(actor?.uid) ||
			!validId(movement?.id) ||
			!["receivable", "payable"].includes(kind)
		)
			fail("Invalid reconciliation identity");
		if (
			!Array.isArray(documentIds) ||
			!documentIds.length ||
			documentIds.some((id) => !validId(id)) ||
			new Set(documentIds).size !== documentIds.length
		)
			fail("Invalid or duplicate document selection");
		if (
			!Number.isFinite(Number(movement.amount)) ||
			Number(movement.amount) <= EPSILON
		)
			fail("Invalid movement amount");
		const request = descriptor(kind, documentIds, movement);
		const movementId = movement.id;
		const nowIso = new Date().toISOString();
		const user = actor.email || actor.uid;
		const reason = String(opsOverrideReason || "").trim();
		const reconciliationId = `movement:${movementId}`;
		const mode = documentIds.length > 1 ? "grouped-datev" : "datev";
		const collection = `${kind}s`;
		const other = kind === "receivable" ? "payable" : "receivable";
		const ref = (name, id) =>
			doc(db, "artifacts", appId, "public", "data", name, id);
		const bankRef = ref("bankMovements", movementId);
		const documentRefs = documentIds.map((id) => ref(collection, id));
		const auditRefs = [
			ref(
				"auditLog",
				reconciliationAuditId(movementId, "bankMovement", movementId),
			),
			...documentIds.map((id) =>
				ref("auditLog", reconciliationAuditId(movementId, kind, id)),
			),
		];
		// One commit only: SDK/backend payload and resource limits surface as failure,
		// never as partially settled chunks. Repeated rule lookups share a registry path;
		// their count is not a product-level cap on selected documents.
		return await runTransaction(db, async (transaction) => {
			// Firestore forbids reads after writes; even unallocated selections are read.
			const registry = await transaction.get(doc(db, "users", actor.uid));
			if (
				!registry.exists() ||
				registry.data().appId !== appId ||
				!["admin", "manager"].includes(registry.data().role)
			)
				fail("Reconciliation requires a provisioned tenant manager");
			if (adminOpsOverride && registry.data().role !== "admin")
				fail("Ops override requires admin");
			const bankSnapshot = await transaction.get(bankRef);
			const snapshots = [];
			for (const reference of documentRefs)
				snapshots.push(await transaction.get(reference));
			const audits = [];
			for (const reference of auditRefs)
				audits.push(await transaction.get(reference));
			if (
				!bankSnapshot.exists() ||
				snapshots.some((snapshot) => !snapshot.exists())
			)
				fail("Movement or selected document not found");
			const rawBank = bankSnapshot.data();
			const bank = adaptBankMovementDoc({ ...rawBank, id: movementId });
			if (
				!Number.isFinite(Number(rawBank.amount)) ||
				Number(rawBank.amount) <= EPSILON ||
				bank.status !== "posted" ||
				rawBank.direction !== (kind === "receivable" ? "in" : "out")
			)
				fail("Invalid movement amount, status or direction");
			if (!sameRequest(request, descriptor(kind, documentIds, bank)))
				conflict();
			const documents = snapshots.map((snapshot, index) => {
				const raw = { ...snapshot.data(), id: documentIds[index] };
				const canonical = (
					kind === "receivable" ? adaptReceivableDoc : adaptPayableDoc
				)(raw);
				validateDocument(raw, canonical);
				if (
					canonical.currency !== bank.currency ||
					canonical.accountId !== bank.accountId
				)
					fail("Document currency or account does not match movement");
				return {
					...canonical,
					categoryName: raw.categoryName || raw.category || "",
				};
			});
			const allocationsField = `${kind}Allocations`;
			const hasLinks =
				rawBank.reconciliationId ||
				rawBank.reconciliationRequest ||
				rawBank.reconciledAt ||
				rawBank.reconciliationMode ||
				rawBank.manualReconciliation ||
				rawBank.linkedTransactionId ||
				["receivable", "payable"].some(
					(type) =>
						rawBank[`${type}Id`] ||
						rawBank[`${type}Ids`]?.length ||
						rawBank[`${type}Allocations`]?.length,
				);
			if (hasLinks) {
				if (
					rawBank.reconciliationId !== reconciliationId ||
					!sameRequest(rawBank.reconciliationRequest, request) ||
					rawBank[`${other}Id`] ||
					rawBank[`${other}Ids`]?.length ||
					rawBank[`${other}Allocations`]?.length ||
					rawBank.manualReconciliation ||
					rawBank.linkedTransactionId ||
					rawBank.reconciliationMode !== mode
				)
					conflict();
				const prior = rawBank[allocationsField];
				if (
					!Array.isArray(prior) ||
					!prior.length ||
					new Set(prior.map((a) => a.documentId)).size !== prior.length ||
					!equal(
						rawBank[`${kind}Ids`],
						prior.map((a) => a.documentId),
					) ||
					rawBank[`${kind}Id`] !== prior[0].documentId ||
					rawBank.reconciledAmount !== request.amount
				)
					conflict();
				const ordered = documents.filter((item) =>
					prior.some((a) => a.documentId === item.id),
				);
				if (
					!equal(
						ordered.map((item) => item.id),
						prior.map((a) => a.documentId),
					)
				)
					conflict();
				let total = 0;
				for (const item of documents) {
					const allocation = prior.find(
						(entry) => entry.documentId === item.id,
					);
					const markers = (item.raw.payments || []).filter(
						(payment) => payment.bankMovementId === movementId,
					);
					if (!allocation) {
						if (markers.length) conflict();
						continue;
					}
					if (
						!Number.isFinite(allocation.amount) ||
						allocation.amount <= EPSILON ||
						!Number.isFinite(allocation.openAmountBefore) ||
						!Number.isFinite(allocation.openAmountAfter) ||
						allocation.openAmountAfter < 0 ||
						!near(
							allocation.openAmountBefore - allocation.openAmountAfter,
							allocation.amount,
						) ||
						markers.length !== 1 ||
						markers[0].amount !== allocation.amount ||
						markers[0].reconciliationMode !== mode ||
						item.paidAmount + EPSILON < allocation.amount
					)
						conflict();
					const audit = audits[documentIds.indexOf(item.id) + 1];
					if (
						!audit.exists() ||
						audit.data().metadata?.reconciliationId !== reconciliationId ||
						audit.data().entityId !== item.id ||
						audit.data().metadata?.amount !== allocation.amount
					)
						conflict();
					total += allocation.amount;
				}
				if (
					!near(total, request.amount) ||
					!audits[0].exists() ||
					audits[0].data().metadata?.reconciliationId !== reconciliationId ||
					audits[0].data().entityId !== movementId
				)
					conflict();
				return {
					success: true,
					status: prior.every((a) => a.openAmountAfter <= EPSILON)
						? "settled"
						: "partial",
					count: prior.length,
				};
			}
			if (
				audits.some((audit) => audit.exists()) ||
				documents.some((item) =>
					item.raw.payments?.some(
						(payment) => payment.bankMovementId === movementId,
					),
				)
			)
				conflict();
			const overrides = [];
			if (kind === "payable")
				for (const item of documents) {
					const gate = assertPayablePaymentAllowed(item.raw, {
						adminOverride: adminOpsOverride,
						overrideReason: reason,
					});
					if (!gate.allowed) throw gate.error;
					if (gate.override) overrides.push(item.id);
				}
			const plan = buildMovementAllocations(bank.amount, documents);
			if (!plan.allocations.length || !plan.isFullyAllocated)
				fail("Selected documents do not cover the movement balance");
			const ids = plan.allocations.map((a) => a.documentId);
			const label = kind === "receivable" ? "CXC" : "CXP";
			const evidence = overrides.length
				? {
						opsOverrideReason: reason,
						opsOverrideDocumentIds: overrides,
						opsOverrideBy: actor.uid,
					}
				: {};
			const audit = (entityType, entityId, description, metadata) => ({
				action: "reconcile",
				entityType,
				entityId,
				description,
				before: null,
				after: null,
				metadata: { ...metadata, reconciliationId, ...evidence },
				user,
				timestamp: serverTimestamp(),
			});
			transaction.update(bankRef, {
				[`${kind}Id`]: ids[0],
				[`${kind}Ids`]: ids,
				[allocationsField]: plan.allocations.map((a) => ({
					documentId: a.documentId,
					amount: a.amount,
					openAmountBefore: a.openAmount,
					openAmountAfter: a.nextOpenAmount,
				})),
				reconciliationId,
				reconciliationRequest: request,
				reconciliationMode: mode,
				reconciledAmount: plan.movementAmount,
				reconciledAt: serverTimestamp(),
				updatedAt: serverTimestamp(),
				updatedBy: user,
				categoryName:
					common(documents, "categoryName") || bank.categoryName || "",
				projectId: common(documents, "projectId") || bank.projectId || "",
				projectName:
					common(documents, "projectName") ||
					bank.projectName ||
					(documents.length > 1 ? "Múltiples proyectos" : ""),
				costCenterId:
					common(documents, "costCenterId") || bank.costCenterId || "",
				auditTrail: arrayUnion({
					action: `link-${kind}`,
					user,
					timestamp: nowIso,
					detail: `Conciliado con ${ids.length} ${label} por ${plan.movementAmount.toFixed(2)} ${bank.currency}`,
					...evidence,
				}),
			});
			transaction.set(
				auditRefs[0],
				audit(
					"bankMovement",
					movementId,
					`Movimiento DATEV conciliado con ${ids.length} ${label}: ${bank.description || movementId}`,
					{
						documentIds: ids,
						reconciliationMode: mode,
						amount: plan.movementAmount,
					},
				),
			);
			for (const allocation of plan.allocations) {
				const index = documentIds.indexOf(allocation.documentId);
				transaction.update(documentRefs[index], {
					openAmount: allocation.nextOpenAmount,
					pendingAmount: allocation.nextOpenAmount,
					paidAmount: clampMoney(
						allocation.document.paidAmount + allocation.amount,
					),
					status: allocation.nextStatus,
					payments: arrayUnion({
						date: bank.postedDate || toISODate(new Date(nowIso)),
						amount: allocation.amount,
						method: "Transferencia",
						reference: bank.description || "",
						note:
							documents.length > 1
								? "Conciliado en pago agrupado desde DATEV"
								: "Conciliado desde DATEV",
						bankMovementId: movementId,
						reconciliationMode: mode,
						registeredBy: user,
						timestamp: nowIso,
						...evidence,
					}),
					updatedBy: user,
					updatedAt: serverTimestamp(),
					auditTrail: arrayUnion({
						action: "link-bank-movement",
						user,
						timestamp: nowIso,
						detail: `Conciliado con bankMovement ${movementId}`,
						...evidence,
					}),
				});
				transaction.set(
					auditRefs[index + 1],
					audit(
						kind,
						allocation.documentId,
						`${label} conciliada: ${allocation.document.documentNumber || allocation.document.counterpartyName || allocation.documentId} ↔ bank ${bank.postedDate}`,
						{
							bankMovementId: movementId,
							amount: allocation.amount,
							nextStatus: allocation.nextStatus,
							reconciliationMode: mode,
						},
					),
				);
			}
			return {
				success: true,
				status: plan.allocations.every((a) => a.nextStatus === "settled")
					? "settled"
					: "partial",
				count: ids.length,
			};
		});
	} catch (error) {
		return { success: false, error };
	}
}
