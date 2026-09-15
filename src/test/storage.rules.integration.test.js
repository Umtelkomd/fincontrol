import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import process from "node:process";
import { withEmulatorSafety } from "./emulatorSafety.js";

const BUCKET = "gs://demo-fincontrol.appspot.com";
let environment, assertFails, assertSucceeds, doc, setDoc;
let ref,
	uploadBytes,
	getBytes,
	getMetadata,
	listAll,
	deleteObject,
	updateMetadata;
let sequence = 0;
let digest;
const pathFor = (hash = digest, tenant = "tenant-a") =>
	`invoice-pdfs/${tenant}/${hash}.pdf`;
const metadataFor = (uid = "manager", overrides = {}) => ({
	contentType: "application/pdf",
	customMetadata: {
		sha256: digest,
		uploaderUid: uid,
		originalName: "invoice.pdf",
	},
	...overrides,
});

// Assert actual SDK destinations, not merely initializeTestEnvironment arguments.
function clients(context) {
	const db = context.firestore();
	const storage = context.storage(BUCKET);
	expect(db._delegate._settings.host).toBe("127.0.0.1:8080");
	expect(db._delegate._settings.ssl).toBe(false);
	expect(storage._delegate.host).toBe("127.0.0.1:9199");
	expect(storage._delegate._protocol).toBe("http");
	expect(storage.ref().bucket).toBe("demo-fincontrol.appspot.com");
	return { db, storage };
}
const storageFor = (uid = "manager", claims = {}) =>
	clients(
		uid === null
			? environment.unauthenticatedContext()
			: environment.authenticatedContext(uid, claims),
	).storage;
const put = (storage, path = pathFor(), metadata = metadataFor(), size = 1) =>
	uploadBytes(ref(storage, path), new Uint8Array(size), metadata);
const denied = async (operation) => {
	const error = await assertFails(operation);
	expect(error.code).toBe("storage/unauthorized");
};
async function seed(path = pathFor()) {
	await environment.withSecurityRulesDisabled(async (context) => {
		await assertSucceeds(put(clients(context).storage, path));
	});
}

beforeAll(async () => {
	environment = await withEmulatorSafety(
		process.env,
		async ({ projectId, host, port }) => {
			const testing = await import("@firebase/rules-unit-testing");
			({ assertFails, assertSucceeds } = testing);
			({ doc, setDoc } = await import("firebase/firestore"));
			({
				ref,
				uploadBytes,
				getBytes,
				getMetadata,
				listAll,
				deleteObject,
				updateMetadata,
			} = await import("firebase/storage"));
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
				storage: {
					host,
					port: 9199,
					rules: await readFile(
						new URL("../../storage.rules", import.meta.url),
						"utf8",
					),
				},
			});
		},
		{ requireStorage: true },
	);
});
afterAll(async () => {
	await environment?.cleanup();
});
beforeEach(async () => {
	// Unique object names avoid privileged deletion and implicit/default bucket cleanup.
	digest = (++sequence).toString(16).padStart(64, "0");
	await environment.clearFirestore();
	await environment.withSecurityRulesDisabled(async (context) => {
		const { db } = clients(context);
		for (const role of ["manager", "admin", "editor"]) {
			await setDoc(doc(db, `users/${role}`), { appId: "tenant-a", role });
		}
		await setDoc(doc(db, "users/other-manager"), {
			appId: "tenant-b",
			role: "manager",
		});
	});
});

const principals = [
	["manager", "manager", {}],
	["admin", "admin", {}],
	["editor", "editor", {}],
	["other tenant manager", "other-manager", {}],
	["unauthenticated", null, {}],
	[
		"anonymous despite membership",
		"manager",
		{ firebase: { sign_in_provider: "anonymous" } },
	],
	["editor with admin claims", "editor", { role: "admin", appId: "tenant-a" }],
	[
		"unprovisioned with claims",
		"missing",
		{ role: "manager", appId: "tenant-a" },
	],
];

// These are access-boundary tests, not PDF/type/size/hash validation tests.
// Trusted fixtures bypass rules; they do not prove production IAM/token privacy.
describe.each(principals)(
	"no direct Storage access: %s",
	(_label, uid, claims) => {
		it.each([
			["invoice", () => pathFor()],
			["other tenant invoice", () => pathFor(digest, "tenant-b")],
			["nested invoice", () => `invoice-pdfs/tenant-a/nested/${digest}.pdf`],
			["unmatched path", () => `other/tenant-a/${digest}.pdf`],
		])("denies create for %s", async (_pathLabel, makePath) => {
			const path = makePath();
			await denied(
				put(storageFor(uid, claims), path, metadataFor(uid || "missing")),
			);
			await expectAbsent(path);
		});

		it.each([
			["invoice", () => pathFor()],
			["other tenant invoice", () => pathFor(digest, "tenant-b")],
			["nested invoice", () => `invoice-pdfs/tenant-a/nested/${digest}.pdf`],
			["unmatched path", () => `other/tenant-a/${digest}.pdf`],
		])(
			"denies reads, lists and mutations of trusted %s",
			async (_pathLabel, makePath) => {
				const path = makePath();
				await seed(path);
				const storage = storageFor(uid, claims);
				const object = ref(storage, path);
				await denied(getBytes(object));
				await denied(getMetadata(object));
				await denied(listAll(ref(storage, path.slice(0, path.lastIndexOf("/")))));
				await denied(listAll(ref(storage)));
				await denied(put(storage, path, metadataFor(uid || "missing")));
				await denied(updateMetadata(object, { contentType: "text/plain" }));
				await denied(
					updateMetadata(object, {
						customMetadata: { firebaseStorageDownloadTokens: "caller-supplied" },
					}),
				);
				await denied(deleteObject(object));
				await environment.withSecurityRulesDisabled(async (context) => {
					const trusted = ref(clients(context).storage, path);
					expect(new Uint8Array(await getBytes(trusted))).toEqual(
						new Uint8Array([0]),
					);
					expect((await getMetadata(trusted)).contentType).toBe("application/pdf");
				});
			},
		);

		it("denies token-metadata injection without creating an object", async () => {
			const metadata = metadataFor(uid || "missing");
			metadata.customMetadata.firebaseStorageDownloadTokens = "caller-supplied";
			await denied(put(storageFor(uid, claims), pathFor(), metadata));
			await expectAbsent(pathFor());
		});
	},
);

async function expectAbsent(path) {
	await environment.withSecurityRulesDisabled(async (context) => {
		await expect(
			getMetadata(ref(clients(context).storage, path)),
		).rejects.toMatchObject({
			code: "storage/object-not-found",
		});
	});
}

it("rejects both concurrent manager/admin creates without creating an object", async () => {
	const results = await Promise.allSettled([
		put(storageFor("manager")),
		put(storageFor("admin"), pathFor(), metadataFor("admin")),
	]);
	expect(results.map((result) => result.status)).toEqual([
		"rejected",
		"rejected",
	]);
	for (const result of results) {
		expect(result.reason.code).toBe("storage/unauthorized");
	}
	await expectAbsent(pathFor());
});
