// End-to-end smoke test for the deployed-shape invoicePdfArchive Cloud
// Function against the local Firebase emulators (auth, firestore, storage,
// functions). Runs OUTSIDE the native `functions/test/*.test.mjs` glob (it
// lives one directory deeper) so `npm run test:archive` never picks it up.
//
// Deliberately uses only `node:test`, `node:assert` and the platform `fetch`
// — no Firebase client or admin SDK — to exercise exactly the HTTP surface a
// real caller behind the Hosting rewrite would see. Firebase Auth/Firestore
// emulator REST APIs create and seed the fixtures instead.
//
// Run via `npm run test:archive:runtime` (wraps this file with
// `firebase emulators:exec`, which supplies FIRESTORE_EMULATOR_HOST,
// FIREBASE_AUTH_EMULATOR_HOST, FIREBASE_STORAGE_EMULATOR_HOST and
// STORAGE_EMULATOR_HOST for every child process, including this one and the
// function runtime itself).
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, before, test } from "node:test";
import { withEmulatorSafety } from "../../../src/test/emulatorSafety.js";

const AUTH_BASE = "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1";
const FIRESTORE_BASE =
  "http://127.0.0.1:8080/v1/projects/demo-fincontrol/databases/(default)/documents";
const FUNCTION_BASE =
  "http://127.0.0.1:5001/demo-fincontrol/europe-west3/invoicePdfArchive";
const ROOT_PATH = "/api/invoice-pdfs";
const TENANT_ID = "1:123456789:web:demo";
const API_KEY = "fake-api-key";

const PDF = Buffer.from("%PDF-1.7\n<synthetic invoice>\n%%EOF");
const DIGEST = createHash("sha256").update(PDF).digest("hex");
// Well-formed (64 lowercase hex) but never archived.
const UNKNOWN_DIGEST = "0".repeat(64);

const users = {};

async function signUp(body) {
  const response = await fetch(`${AUTH_BASE}/accounts:signUp?key=${API_KEY}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ returnSecureToken: true, ...body }),
  });
  if (!response.ok) {
    throw new Error(`Auth emulator signUp failed: ${response.status}`);
  }
  return response.json();
}

async function deleteAccount(idToken) {
  await fetch(`${AUTH_BASE}/accounts:delete?key=${API_KEY}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ idToken }),
  });
}

async function seedMembership(uid, role) {
  const response = await fetch(`${FIRESTORE_BASE}/users/${uid}`, {
    method: "PATCH",
    headers: {
      authorization: "Bearer owner",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      fields: {
        appId: { stringValue: TENANT_ID },
        role: { stringValue: role },
      },
    }),
  });
  if (!response.ok) {
    throw new Error(`Firestore emulator seed failed for ${uid}: ${response.status}`);
  }
}

async function deleteMembership(uid) {
  await fetch(`${FIRESTORE_BASE}/users/${uid}`, {
    method: "DELETE",
    headers: { authorization: "Bearer owner" },
  });
}

function archiveRequest(path, { method = "GET", token, headers = {}, body } = {}) {
  const requestHeaders = { ...headers };
  if (token !== undefined) requestHeaders.authorization = `Bearer ${token}`;
  return fetch(`${FUNCTION_BASE}${path}`, { method, headers: requestHeaders, body });
}

// The first request cold-starts onInit(); poll instead of failing the first assertion.
async function waitForFunctionReady(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try {
      const response = await archiveRequest(ROOT_PATH);
      if (response.status === 403 || response.status === 405) return;
      last = `HTTP ${response.status}`;
    } catch (error) {
      last = error.message;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`invoicePdfArchive never became ready (last: ${last})`);
}

before(async () => {
  // Guard BEFORE any network call: fail loudly on an unsafe environment.
  await withEmulatorSafety(process.env, () => true, { requireStorage: true });

  await waitForFunctionReady(60_000);

  users.manager = await signUp({
    email: "smoke-manager@example.com",
    password: "smoke-test-pw1",
  });
  await seedMembership(users.manager.localId, "manager");

  users.editor = await signUp({
    email: "smoke-editor@example.com",
    password: "smoke-test-pw1",
  });
  await seedMembership(users.editor.localId, "editor");

  // No Firestore users/{uid} doc is ever written for this account.
  users.noMembership = await signUp({
    email: "smoke-no-membership@example.com",
    password: "smoke-test-pw1",
  });

  // No email/password -> Auth emulator provisions an anonymous session.
  users.anonymous = await signUp({});

  // Revocation is intentionally not exercised here: createArchiveAuthorizer's
  // checkRevoked=true path is already covered by the native
  // invoiceArchive.http.test.mjs suite (real authorizer/uploader/reader
  // composition test); this smoke test only proves the deployed-shape wiring.
}, { timeout: 90_000 });

after(async () => {
  await Promise.all(
    Object.values(users)
      .filter((user) => user?.idToken)
      .map((user) => deleteAccount(user.idToken)),
  );
  if (users.manager) await deleteMembership(users.manager.localId);
  if (users.editor) await deleteMembership(users.editor.localId);
  // The archived object is intentionally left in the Storage emulator;
  // `emulators:exec` tears down all emulator state on exit.
});

test("manager can archive a PDF", async () => {
  const response = await archiveRequest(ROOT_PATH, {
    method: "POST",
    token: users.manager.idToken,
    headers: { "content-type": "application/pdf" },
    body: PDF,
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    sha256: DIGEST,
    sizeBytes: PDF.length,
    mimeType: "application/pdf",
  });
});

test("re-uploading the identical PDF returns the same result", async () => {
  const response = await archiveRequest(ROOT_PATH, {
    method: "POST",
    token: users.manager.idToken,
    headers: { "content-type": "application/pdf" },
    body: PDF,
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    sha256: DIGEST,
    sizeBytes: PDF.length,
    mimeType: "application/pdf",
  });
});

test("manager can download the archived PDF with the expected headers", async () => {
  const response = await archiveRequest(`${ROOT_PATH}/${DIGEST}`, {
    token: users.manager.idToken,
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/pdf");
  assert.equal(
    response.headers.get("content-disposition"),
    `inline; filename="${DIGEST}.pdf"`,
  );
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.deepEqual(bytes, PDF);
});

test("downloading an unknown but well-formed digest fails closed", async () => {
  const response = await archiveRequest(`${ROOT_PATH}/${UNKNOWN_DIGEST}`, {
    token: users.manager.idToken,
  });
  // The emulated GCS SDK reports a missing object as an ApiError with a
  // numeric code 404. read.mjs maps that specific signal to
  // ArchiveReadError("notfound"), and http.mjs's fixed error table maps
  // that to 404 not-found — matching the native invoiceArchive.http.test.mjs
  // ("known core failures map to fixed codes") and invoiceArchive.read.test.mjs
  // ("a numeric 404 from the store is reported as a missing digest, not a
  // storage failure"). Any other storage failure still surfaces as 500.
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "not-found" });
});

test("editor role is denied on upload", async () => {
  const response = await archiveRequest(ROOT_PATH, {
    method: "POST",
    token: users.editor.idToken,
    headers: { "content-type": "application/pdf" },
    body: PDF,
  });
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "access-denied" });
});

test("editor role is denied on download of the archived digest", async () => {
  const response = await archiveRequest(`${ROOT_PATH}/${DIGEST}`, {
    token: users.editor.idToken,
  });
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "access-denied" });
});

test("a user with no membership document is denied", async () => {
  const response = await archiveRequest(ROOT_PATH, {
    method: "POST",
    token: users.noMembership.idToken,
    headers: { "content-type": "application/pdf" },
    body: PDF,
  });
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "access-denied" });
});

test("an anonymous session is denied", async () => {
  const response = await archiveRequest(ROOT_PATH, {
    method: "POST",
    token: users.anonymous.idToken,
    headers: { "content-type": "application/pdf" },
    body: PDF,
  });
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "access-denied" });
});

test("a missing Authorization header is denied", async () => {
  const response = await archiveRequest(ROOT_PATH, {
    method: "POST",
    headers: { "content-type": "application/pdf" },
    body: PDF,
  });
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "access-denied" });
});

test("the wrong Content-Type is rejected", async () => {
  const response = await archiveRequest(ROOT_PATH, {
    method: "POST",
    token: users.manager.idToken,
    headers: { "content-type": "text/plain" },
    body: PDF,
  });
  assert.equal(response.status, 415);
  assert.deepEqual(await response.json(), { error: "unsupported-media-type" });
});

test("non-PDF bytes under the PDF content type are rejected", async () => {
  const response = await archiveRequest(ROOT_PATH, {
    method: "POST",
    token: users.manager.idToken,
    headers: { "content-type": "application/pdf" },
    body: Buffer.from("this is not a pdf"),
  });
  // DEVIATION from the original brief (which expected 400 here): an invalid
  // PDF signature is upload.mjs's ArchiveUploadError("invalidpdf"), which
  // http.mjs maps to 415 unsupported-media-type — matching the native
  // end-to-end composition test in invoiceArchive.http.test.mjs
  // ("real authorizer/uploader/reader compose ... send({ body: Buffer.from
  // ("not a PDF") }) -> 415"). Verified against source, not assumed.
  assert.equal(response.status, 415);
  assert.deepEqual(await response.json(), { error: "unsupported-media-type" });
});

test("a trailing slash on the collection root is not found", async () => {
  const response = await archiveRequest(`${ROOT_PATH}/`);
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "not-found" });
});

test("PUT on the collection root is not allowed", async () => {
  const response = await archiveRequest(ROOT_PATH, { method: "PUT" });
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "GET, POST");
  assert.deepEqual(await response.json(), { error: "method-not-allowed" });
});
