import { beforeEach, expect, it, vi } from "vitest";
vi.mock("firebase/firestore", () => ({
	doc: vi.fn(),
	runTransaction: vi.fn(),
	arrayUnion: vi.fn(),
	serverTimestamp: vi.fn(),
}));
import { runTransaction } from "firebase/firestore";
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
