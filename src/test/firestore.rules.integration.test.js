import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import process from "node:process";
import { withEmulatorSafety } from "./emulatorSafety.js";

let environment, assertFails, assertSucceeds, doc, getDoc, setDoc, updateDoc;
const tenantPath = (tenant = "tenant-a", collection = "invoices") =>
	`artifacts/${tenant}/public/data/${collection}/synthetic-record`;
const dbFor = (uid) => environment.authenticatedContext(uid).firestore();

beforeAll(async () => {
	environment = await withEmulatorSafety(
		process.env,
		async ({ projectId, host, port }) => {
			const testing = await import("@firebase/rules-unit-testing");
			({ assertFails, assertSucceeds } = testing);
			({ doc, getDoc, setDoc, updateDoc } = await import("firebase/firestore"));
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
	await environment.clearFirestore();
	await environment.withSecurityRulesDisabled(async (context) => {
		const db = context.firestore();
		await Promise.all(
			["editor", "manager", "admin"].map((role) =>
				setDoc(doc(db, `users/${role}`), {
					role,
					appId: "tenant-a",
					name: "Synthetic user",
				}),
			),
		);
		for (const tenant of ["tenant-a", "tenant-b"]) {
			for (const collection of ["invoices", "payrollPeriods"]) {
				await setDoc(doc(db, tenantPath(tenant, collection)), {
					amount: 100,
					status: "open",
				});
			}
		}
	});
});

describe("client membership creation is never trusted provisioning", () => {
	it.each([
		["unprovisioned", "unprovisioned", { role: "editor", appId: "tenant-a" }],
		[
			"unprovisioned",
			"unprovisioned",
			{ role: "editor", appId: "arbitrary-tenant", extra: true },
		],
		["unprovisioned", "unprovisioned", { role: "admin", appId: "tenant-a" }],
		["editor", "another-user", { role: "editor", appId: "tenant-a" }],
		["admin", "another-user", { role: "editor", appId: "tenant-a" }],
	])("denies %s creating %s with %j", async (uid, target, data) => {
		await assertFails(setDoc(doc(dbFor(uid), `users/${target}`), data));
	});
});

describe("provisioned role and tenant boundaries", () => {
	it.each([
		"anonymous",
		"unprovisioned",
	])("denies all tenant reads to %s", async (uid) => {
		const db =
			uid === "anonymous"
				? environment.unauthenticatedContext().firestore()
				: dbFor(uid);
		for (const collection of ["invoices", "payrollPeriods"]) {
			await assertFails(getDoc(doc(db, tenantPath("tenant-a", collection))));
		}
	});
	it.each([
		"editor",
		"manager",
		"admin",
	])("preserves %s access and cross-tenant isolation", async (role) => {
		const db = dbFor(role);
		await assertSucceeds(getDoc(doc(db, `users/${role}`)));
		await assertSucceeds(getDoc(doc(db, tenantPath())));
		for (const collection of ["invoices", "payrollPeriods"]) {
			await assertFails(getDoc(doc(db, tenantPath("tenant-b", collection))));
			await assertFails(
				setDoc(doc(db, tenantPath("tenant-b", collection)), { amount: 50 }),
			);
			const ownWrite = setDoc(doc(db, tenantPath("tenant-a", collection)), {
				amount: 50,
			});
			await (role === "editor"
				? assertFails(ownWrite)
				: assertSucceeds(ownWrite));
		}
		const payrollRead = getDoc(
			doc(db, tenantPath("tenant-a", "payrollPeriods")),
		);
		await (role === "editor"
			? assertFails(payrollRead)
			: assertSucceeds(payrollRead));
	});
	it("preserves safe profile updates but denies role and tenant changes", async () => {
		const ref = doc(dbFor("editor"), "users/editor");
		await assertSucceeds(updateDoc(ref, { name: "Synthetic profile" }));
		await assertFails(updateDoc(ref, { role: "admin" }));
		await assertFails(updateDoc(ref, { appId: "tenant-b" }));
		await assertFails(getDoc(doc(dbFor("editor"), "users/manager")));
	});
	it("preserves the existing unrestricted admin registry update policy", async () => {
		await assertSucceeds(
			updateDoc(doc(dbFor("admin"), "users/editor"), { role: "manager" }),
		);
	});
	it("KNOWN RESIDUAL: generic manager grant still permits manual settlement", async () => {
		await assertSucceeds(
			updateDoc(doc(dbFor("manager"), tenantPath()), {
				status: "paid",
				amount: 0,
				forcedReconciliation: true,
				payments: [{ amount: 100, reconciliationMode: "manual-force" }],
			}),
		);
	});
	it("refuses application SDK initialization inside the harness", async () => {
		await expect(import("../services/firebase.js")).rejects.toMatchObject({
			cause: {
				message:
					"Unsafe emulator: application Firebase initialization is forbidden",
			},
		});
	});
});
