import { useCallback, useMemo } from "react";
import {
	arrayUnion,
	doc,
	serverTimestamp,
	updateDoc,
	writeBatch,
} from "firebase/firestore";
import {
	DEFAULT_CURRENCY,
	MAIN_ACCOUNT_ID,
	MOVEMENT_KIND,
	MOVEMENT_STATUS,
} from "../finance/constants";
import {
	getDocumentOpenAmount,
	RECONCILIATION_EPSILON,
} from "../finance/reconciliation";
import { OPERATIONAL_DATA_START } from "../finance/constants";
import {
	PENDING_REASON,
	classificationCoverage,
	isCostScope,
	pendingReasonOf,
} from "../finance/costScope";
import { clampMoney, toISODate } from "../finance/utils";
import { scorePayrollMatch } from "../features/nominas/lib/payrollMatch";
import { db, appId } from "../services/firebase";
import { reconcileMovement } from "../services/reconcileMovement";
import { writeAuditLogEntry } from "../utils/auditLog";
import { logError } from "../utils/logger";
import { useFinanceLedgerContext } from "../contexts/FinanceLedgerContext";

const COLLECTION_BY_KIND = {
	receivable: "receivables",
	payable: "payables",
};

const ENTITY_TYPE_BY_KIND = {
	receivable: "receivable",
	payable: "payable",
};

const LABEL_BY_KIND = {
	receivable: "CXC",
	payable: "CXP",
};

const getDocumentLabel = (document) =>
	document?.documentNumber ||
	document?.counterpartyName ||
	document?.description ||
	document?.id;

const normalizeDocuments = (documents) =>
	(Array.isArray(documents) ? documents : [documents]).filter(Boolean);

/**
 * useClassifier — operations to handle the weekly DATEV inbox flow.
 *
 * After a Friday DATEV import, every imported bankMovement is "raw":
 *   - direction in/out + amount + postedDate + counterparty + description
 *   - no categoryName / projectId / costCenterId / receivableId / payableId
 *
 * This hook exposes:
 *   linkToReceivable(movement, receivable)
 *     Marks the receivable settled (or partial) and copies its
 *     classification (projectId/projectName/costCenterId) onto the
 *     bankMovement plus a `receivableId` link.
 *
 *   linkToPayable(movement, payable)
 *     Analogous for payables.
 *
 *   categorize(movement, { categoryName, costScope, projectId, projectName, costCenterId, employeeIds })
 *     For "spontaneous" movements that are NOT tied to a CXC/CXP. Just
 *     writes classification fields onto the bankMovement, including the
 *     cost destination (`costScope`: obra vs estructura).
 *
 *   suggestMatches(movement)
 *     Pure helper: returns CXC (if direction=in) or CXP (if direction=out)
 *     candidates with exact amount match (±0.01) within ±21 days.
 *     Excludes receivables/payables already settled.
 *
 *   inboxMovements
 *     `{ sinCategoria, sinObra, sinConciliar }` — the operational movements
 *     (postedDate ≥ OPERATIONAL_DATA_START, optionally one month) split by
 *     `pendingReasonOf`, newest first. `pendingMovements` is the flat union
 *     for consumers that only need a list (rules, alerts).
 *
 * Data comes from the shared ledger (FinanceLedgerContext): movements,
 * receivables and payables plus the bulkClassify mutator. Opening /clasificar
 * used to add eight fresh Firestore listeners on top of the provider's eight.
 *
 * @param {object|null} user
 * @param {{ month?: string }} [options] 'all' or 'YYYY-MM' (inbox + coverage)
 */
export const useClassifier = (user, options = {}) => {
	const { month = "all" } = options;
	const ledger = useFinanceLedgerContext();
	const { bankMovements, receivables, payables, loading } = ledger;
	const bulkClassify = ledger.actions?.bankMovements?.bulkClassify;

	const movementsRef = (id) =>
		doc(db, "artifacts", appId, "public", "data", "bankMovements", id);

	const linkDocumentsToMovement = useCallback(
		async (movement, documents, kind) => {
			if (!user) return { success: false, error: "No user" };
			return reconcileMovement(
				{ db, appId, actor: user },
				{
					movement,
					documentIds: normalizeDocuments(documents).map(
						(document) => document.id,
					),
					kind,
				},
			);
		},
		[user],
	);

	// Admin escape hatch: settle one or more orders WITHOUT a DATEV bankMovement.
	// Used when the bank confirms a payment/collection but the DATEV extract is not
	// yet available. Every forced settle is audited with a mandatory reason so the
	// deviation from the "DATEV is the sole source" policy stays traceable.
	const forceReconcileDocuments = useCallback(
		async (documents, kind, { reason, adminOpsOverride = true } = {}) => {
			if (!user) return { success: false, error: new Error("No user") };
			const docs = normalizeDocuments(documents);
			if (!docs.length)
				return {
					success: false,
					error: new Error("Seleccioná al menos una orden"),
				};
			const trimmedReason = String(reason || "").trim();
			if (!trimmedReason) {
				return {
					success: false,
					error: new Error(
						"Indicá el motivo para forzar la conciliación sin DATEV",
					),
				};
			}

			// F1: forced DATEV-less settle still needs production clear (or reason as override).
			if (kind === "payable") {
				const { assertPayablePaymentAllowed } = await import(
					"../finance/opsControl"
				);
				for (const document of docs) {
					const gate = assertPayablePaymentAllowed(document, {
						adminOverride: adminOpsOverride,
						overrideReason: trimmedReason,
					});
					if (!gate.allowed) {
						return { success: false, error: gate.error };
					}
				}
			}

			const settlements = docs
				.map((document) => ({
					document,
					openAmount: getDocumentOpenAmount(document),
				}))
				.filter((entry) => entry.openAmount > RECONCILIATION_EPSILON);
			if (!settlements.length) {
				return {
					success: false,
					error: new Error("Las órdenes seleccionadas no tienen saldo abierto"),
				};
			}

			try {
				const nowIso = new Date().toISOString();
				const label = LABEL_BY_KIND[kind];
				const batch = writeBatch(db);

				settlements.forEach(({ document, openAmount }) => {
					const documentRef = doc(
						db,
						"artifacts",
						appId,
						"public",
						"data",
						COLLECTION_BY_KIND[kind],
						document.id,
					);
					const nextPaid = clampMoney(
						(Number(document.paidAmount) || 0) + openAmount,
					);
					batch.update(documentRef, {
						openAmount: 0,
						pendingAmount: 0,
						paidAmount: nextPaid,
						status: "settled",
						forcedReconciliation: true,
						payments: arrayUnion({
							date: toISODate(new Date()),
							amount: openAmount,
							method: "Manual",
							reference: "",
							note: `Conciliación forzada sin DATEV: ${trimmedReason}`,
							bankMovementId: null,
							reconciliationMode: "manual-force",
							registeredBy: user.email,
							timestamp: nowIso,
						}),
						updatedBy: user.email,
						updatedAt: serverTimestamp(),
						auditTrail: arrayUnion({
							action: "force-reconcile",
							user: user.email,
							timestamp: nowIso,
							detail: `Conciliación forzada sin DATEV por ${openAmount.toFixed(2)}. Motivo: ${trimmedReason}`,
						}),
					});
				});

				await batch.commit();

				await Promise.all(
					settlements.map(({ document, openAmount }) =>
						writeAuditLogEntry({
							action: "force-reconcile",
							entityType: ENTITY_TYPE_BY_KIND[kind],
							entityId: document.id,
							description: `${label} conciliada sin DATEV (forzada por admin): ${getDocumentLabel(document)}`,
							userEmail: user.email,
							metadata: {
								amount: openAmount,
								reason: trimmedReason,
								reconciliationMode: "manual-force",
							},
						}),
					),
				);

				return { success: true, status: "settled", count: settlements.length };
			} catch (err) {
				logError(`forceReconcileDocuments ${kind} error:`, err);
				return { success: false, error: err };
			}
		},
		[user],
	);

	const forceReceivablesReconcile = useCallback(
		(documents, options) =>
			forceReconcileDocuments(documents, "receivable", options),
		[forceReconcileDocuments],
	);

	const forcePayablesReconcile = useCallback(
		(documents, options) =>
			forceReconcileDocuments(documents, "payable", options),
		[forceReconcileDocuments],
	);

	const linkToReceivable = useCallback(
		async (movement, receivable) => {
			return linkDocumentsToMovement(movement, [receivable], "receivable");
		},
		[linkDocumentsToMovement],
	);

	const linkToPayable = useCallback(
		async (movement, payable) => {
			return linkDocumentsToMovement(movement, [payable], "payable");
		},
		[linkDocumentsToMovement],
	);

	const linkReceivablesToMovement = useCallback(
		(movement, selectedReceivables) =>
			linkDocumentsToMovement(movement, selectedReceivables, "receivable"),
		[linkDocumentsToMovement],
	);

	const linkPayablesToMovement = useCallback(
		(movement, selectedPayables) =>
			linkDocumentsToMovement(movement, selectedPayables, "payable"),
		[linkDocumentsToMovement],
	);

	const categorize = useCallback(
		async (movement, classification) => {
			if (!user) return { success: false, error: "No user" };
			try {
				const categoryName = (classification.categoryName || "").trim();
				const payload = {
					categoryName,
					// Where the cost lands (obra / estructura). Written explicitly so the
					// destination stops being inferred from the presence of a projectId.
					costScope: isCostScope(classification.costScope)
						? classification.costScope
						: "",
					projectId: classification.projectId || "",
					projectName: classification.projectName || "",
					costCenterId: classification.costCenterId || "",
					employeeIds: Array.isArray(classification.employeeIds)
						? classification.employeeIds
						: [],
					updatedBy: user.email,
					updatedAt: serverTimestamp(),
					auditTrail: arrayUnion({
						action: "classify",
						user: user.email,
						timestamp: new Date().toISOString(),
						detail: `Categorizado como ${categoryName || "sin categoría"}`,
					}),
				};
				await updateDoc(movementsRef(movement.id), payload);
				return { success: true };
			} catch (err) {
				logError("categorize error:", err);
				return { success: false, error: err };
			}
		},
		[user],
	);

	// Pure suggestion logic — does not touch Firestore
	const suggestMatches = useCallback(
		(movement) => {
			if (!movement) return [];
			const amount = Math.abs(Number(movement.amount) || 0);
			const targetDate = new Date(movement.postedDate || "");
			if (Number.isNaN(targetDate.getTime())) return [];
			const TOLERANCE_DAYS = 21;
			const TOLERANCE_MS = TOLERANCE_DAYS * 24 * 60 * 60 * 1000;

			const pool = movement.direction === "in" ? receivables : payables;
			const fieldDate = movement.direction === "in" ? "dueDate" : "dueDate";

			return (pool || [])
				.filter(
					(p) =>
						p.status !== "settled" &&
						p.status !== "cancelled" &&
						p.status !== "void",
				)
				.map((p) => {
					const open = Math.abs(
						Number(p.openAmount || p.grossAmount || p.amount) || 0,
					);
					const itemDate = new Date(p[fieldDate] || p.issueDate || "");
					const daysDiff = Number.isNaN(itemDate.getTime())
						? Infinity
						: Math.abs((itemDate - targetDate) / (1000 * 60 * 60 * 24));
					const amountDiff = Math.abs(open - amount);
					// Score: amount match worth 100, date proximity worth up to 30
					let score = 0;
					if (amountDiff < 0.01) score += 100;
					else if (amountDiff < 1) score += 80;
					else if (amountDiff < 10) score += 40;
					else return null;
					if (daysDiff <= TOLERANCE_DAYS) score += Math.max(0, 30 - daysDiff);
					// Phase 2, item 2 — payroll boost: the 6 monthly payroll debits become
					// near-automatic one-click confirms (score >= 130) when the out-movement
					// matches a payrollKind payable within the banking-day due window.
					score += scorePayrollMatch({ movement, payable: p });
					return { item: p, amountDiff, daysDiff, score };
				})
				.filter((m) => m && m.score > 0)
				.sort((a, b) => b.score - a.score)
				.slice(0, 5);
		},
		[receivables, payables],
	);

	// Operational scope: 2026+ only. The 2025 rows are a closed, DATEV-reconciled
	// year that nobody classifies any more; leaving them in made the coverage
	// read 7% forever and the inbox impossible to finish.
	const operationalMovements = useMemo(
		() =>
			(bankMovements || []).filter(
				(m) => (m.postedDate || "") >= OPERATIONAL_DATA_START,
			),
		[bankMovements],
	);

	// 'YYYY-MM' keys present in the operational data, newest first — the Mes filter.
	const availableMonths = useMemo(() => {
		const keys = new Set();
		operationalMovements.forEach((m) => {
			const key = (m.postedDate || "").slice(0, 7);
			if (key.length === 7) keys.add(key);
		});
		return [...keys].sort().reverse();
	}, [operationalMovements]);

	const scopedMovements = useMemo(
		() =>
			month === "all"
				? operationalMovements
				: operationalMovements.filter(
						(m) => (m.postedDate || "").slice(0, 7) === month,
					),
		[operationalMovements, month],
	);

	// Inbox: the scoped movements that still need something, by reason.
	const inboxMovements = useMemo(() => {
		const buckets = { sinCategoria: [], sinObra: [], sinConciliar: [] };
		scopedMovements.forEach((m) => {
			const reason = pendingReasonOf(m);
			if (reason === PENDING_REASON.SIN_CATEGORIA) buckets.sinCategoria.push(m);
			else if (reason === PENDING_REASON.SIN_OBRA) buckets.sinObra.push(m);
			else if (reason === PENDING_REASON.SIN_CONCILIAR)
				buckets.sinConciliar.push(m);
		});
		const byDateDesc = (a, b) =>
			(b.postedDate || "").localeCompare(a.postedDate || "");
		buckets.sinCategoria.sort(byDateDesc);
		buckets.sinObra.sort(byDateDesc);
		buckets.sinConciliar.sort(byDateDesc);
		return buckets;
	}, [scopedMovements]);

	const pendingMovements = useMemo(
		() => [
			...inboxMovements.sinCategoria,
			...inboxMovements.sinObra,
			...inboxMovements.sinConciliar,
		],
		[inboxMovements],
	);

	// Coverage over the SAME scoped set, so the header and the tabs add up.
	const coverage = useMemo(
		() => classificationCoverage(scopedMovements),
		[scopedMovements],
	);

	return {
		inboxMovements,
		pendingMovements,
		scopedMovements,
		availableMonths,
		coverage,
		loading,
		bulkClassify,
		bankMovements,
		receivables,
		payables,
		linkToReceivable,
		linkToPayable,
		linkReceivablesToMovement,
		linkPayablesToMovement,
		forceReceivablesReconcile,
		forcePayablesReconcile,
		categorize,
		suggestMatches,
	};
};

export default useClassifier;
