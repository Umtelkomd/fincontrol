import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import process from "node:process";
import { withEmulatorSafety } from "./emulatorSafety.js";

// Test-only SDK adapter: independent real clients both read the old document
// before either may commit. Subsequent callbacks remain real SDK retries.
const control = vi.hoisted(() => ({
	barrier: null,
	callbacks: 0,
	afterRead: null,
	denyAudit: false,
}));
vi.mock("firebase/firestore", async (importOriginal) => {
	const sdk = await importOriginal();
	return {
		...sdk,
		runTransaction: (db, callback) =>
			sdk.runTransaction(db, async (tx) => {
				control.callbacks++;
				return callback({
					get: async (ref) => {
						const snapshot = await tx.get(ref);
						if (
							ref.path.includes("/receivables/") ||
							ref.path.includes("/payables/")
						) {
							if (control.barrier) await control.barrier();
							if (control.afterRead) {
								const action = control.afterRead;
								control.afterRead = null;
								await action();
							}
						}
						return snapshot;
					},
					update: (...args) => tx.update(...args),
					// A cross-tenant audit reference is denied by the actual existing rules.
					// This fault injection proves that the SDK commits no financial-only batch.
					set: (ref, data) =>
						tx.set(
							control.denyAudit
								? sdk.doc(db, "artifacts/denied/public/data/auditLog/denied")
								: ref,
							data,
						),
				});
			}),
	};
});
let environment, sdk, reconcileMovement, reconciliationAuditId;
const path = (collection, id) =>
	`artifacts/tenant-a/public/data/${collection}/${id}`;
const bank = (id = "bank", amount = 60) => ({
	id,
	amount,
	direction: "in",
	postedDate: "2026-08-01",
});
const invoice = (amount = 100) => ({
	grossAmount: amount,
	openAmount: amount,
	paidAmount: 0,
	status: "issued",
});
const seed = async (rows) =>
	environment.withSecurityRulesDisabled(async (context) => {
		for (const [key, value] of Object.entries(rows))
			await sdk.setDoc(sdk.doc(context.firestore(), key), value);
	});
const read = async (collection, id) =>
	(
		await sdk.getDoc(
			sdk.doc(
				environment.authenticatedContext("manager").firestore(),
				path(collection, id),
			),
		)
	).data();
const audits = async () =>
	(
		await sdk.getDocs(
			sdk.collection(
				environment.authenticatedContext("manager").firestore(),
				path("auditLog", "").slice(0, -1),
			),
		)
	).size;
const call = (
	movement = bank(),
	documentIds = ["a"],
	uid = "manager",
	extra = {},
) =>
	reconcileMovement(
		{
			db: environment.authenticatedContext(uid).firestore(),
			appId: "tenant-a",
			actor: { uid, email: `${uid}@example.test` },
		},
		{ movement, documentIds, kind: "receivable", ...extra },
	);
function overlap() {
	let arrived = 0,
		release;
	const ready = new Promise((resolve) => {
		release = resolve;
	});
	control.barrier = async () => {
		if (++arrived === 2) {
			control.barrier = null;
			release();
		}
		await ready;
	};
}
beforeAll(async () => {
	environment = await withEmulatorSafety(
		process.env,
		async ({ projectId, host, port }) => {
			const testing = await import("@firebase/rules-unit-testing");
			sdk = await import("firebase/firestore");
			({ reconcileMovement, reconciliationAuditId } = await import(
				"../services/reconcileMovement.js"
			));
			return testing.initializeTestEnvironment({
				projectId,
				firestore: {
					host,
					port,
					rules: await readFile(
						new URL("../../firestore.rules", import.meta.url),
						"utf8",
					),
				},
			});
		},
	);
});
afterAll(async () => {
	await environment?.cleanup();
});
beforeEach(async () => {
	control.barrier = null;
	control.callbacks = 0;
	control.afterRead = null;
	control.denyAudit = false;
	await environment.clearFirestore();
	await seed({
		"users/manager": { role: "manager", appId: "tenant-a" },
		"users/admin": { role: "admin", appId: "tenant-a" },
		"users/editor": { role: "editor", appId: "tenant-a" },
		"users/foreign": { role: "manager", appId: "tenant-b" },
		[path("bankMovements", "bank")]: bank(),
		[path("receivables", "a")]: invoice(),
		[path("receivables", "b")]: invoice(80),
	});
});
it("two independent clients retry the same request without duplicate effects", async () => {
	overlap();
	const results = await Promise.all([call(), call()]);
	expect(results).toEqual([
		{ success: true, status: "partial", count: 1 },
		{ success: true, status: "partial", count: 1 },
	]);
	expect(control.callbacks).toBeGreaterThan(2);
	expect(await read("receivables", "a")).toMatchObject({
		paidAmount: 60,
		openAmount: 40,
		pendingAmount: 40,
	});
	expect((await read("receivables", "a")).payments).toHaveLength(1);
	expect(await audits()).toBe(2);
	expect(await call()).toEqual(results[0]);
	expect(await audits()).toBe(2);
});
it("conflicting selections have one winner and an unchanged loser", async () => {
	overlap();
	const results = await Promise.all([call(), call(bank(), ["b"])]);
	expect(results.filter((result) => result.success)).toHaveLength(1);
	expect(control.callbacks).toBeGreaterThan(2);
	const documents = await Promise.all(
		["a", "b"].map((id) => read("receivables", id)),
	);
	expect(
		documents.map((item) => item.paidAmount).sort((a, b) => a - b),
	).toEqual([0, 60]);
	expect(await audits()).toBe(2);
});
it.each([
	40, 60,
])("two movements against one invoice respect fresh remaining balance (%s)", async (amount) => {
	await seed({ [path("bankMovements", "second")]: bank("second", amount) });
	overlap();
	const results = await Promise.all([call(), call(bank("second", amount))]);
	expect(control.callbacks).toBeGreaterThan(2);
	expect(results.filter((result) => result.success)).toHaveLength(
		amount === 40 ? 2 : 1,
	);
	const item = await read("receivables", "a");
	expect(item.paidAmount).toBe(amount === 40 ? 100 : 60);
	expect(item.openAmount).toBe(amount === 40 ? 0 : 40);
	expect(item.payments).toHaveLength(amount === 40 ? 2 : 1);
	expect(await audits()).toBe(amount === 40 ? 4 : 2);
});
it("grouped allocation preserves selection order and rejects reordered retry", async () => {
	await seed({ [path("bankMovements", "bank")]: bank("bank", 150) });
	expect(await call(bank("bank", 150), ["b", "a"])).toEqual({
		success: true,
		status: "partial",
		count: 2,
	});
	expect(
		(await read("bankMovements", "bank")).receivableAllocations.map(
			(a) => a.amount,
		),
	).toEqual([80, 70]);
	expect(await read("receivables", "a")).toMatchObject({
		paidAmount: 70,
		openAmount: 30,
		pendingAmount: 30,
	});
	expect((await call(bank("bank", 150), ["a", "b"])).success).toBe(false);
	expect(await audits()).toBe(3);
});
it("five-document group commits atomically in selection order and retries without writes", async () => {
	const ids = ["e", "c", "a", "d", "b"];
	const movement = bank("bank", 45);
	await seed({
		[path("bankMovements", "bank")]: movement,
		...Object.fromEntries(
			ids.map((id) => [path("receivables", id), invoice(10)]),
		),
	});
	const result = { success: true, status: "partial", count: 5 };
	expect(await call(movement, ids)).toEqual(result);
	const linked = await read("bankMovements", "bank");
	expect(linked.receivableIds).toEqual(ids);
	expect(linked.receivableAllocations.map((a) => a.amount)).toEqual([
		10, 10, 10, 10, 5,
	]);
	const committed = await Promise.all(ids.map((id) => read("receivables", id)));
	expect(committed.map((item) => item.paidAmount)).toEqual([10, 10, 10, 10, 5]);
	expect(committed.map((item) => item.openAmount)).toEqual([0, 0, 0, 0, 5]);
	expect(committed.every((item) => item.payments.length === 1)).toBe(true);
	expect(await audits()).toBe(6);
	expect(await call(movement, ids)).toEqual(result);
	expect((await call(movement, [...ids].reverse())).success).toBe(false);
	expect(await Promise.all(ids.map((id) => read("receivables", id)))).toEqual(
		committed,
	);
	expect(await read("bankMovements", "bank")).toEqual(linked);
	expect(await audits()).toBe(6);
});
for (const kind of ["receivable", "payable"]) {
	it.each([
		["amount alias with missing balances/status", { amount: 100 }, 60],
		[
			"pendingAmount alias derives paid balance",
			{ amount: "100", pendingAmount: "80", status: "open" },
			80,
		],
		[
			"paidAmount derives open balance",
			{ grossAmount: 100, paidAmount: 20, status: "pending" },
			80,
		],
		[
			"openAmount derives paid balance",
			{ grossAmount: 100, openAmount: 80, status: "PARTIAL" },
			80,
		],
	])(`${kind} adapter preserves %s`, async (_name, raw, paidAmount) => {
		const movement = {
			...bank(),
			direction: kind === "payable" ? "out" : "in",
		};
		await seed({
			[path("bankMovements", "bank")]: movement,
			[path(`${kind}s`, "a")]: raw,
		});
		expect(await call(movement, ["a"], "manager", { kind })).toEqual({
			success: true,
			status: "partial",
			count: 1,
		});
		expect(await read(`${kind}s`, "a")).toMatchObject({
			paidAmount,
			openAmount: 100 - paidAmount,
			pendingAmount: 100 - paidAmount,
		});
		expect(await audits()).toBe(2);
	});
	it.each([
		"paid",
		"completed",
	])(`${kind} settled status alias %s is skipped in original selection order`, async (status) => {
		const movement = {
			...bank(),
			direction: kind === "payable" ? "out" : "in",
		};
		const settled = { amount: 100, pendingAmount: 0, status };
		await seed({
			[path("bankMovements", "bank")]: movement,
			[path(`${kind}s`, "a")]: settled,
			[path(`${kind}s`, "b")]: invoice(),
		});
		expect(await call(movement, ["a", "b"], "manager", { kind })).toEqual({
			success: true,
			status: "partial",
			count: 1,
		});
		expect(await read(`${kind}s`, "a")).toEqual(settled);
		expect((await read("bankMovements", "bank"))[`${kind}Ids`]).toEqual(["b"]);
		expect(await audits()).toBe(2);
	});
}
it.each([
	["omitted", {}],
	["null", { currency: null, accountId: null }],
	["empty", { currency: "", accountId: "" }],
])("benign %s currency/account defaults match explicit EUR/main", async (_name, defaults) => {
	const movement = { ...bank(), currency: "EUR", accountId: "main" };
	await seed({
		[path("bankMovements", "bank")]: { ...bank(), ...defaults },
		[path("receivables", "a")]: { ...invoice(), ...defaults },
	});
	expect((await call(movement)).success).toBe(true);
	expect(
		(await read("bankMovements", "bank")).reconciliationRequest,
	).toMatchObject({ currency: "EUR", accountId: "main" });
	expect(await audits()).toBe(2);
});
it.each([
	["currency", { currency: "USD" }],
	["account", { accountId: "other" }],
])("explicit %s mismatch with defaulted document aborts all writes", async (_name, change) => {
	const movement = { ...bank(), ...change };
	await seed({ [path("bankMovements", "bank")]: movement });
	const before = await read("receivables", "a");
	expect((await call(movement)).success).toBe(false);
	expect(await read("receivables", "a")).toEqual(before);
	expect(await read("bankMovements", "bank")).toEqual(movement);
	expect(await audits()).toBe(0);
});
it.each([
	["nonfinite amount alias", { amount: "not-money" }],
	["negative pending alias", { amount: 100, pendingAmount: -1 }],
	["infinite paid balance", { amount: 100, paidAmount: Infinity }],
	["overpaid derived open balance", { amount: 100, paidAmount: 120 }],
	["settled alias with open balance", { amount: 100, status: "completed" }],
])("corrupted adapter balance is explicitly rejected: %s", async (_name, raw) => {
	await seed({ [path("receivables", "a")]: raw });
	const result = await call();
	expect(result.success).toBe(false);
	expect(result.error.message).toMatch(/balance/i);
	expect(await read("receivables", "a")).toEqual(raw);
	expect(
		(await read("bankMovements", "bank")).reconciliationId,
	).toBeUndefined();
	expect(await audits()).toBe(0);
});
it("five-document rules-denied audit leaves the entire group unchanged", async () => {
	const ids = ["a", "b", "c", "d", "e"];
	await seed(
		Object.fromEntries(ids.map((id) => [path("receivables", id), invoice(12)])),
	);
	control.denyAudit = true;
	const result = await call(bank(), ids);
	expect(result.success).toBe(false);
	expect(result.error.code).toBe("permission-denied");
	expect(await Promise.all(ids.map((id) => read("receivables", id)))).toEqual(
		ids.map(() => invoice(12)),
	);
	expect(await read("bankMovements", "bank")).toEqual(bank());
	expect(await audits()).toBe(0);
});
it.each([
	[100.01, true],
	[100.02, false],
])("preserves cent residual %s", async (amount, success) => {
	await seed({ [path("bankMovements", "bank")]: bank("bank", amount) });
	expect((await call(bank("bank", amount))).success).toBe(success);
	expect((await read("receivables", "a")).paidAmount).toBe(success ? 100 : 0);
	expect(await audits()).toBe(success ? 2 : 0);
});
it.each([
	"editor",
	"foreign",
	"unprovisioned",
])("rejects unauthorized registry %s without writes", async (uid) => {
	expect((await call(bank(), ["a"], uid)).success).toBe(false);
	expect((await read("receivables", "a")).paidAmount).toBe(0);
	expect(await audits()).toBe(0);
});
it.each([
	{ status: "void" },
	{ status: "cancelled" },
	{ openAmount: NaN },
	{ paidAmount: -1 },
	{ currency: "USD" },
	{ accountId: "other" },
	{ pendingAmount: 90 },
])("invalid fresh document is atomic: %j", async (change) => {
	await seed({ [path("receivables", "a")]: { ...invoice(), ...change } });
	expect((await call()).success).toBe(false);
	expect(
		(await read("bankMovements", "bank")).reconciliationId,
	).toBeUndefined();
	expect(await audits()).toBe(0);
});
it("rejects missing selections, duplicates, direction mismatch and ambiguous legacy links", async () => {
	expect((await call(bank(), ["missing"])).success).toBe(false);
	expect((await call(bank(), ["a", "a"])).success).toBe(false);
	await seed({
		[path("bankMovements", "bank")]: { ...bank(), direction: "out" },
	});
	expect((await call()).success).toBe(false);
	await seed({
		[path("bankMovements", "bank")]: {
			...bank(),
			reconciliationId: "movement:bank",
			receivableId: "a",
		},
	});
	expect((await call()).success).toBe(false);
	expect(await audits()).toBe(0);
});
it("raw missing payment marker conflicts rather than repairing a prior outcome", async () => {
	expect((await call()).success).toBe(true);
	const item = await read("receivables", "a");
	await seed({ [path("receivables", "a")]: { ...item, payments: [] } });
	expect((await call()).success).toBe(false);
	expect((await read("receivables", "a")).paidAmount).toBe(60);
	expect(await audits()).toBe(2);
});
it("audit collisions never overwrite unrelated records", async () => {
	await seed({
		[path("auditLog", reconciliationAuditId("bank", "bankMovement", "bank"))]: {
			action: "unrelated",
		},
	});
	expect((await call()).success).toBe(false);
	expect((await read("receivables", "a")).paidAmount).toBe(0);
	expect(await audits()).toBe(1);
});
it("an actual rules-denied audit aborts every financial write", async () => {
	control.denyAudit = true;
	expect((await call()).success).toBe(false);
	expect((await read("receivables", "a")).paidAmount).toBe(0);
	expect(
		(await read("bankMovements", "bank")).reconciliationId,
	).toBeUndefined();
	expect(await audits()).toBe(0);
});
it("fresh ops and registry changes on retry cannot be bypassed", async () => {
	const movement = { ...bank(), direction: "out" };
	await seed({
		[path("bankMovements", "bank")]: movement,
		[path("payables", "a")]: {
			...invoice(),
			opsGateRequired: true,
			opsCleared: true,
		},
	});
	control.afterRead = () =>
		seed({
			[path("payables", "a")]: {
				...invoice(),
				opsGateRequired: true,
				opsCleared: false,
			},
		});
	expect(
		(await call(movement, ["a"], "manager", { kind: "payable" })).success,
	).toBe(false);
	expect(control.callbacks).toBeGreaterThan(1);
	expect(
		(
			await call(movement, ["a"], "manager", {
				kind: "payable",
				adminOpsOverride: true,
				opsOverrideReason: "Valid reason",
			})
		).success,
	).toBe(false);
	expect(
		(
			await call(movement, ["a"], "admin", {
				kind: "payable",
				adminOpsOverride: true,
				opsOverrideReason: "no",
			})
		).success,
	).toBe(false);
	expect(await audits()).toBe(0);
	expect(
		(
			await call(movement, ["a"], "admin", {
				kind: "payable",
				adminOpsOverride: true,
				opsOverrideReason: "Valid reason",
			})
		).success,
	).toBe(true);
	expect((await read("payables", "a")).payments[0].opsOverrideReason).toBe(
		"Valid reason",
	);
});
it("registry revocation after authoritative read aborts transaction", async () => {
	control.afterRead = () =>
		seed({ "users/manager": { role: "editor", appId: "tenant-a" } });
	expect((await call()).success).toBe(false);
	expect((await read("receivables", "a")).paidAmount).toBe(0);
	expect(await audits()).toBe(0);
});
