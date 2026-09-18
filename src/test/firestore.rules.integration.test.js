import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import process from "node:process";
import { withEmulatorSafety } from "./emulatorSafety.js";

let environment, assertFails, assertSucceeds, deleteDoc, doc, getDoc, setDoc, updateDoc, Bytes;
const tenantPath = (tenant = "tenant-a", collection = "invoices") =>
	`artifacts/${tenant}/public/data/${collection}/synthetic-record`;
const dbFor = (uid) => environment.authenticatedContext(uid).firestore();

beforeAll(async () => {
	environment = await withEmulatorSafety(
		process.env,
		async ({ projectId, host, port }) => {
			const testing = await import("@firebase/rules-unit-testing");
			({ assertFails, assertSucceeds } = testing);
			({ deleteDoc, doc, getDoc, setDoc, updateDoc, Bytes } = await import("firebase/firestore"));
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
		// A manager provisioned under tenant-b, used only by the invoiceDocuments
		// cross-tenant isolation tests below.
		await setDoc(doc(db, "users/manager-b"), {
			role: "manager",
			appId: "tenant-b",
			name: "Synthetic user",
		});
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

// ─────────────────────────────────────────────
// invoiceDocuments — Firestore-chunk PDF archive (Spark plan has no Storage
// bucket, so bytes live in Firestore itself; see firestore.rules and
// src/features/facturas/lib/invoiceArchiveStore.js).
// ─────────────────────────────────────────────
describe("invoiceDocuments — Firestore-chunk archive rules", () => {
	const SHA = "a".repeat(64);
	const invoiceMetaPath = (tenant, sha256 = SHA) =>
		`artifacts/${tenant}/public/data/invoiceDocuments/${sha256}`;
	const invoiceChunkPath = (tenant, chunkId, sha256 = SHA) =>
		`artifacts/${tenant}/public/data/invoiceDocuments/${sha256}/chunks/${chunkId}`;

	const validMetadata = (overrides = {}) => ({
		sha256: SHA,
		sizeBytes: 1000,
		chunkBytes: 786432,
		chunkCount: 1,
		storage: "firestore-chunks-v1",
		...overrides,
	});

	const validChunk = (overrides = {}) => ({
		index: 0,
		sha256: SHA,
		bytes: Bytes.fromUint8Array(new Uint8Array(10)),
		...overrides,
	});

	it("denies editor read and write on both metadata and chunks", async () => {
		const db = dbFor("editor");
		await assertFails(getDoc(doc(db, invoiceMetaPath("tenant-a"))));
		await assertFails(setDoc(doc(db, invoiceMetaPath("tenant-a")), validMetadata()));
		await assertFails(getDoc(doc(db, invoiceChunkPath("tenant-a", "000"))));
		await assertFails(setDoc(doc(db, invoiceChunkPath("tenant-a", "000")), validChunk()));
	});

	it("lets a manager of the owning tenant create and read valid metadata and a chunk", async () => {
		const db = dbFor("manager");
		await assertSucceeds(setDoc(doc(db, invoiceMetaPath("tenant-a")), validMetadata()));
		await assertSucceeds(setDoc(doc(db, invoiceChunkPath("tenant-a", "000")), validChunk()));
		await assertSucceeds(getDoc(doc(db, invoiceMetaPath("tenant-a"))));
		await assertSucceeds(getDoc(doc(db, invoiceChunkPath("tenant-a", "000"))));
	});

	it("denies a manager of another tenant", async () => {
		const dbB = dbFor("manager-b");
		await assertFails(getDoc(doc(dbB, invoiceMetaPath("tenant-a"))));
		await assertFails(setDoc(doc(dbB, invoiceMetaPath("tenant-a")), validMetadata()));
	});

	it("denies a chunk over 786432 bytes", async () => {
		const db = dbFor("manager");
		await assertFails(
			setDoc(
				doc(db, invoiceChunkPath("tenant-a", "000")),
				validChunk({ bytes: Bytes.fromUint8Array(new Uint8Array(786433)) }),
			),
		);
	});

	it("denies metadata with sizeBytes over 2 MiB", async () => {
		const db = dbFor("manager");
		await assertFails(
			setDoc(
				doc(db, invoiceMetaPath("tenant-a")),
				validMetadata({ sizeBytes: 2 * 1024 * 1024 + 1 }),
			),
		);
	});

	it("denies metadata whose sha256 field differs from its document id", async () => {
		const db = dbFor("manager");
		await assertFails(
			setDoc(doc(db, invoiceMetaPath("tenant-a")), validMetadata({ sha256: "b".repeat(64) })),
		);
	});

	it("denies metadata with the wrong storage tag", async () => {
		const db = dbFor("manager");
		await assertFails(
			setDoc(doc(db, invoiceMetaPath("tenant-a")), validMetadata({ storage: "legacy-http" })),
		);
	});

	it("denies a chunk whose sha256 does not match its parent document id", async () => {
		const db = dbFor("manager");
		await assertFails(
			setDoc(doc(db, invoiceChunkPath("tenant-a", "000")), validChunk({ sha256: "b".repeat(64) })),
		);
	});

	it("denies chunk index 3 (out of the 0-2 range for a 2 MiB cap)", async () => {
		const db = dbFor("manager");
		await assertFails(
			setDoc(doc(db, invoiceChunkPath("tenant-a", "003")), validChunk({ index: 3 })),
		);
	});

	it("denies the generic tenant-write grant from bypassing invoiceDocuments validation", async () => {
		const db = dbFor("manager");
		await assertFails(
			setDoc(doc(db, invoiceMetaPath("tenant-a")), { anything: "goes", no: "validation" }),
		);
	});

	// T13: correcting an archived invoice (EDIT/REPLACE/DELETE) needs
	// update/delete on both the metadata doc and its chunks — append-only was
	// the whole archive's behaviour before this feature, so these rules had
	// no update/delete coverage at all.
	describe("update and delete (T13: correcting an archived invoice)", () => {
		const seed = async () => {
			await environment.withSecurityRulesDisabled(async (context) => {
				const db = context.firestore();
				await setDoc(doc(db, invoiceMetaPath("tenant-a")), validMetadata());
				await setDoc(doc(db, invoiceChunkPath("tenant-a", "000")), validChunk());
			});
		};

		it("lets a manager of the owning tenant update metadata that still satisfies validInvoiceMetadata", async () => {
			await seed();
			const db = dbFor("manager");
			await assertSucceeds(
				updateDoc(doc(db, invoiceMetaPath("tenant-a")), { counterpartyName: "Nuevo nombre" }),
			);
		});

		it("lets an admin of the owning tenant delete the metadata doc", async () => {
			await seed();
			const db = dbFor("admin");
			await assertSucceeds(deleteDoc(doc(db, invoiceMetaPath("tenant-a"))));
		});

		it("denies an editor from updating or deleting metadata", async () => {
			await seed();
			const db = dbFor("editor");
			await assertFails(updateDoc(doc(db, invoiceMetaPath("tenant-a")), { counterpartyName: "x" }));
			await assertFails(deleteDoc(doc(db, invoiceMetaPath("tenant-a"))));
		});

		it("denies a manager of another tenant from updating or deleting metadata", async () => {
			await seed();
			const dbB = dbFor("manager-b");
			await assertFails(updateDoc(doc(dbB, invoiceMetaPath("tenant-a")), { counterpartyName: "x" }));
			await assertFails(deleteDoc(doc(dbB, invoiceMetaPath("tenant-a"))));
		});

		it("denies an update that would break validInvoiceMetadata (chunkCount out of range)", async () => {
			await seed();
			const db = dbFor("manager");
			await assertFails(updateDoc(doc(db, invoiceMetaPath("tenant-a")), { chunkCount: 0 }));
			await assertFails(updateDoc(doc(db, invoiceMetaPath("tenant-a")), { chunkCount: 4 }));
		});

		it("denies an update that changes the storage tag away from firestore-chunks-v1", async () => {
			await seed();
			const db = dbFor("manager");
			await assertFails(updateDoc(doc(db, invoiceMetaPath("tenant-a")), { storage: "legacy-http" }));
		});

		it("lets a manager of the owning tenant update and delete a chunk", async () => {
			await seed();
			const db = dbFor("manager");
			await assertSucceeds(
				updateDoc(doc(db, invoiceChunkPath("tenant-a", "000")), { bytes: Bytes.fromUint8Array(new Uint8Array(20)) }),
			);
			await assertSucceeds(deleteDoc(doc(db, invoiceChunkPath("tenant-a", "000"))));
		});

		it("denies an editor and a cross-tenant manager from updating or deleting a chunk", async () => {
			await seed();
			const editorDb = dbFor("editor");
			await assertFails(updateDoc(doc(editorDb, invoiceChunkPath("tenant-a", "000")), { index: 0 }));
			await assertFails(deleteDoc(doc(editorDb, invoiceChunkPath("tenant-a", "000"))));

			const dbB = dbFor("manager-b");
			await assertFails(updateDoc(doc(dbB, invoiceChunkPath("tenant-a", "000")), { index: 0 }));
			await assertFails(deleteDoc(doc(dbB, invoiceChunkPath("tenant-a", "000"))));
		});

		it("denies a chunk update that would break validInvoiceChunk (over the byte cap)", async () => {
			await seed();
			const db = dbFor("manager");
			await assertFails(
				updateDoc(doc(db, invoiceChunkPath("tenant-a", "000")), {
					bytes: Bytes.fromUint8Array(new Uint8Array(786433)),
				}),
			);
		});
	});
});
