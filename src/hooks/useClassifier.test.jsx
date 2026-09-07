import { beforeEach, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

const store = vi.hoisted(() => ({ rows: {}, writes: 0, audits: [] }));
vi.mock("../services/firebase", () => ({ db: {}, appId: "tenant-a" }));
vi.mock("../contexts/FinanceLedgerContext", () => ({
	useFinanceLedgerContext: () => ({
		bankMovements: [],
		receivables: [],
		payables: [],
	}),
}));
vi.mock("../utils/auditLog", () => ({
	writeAuditLogEntry: async (entry) => {
		store.audits.push(entry);
	},
}));
vi.mock("firebase/firestore", () => {
	const apply = (path, data) => {
		const row = store.rows[path] || {};
		for (const [key, value] of Object.entries(data)) {
			row[key] = value?.union ? [...(row[key] || []), ...value.union] : value;
		}
		store.rows[path] = row;
		store.writes++;
	};
	return {
		doc: (_, ...parts) => parts.join("/"),
		serverTimestamp: () => "server-time",
		arrayUnion: (...union) => ({ union }),
		updateDoc: vi.fn(),
		writeBatch: () => {
			const writes = [];
			return {
				update: (...args) => writes.push(args),
				commit: async () => writes.forEach((args) => apply(...args)),
			};
		},
		runTransaction: async (_, callback) => {
			const writes = [];
			const result = await callback({
				get: async (path) => {
					expect(writes).toHaveLength(0);
					const row = structuredClone(store.rows[path]);
					return { exists: () => !!row, data: () => row };
				},
				update: (...args) => writes.push(args),
				set: (...args) => writes.push(args),
			});
			writes.forEach((args) => apply(...args));
			return result;
		},
	};
});
import { useClassifier } from "./useClassifier";
const path = (collection, id) =>
	`artifacts/tenant-a/public/data/${collection}/${id}`;
const movement = {
	id: "bank",
	amount: 60,
	direction: "in",
	postedDate: "2026-08-01",
};
const invoice = {
	id: "invoice",
	grossAmount: 100,
	paidAmount: 0,
	openAmount: 100,
};
beforeEach(() => {
	store.rows = {
		"users/manager": { role: "manager", appId: "tenant-a" },
		[path("bankMovements", "bank")]: { ...movement },
		[path("receivables", "invoice")]: { ...invoice },
	};
	store.writes = 0;
	store.audits = [];
});
it.each([
	"stale",
	"refreshed",
])("duplicate public submission with %s snapshots is write-free", async (snapshot) => {
	const { result } = renderHook(() =>
		useClassifier({ uid: "manager", email: "manager@example.test" }),
	);
	expect(await result.current.linkToReceivable(movement, invoice)).toEqual({
		success: true,
		status: "partial",
		count: 1,
	});
	const writes = store.writes;
	const next =
		snapshot === "stale"
			? invoice
			: { ...store.rows[path("receivables", "invoice")] };
	expect(await result.current.linkToReceivable(movement, next)).toEqual({
		success: true,
		status: "partial",
		count: 1,
	});
	expect(store.rows[path("receivables", "invoice")].payments).toHaveLength(1);
	expect(store.rows[path("receivables", "invoice")].paidAmount).toBe(60);
	expect(store.writes).toBe(writes);
	expect(
		Object.keys(store.rows).filter((key) => key.includes("/auditLog/")),
	).toHaveLength(2);
});
