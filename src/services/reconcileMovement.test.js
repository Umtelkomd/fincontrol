import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("firebase/firestore", () => ({
	doc: vi.fn(),
	runTransaction: vi.fn(),
	arrayUnion: vi.fn(),
	serverTimestamp: vi.fn(),
}));
import { doc, runTransaction } from "firebase/firestore";
import { reconcileMovement, reconciliationAuditId } from "./reconcileMovement";
const context = { db: {}, appId: "tenant-a", actor: { uid: "manager" } };
const intent = {
	kind: "receivable",
	movement: { id: "bank", amount: 60 },
	documentIds: ["invoice"],
};
beforeEach(() => vi.clearAllMocks());
it.each([
	{ kind: "other" },
	{ documentIds: ["invoice", "invoice"] },
	{ documentIds: ["nested/id"] },
	{ documentIds: [] },
	{ movement: { id: "bank", amount: NaN } },
	{ movement: { id: "bank", amount: -60 } },
])("rejects malformed intent before opening a transaction: %j", async (change) => {
	expect(
		(await reconcileMovement(context, { ...intent, ...change })).success,
	).toBe(false);
	expect(runTransaction).not.toHaveBeenCalled();
});
it.each([
	"resource-exhausted",
	"invalid-argument",
])("returns SDK %s failure without splitting or a second transaction", async (code) => {
	const error = Object.assign(
		new Error("Atomic request rejected by SDK/backend"),
		{ code },
	);
	runTransaction.mockRejectedValueOnce(error);
	expect(
		await reconcileMovement(context, {
			...intent,
			documentIds: ["a", "b", "c", "d", "e"],
		}),
	).toEqual({ success: false, error });
	expect(runTransaction).toHaveBeenCalledTimes(1);
});
it("encodes audit identity without path or separator collisions", () => {
	expect(reconciliationAuditId("a:b", "payable", "c")).not.toBe(
		reconciliationAuditId("a", "payable", "b:c"),
	);
	expect(reconciliationAuditId("a/b", "payable", "c")).not.toContain("/");
});

describe("cost scope inheritance", () => {
	const appId = "tenant-a";
	const actor = { uid: "mgr-1", email: "manager@umtelkomd.com" };
	const movementId = "bank-1";
	const documentId = "receivable-1";
	const pathOf = (...segments) => segments.join("/");

	beforeEach(() => {
		doc.mockImplementation((_db, ...segments) => pathOf(...segments));
	});

	// Runs one fresh (no prior linkage) receivable reconciliation against a
	// fully mocked Firestore transaction and returns the payload written to
	// the bank movement, so each test can assert on the derived costScope in
	// isolation from the rest of the transaction's bookkeeping.
	const reconcile = async ({ documentOverrides = {}, bankOverrides = {} } = {}) => {
		const registryPath = pathOf("users", actor.uid);
		const bankPath = pathOf("artifacts", appId, "public", "data", "bankMovements", movementId);
		const documentPath = pathOf("artifacts", appId, "public", "data", "receivables", documentId);
		const auditBankPath = pathOf(
			"artifacts", appId, "public", "data", "auditLog",
			reconciliationAuditId(movementId, "bankMovement", movementId),
		);
		const auditDocPath = pathOf(
			"artifacts", appId, "public", "data", "auditLog",
			reconciliationAuditId(movementId, "receivable", documentId),
		);
		const dataByPath = {
			[registryPath]: { appId, role: "manager" },
			[bankPath]: { amount: 60, direction: "in", status: "posted", ...bankOverrides },
			[documentPath]: {
				grossAmount: 60,
				openAmount: 60,
				paidAmount: 0,
				status: "open",
				payments: [],
				...documentOverrides,
			},
			[auditBankPath]: undefined,
			[auditDocPath]: undefined,
		};
		const transaction = {
			get: vi.fn(async (path) => ({
				exists: () => dataByPath[path] !== undefined,
				data: () => dataByPath[path],
			})),
			update: vi.fn(),
			set: vi.fn(),
		};
		runTransaction.mockImplementationOnce(async (_db, callback) => callback(transaction));

		const result = await reconcileMovement(
			{ db: {}, appId, actor },
			{ movement: { id: movementId, amount: 60 }, documentIds: [documentId], kind: "receivable" },
		);
		expect(result.success).toBe(true);
		return transaction.update.mock.calls[0][1];
	};

	it("derives costScope from the inherited cost center when nothing else carries one", async () => {
		const payload = await reconcile({ documentOverrides: { costCenterId: "CC-300" } });
		expect(payload.costCenterId).toBe("CC-300");
		expect(payload.costScope).toBe("overhead");
	});

	it("prefers a costScope shared by the documents over one derived from the cost center", async () => {
		const payload = await reconcile({
			documentOverrides: { costCenterId: "CC-300", costScope: "project" },
		});
		expect(payload.costScope).toBe("project");
	});

	it("falls back to the bank movement's own costScope before deriving one from the cost center", async () => {
		const payload = await reconcile({
			documentOverrides: { costCenterId: "CC-300" },
			bankOverrides: { costScope: "project" },
		});
		expect(payload.costScope).toBe("project");
	});

	it("leaves costScope empty when nothing resolves it", async () => {
		const payload = await reconcile();
		expect(payload.costCenterId).toBe("");
		expect(payload.costScope).toBe("");
	});
});
