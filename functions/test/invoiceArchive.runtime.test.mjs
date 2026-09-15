import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import test from "node:test";
import {
  createArchiveRuntime,
  initializeArchiveRuntime,
} from "../src/invoiceArchive/runtime.mjs";

test("entrypoint discovery is SDK-inert and invocation without configuration fails closed", async () => {
  const { getApps } = await import("firebase-admin/app");
  assert.deepEqual(getApps(), []);
  const { invoicePdfArchive } = await import("../src/index.mjs");
  assert.deepEqual(getApps(), []);
  const endpoint = invoicePdfArchive.__endpoint;
  assert.deepEqual(endpoint.region, ["europe-west3"]);
  assert.equal(endpoint.availableMemoryMb, 512);
  assert.equal(endpoint.concurrency, 2);
  assert.equal(endpoint.maxInstances, 2);
  assert.equal(endpoint.timeoutSeconds, 60);
  await assert.rejects(invoicePdfArchive({ headers: {} }, {}), /configuration/i);
  assert.deepEqual(getApps(), []);
});

const tenantId = "1:123456789:web:demo";
const demo = {
  FUNCTIONS_EMULATOR: "true",
  GCLOUD_PROJECT: "demo-fincontrol",
  ARCHIVE_TENANT_ID: tenantId,
  ARCHIVE_BUCKET: "demo-fincontrol.appspot.com",
  FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
  FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
  FIREBASE_STORAGE_EMULATOR_HOST: "127.0.0.1:9199",
  STORAGE_EMULATOR_HOST: "http://127.0.0.1:9199",
};

function fixture() {
  const calls = [];
  const objects = new Map();
  let member = { appId: tenantId, role: "manager" };
  const auth = {
    async verifyIdToken(token, revoked) {
      calls.push(["verify", token, revoked]);
      return { uid: "member-1", firebase: { sign_in_provider: "password" } };
    },
  };
  const firestore = {
    doc(path) {
      calls.push(["membership", path]);
      return { async get() { return { exists: !!member, data: () => member }; } };
    },
  };
  const bucket = {
    file(name) {
      calls.push(["file", name]);
      return {
        interceptors: [],
        async save(bytes, options) {
          assert.equal(options.preconditionOpts.ifGenerationMatch, 0);
          if (objects.has(name)) throw Object.assign(new Error(), { code: 412 });
          objects.set(name, {
            bytes: Buffer.from(bytes),
            root: { ...options.metadata, generation: "1", metageneration: "1", size: String(bytes.length) },
          });
        },
        async getMetadata() { return [objects.get(name).root]; },
        createReadStream() { return Readable.from([objects.get(name).bytes]); },
      };
    },
  };
  const sdk = {
    initializeApp(options) { calls.push(["initialize", options]); return "app"; },
    getAuth(app) { assert.equal(app, "app"); return auth; },
    getFirestore(app) { assert.equal(app, "app"); return firestore; },
    getStorage(app) {
      assert.equal(app, "app");
      return { bucket(name) { calls.push(["bucket", name]); return bucket; } };
    },
  };
  return { calls, objects, auth, firestore, bucket, sdk, setMember(value) { member = value; } };
}

async function request(handler, method, url, rawBody) {
  const req = new EventEmitter();
  Object.assign(req, {
    method, url, rawBody, readableEnded: true,
    headers: { authorization: "Bearer trusted-token", "content-type": "application/pdf" },
    rawHeaders: ["Authorization", "Bearer trusted-token"],
  });
  const res = new EventEmitter();
  res.headers = {};
  res.setHeader = (name, value) => { res.headers[name] = value; };
  res.writeHead = (status, headers) => { res.status = status; Object.assign(res.headers, headers); };
  res.end = (bytes) => { res.bytes = bytes; };
  await handler(req, res);
  return res;
}

test("real composition uploads, deduplicates and reads using the selected tenant and bucket", async () => {
  const f = fixture();
  const handler = initializeArchiveRuntime(demo, f.sdk);
  assert.deepEqual(f.calls.slice(0, 2), [
    ["initialize", { projectId: "demo-fincontrol", storageBucket: demo.ARCHIVE_BUCKET }],
    ["bucket", demo.ARCHIVE_BUCKET],
  ]);
  const bytes = Buffer.from("%PDF-1.7\nsynthetic archive fixture");
  const uploaded = await request(handler, "POST", "/api/invoice-pdfs", bytes);
  assert.equal(uploaded.status, 200);
  const result = JSON.parse(uploaded.bytes);
  assert.deepEqual(Object.keys(result).sort(), ["mimeType", "sha256", "sizeBytes"]);
  assert.equal(f.objects.size, 1);
  assert.ok(f.objects.has(`invoice-pdfs/${tenantId}/${result.sha256}.pdf`));
  assert.equal((await request(handler, "POST", "/api/invoice-pdfs", bytes)).status, 200);
  const downloaded = await request(handler, "GET", `/api/invoice-pdfs/${result.sha256}`);
  assert.equal(downloaded.status, 200);
  assert.deepEqual(downloaded.bytes, bytes);
  assert.equal(downloaded.headers["Cache-Control"], "private, no-store");
  assert.ok(f.calls.filter(([kind]) => kind === "verify").every((call) => call[1] === "trusted-token" && call[2] === true));
  assert.equal(f.calls.filter(([kind]) => kind === "membership").length, 6);
  assert.ok(f.calls.filter(([kind]) => kind === "membership").every((call) => call[1] === "/users/member-1"));
});

test("membership is uncached; deletion and role/tenant changes deny before storage", async () => {
  const f = fixture();
  const handler = createArchiveRuntime({ tenantId, ...f });
  const bytes = Buffer.from("%PDF-1.7\nfixture");
  assert.equal((await request(handler, "POST", "/api/invoice-pdfs", bytes)).status, 200);
  for (const member of [null, { appId: tenantId, role: "editor" },
    { appId: "another-tenant", role: "admin" }, { tenantId, role: "admin" },
    { email: "admin@example.invalid", role: "admin" }]) {
    f.setMember(member);
    const before = f.calls.filter(([kind]) => kind === "file").length;
    assert.equal((await request(handler, "POST", "/api/invoice-pdfs", bytes)).status, 403);
    assert.equal(f.calls.filter(([kind]) => kind === "file").length, before);
  }
});

test("missing configuration and unsafe emulator routes fail before any SDK initialization", () => {
  const mutations = [
    ...Object.keys(demo).filter((key) => key !== "FUNCTIONS_EMULATOR").map((key) => [key, undefined]),
    ["GCLOUD_PROJECT", "real-project"], ["ARCHIVE_BUCKET", "real-project.appspot.com"],
    ["ARCHIVE_TENANT_ID", "another-tenant"],
    ["FIREBASE_AUTH_EMULATOR_HOST", "localhost:9099"],
    ["FIRESTORE_EMULATOR_HOST", "127.0.0.1:8081"],
    ["FIREBASE_STORAGE_EMULATOR_HOST", "http://127.0.0.1:9199"],
    ["STORAGE_EMULATOR_HOST", "127.0.0.1:9199"],
    ["STORAGE_EMULATOR_HOST", "https://storage.googleapis.com"],
  ];
  for (const [key, value] of mutations) {
    const f = fixture();
    assert.throws(() => initializeArchiveRuntime({ ...demo, [key]: value }, f.sdk), /configuration/i, key);
    assert.deepEqual(f.calls, [], key);
  }
  const f = fixture();
  assert.throws(() => initializeArchiveRuntime({ VITE_APP_ID: tenantId }, f.sdk), /configuration/i);
  assert.deepEqual(f.calls, []);
});

test("production configuration must be explicit and must not inherit emulator endpoints", () => {
  const f = fixture();
  const env = { GCLOUD_PROJECT: "synthetic-project", ARCHIVE_TENANT_ID: tenantId, ARCHIVE_BUCKET: "synthetic-bucket" };
  initializeArchiveRuntime(env, f.sdk);
  assert.deepEqual(f.calls[0][1], { projectId: env.GCLOUD_PROJECT, storageBucket: env.ARCHIVE_BUCKET });
  for (const key of ["GCLOUD_PROJECT", "ARCHIVE_TENANT_ID", "ARCHIVE_BUCKET"]) {
    assert.throws(() => initializeArchiveRuntime({ ...env, [key]: "" }, f.sdk), /configuration/i);
  }
  assert.throws(() => initializeArchiveRuntime({ ...env, STORAGE_EMULATOR_HOST: demo.STORAGE_EMULATOR_HOST }, f.sdk), /configuration/i);
});
