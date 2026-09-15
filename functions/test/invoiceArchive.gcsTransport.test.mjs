import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";
import { CRC32C, Storage } from "@google-cloud/storage";
import { createGcsArchiveStore } from "../src/invoiceArchive/gcsStore.mjs";

// Wire contract only: this scripted HTTP peer is NOT a GCS emulator and proves
// neither cloud atomicity nor IAM/privacy. No SDK/file/stream transport is mocked.
// Run only with the documented env -i command; refuse ambient SDK/proxy config.
const allowedEnv = new Set([
  "HOME",
  "PATH",
  "CI",
  "NODE_TEST_CONTEXT",
  "NODE_TEST_WORKER_ID",
  "__CF_USER_TEXT_ENCODING", // macOS adds this even under env -i.
]);
assert.deepEqual(
  Object.keys(process.env).filter((key) => !allowedEnv.has(key)),
  [],
  "Run this test with the authorized sanitized environment (unexpected keys only)",
);

const BUCKET = "demo-fincontrol-archive-contract";
const BYTES = Buffer.from("%PDF-1.7\nsynthetic archive contract\n%%EOF\n");
const DIGEST = createHash("sha256").update(BYTES).digest("hex");
const OBJECT = `invoice-pdfs/demo-tenant/${DIGEST}.pdf`;
const GENERATION = "9007199254740993";
const META_GENERATION = "9007199254740995";
const UPLOAD_PATH = `/upload/storage/v1/b/${BUCKET}/o`;
const OBJECT_PATH = `/storage/v1/b/${BUCKET}/o/${encodeURIComponent(OBJECT)}`;
const PROVENANCE = Object.freeze({
  archiveVersion: "1",
  tenantId: "demo-tenant",
  sha256: DIGEST,
  sizeBytes: String(BYTES.length),
  mimeType: "application/pdf",
});

function crc32c(bytes) {
  const hash = new CRC32C();
  hash.update(bytes);
  return hash.toString();
}

function root(overrides = {}) {
  return {
    name: OBJECT,
    bucket: BUCKET,
    generation: GENERATION,
    metageneration: META_GENERATION,
    size: String(BYTES.length),
    contentType: "application/pdf",
    cacheControl: "private, no-store",
    contentEncoding: "identity",
    crc32c: crc32c(BYTES),
    metadata: { ...PROVENANCE },
    ...overrides,
  };
}

function jsonResponse(response, body, status = 200) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

function metadataStep({ pinned = false, overrides = {} } = {}) {
  return {
    method: "GET",
    path: OBJECT_PATH,
    query: pinned ? { generation: GENERATION } : {},
    respond: (response) => jsonResponse(response, root(overrides)),
  };
}

function mediaStep({ bytes = BYTES, hash = crc32c(bytes), status = 200 } = {}) {
  return {
    method: "GET",
    path: OBJECT_PATH,
    query: { alt: "media", generation: GENERATION },
    async respond(response) {
      if (status !== 200) {
        jsonResponse(
          response,
          { error: { code: status, message: "Fixture precondition failed" } },
          status,
        );
        return;
      }
      // Both headers are necessary to exercise the SDK's default CRC validator.
      // Deliberately chunked: do not rely on Content-Length to enforce the bound.
      response.writeHead(200, {
        "Content-Type": "application/pdf",
        "x-goog-stored-content-encoding": "identity",
        "x-goog-hash": `crc32c=${hash}`,
      });
      response.write(bytes.subarray(0, 8));
      await new Promise((resolve) => setImmediate(resolve));
      if (!response.destroyed) response.end(bytes.subarray(8));
    },
  };
}

function uploadStep(status = 200) {
  return {
    method: "POST",
    path: UPLOAD_PATH,
    query: { name: OBJECT, uploadType: "multipart", ifGenerationMatch: "0" },
    respond(response) {
      jsonResponse(
        response,
        status === 200
          ? root()
          : {
              error: {
                code: status,
                message: "Fixture object already exists",
                errors: [
                  {
                    reason: "conditionNotMet",
                    message: "Fixture object already exists",
                  },
                ],
              },
            },
        status,
      );
    },
  };
}

function loopbackUrl(uri, endpoint) {
  const url = new URL(uri);
  assert.equal(url.protocol, "http:");
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.origin, endpoint);
  assert.equal(url.username, "");
  assert.equal(url.password, "");
  assert.equal(url.hash, "");
  return url;
}

function queryEntries(query) {
  return Object.entries(query).sort(([a], [b]) => a.localeCompare(b));
}

async function withPeer(steps, exercise) {
  const requests = [];
  const violations = [];
  let endpoint;
  const server = createServer(async (request, response) => {
    try {
      assert.equal(request.socket.remoteAddress, "127.0.0.1");
      assert.equal(request.headers.host, new URL(endpoint).host);
      assert.ok(
        request.url.startsWith("/"),
        "Only origin-form requests allowed",
      );
      const url = loopbackUrl(new URL(request.url, endpoint).href, endpoint);
      const chunks = [];
      let length = 0;
      for await (const chunk of request) {
        length += chunk.length;
        assert.ok(length <= 64 * 1024, "Unexpectedly large fixture request");
        chunks.push(chunk);
      }
      const captured = {
        method: request.method,
        url,
        headers: request.headers,
        body: Buffer.concat(chunks),
      };
      const step = steps[requests.length];
      requests.push(captured);
      assert.ok(step, "Unexpected extra request/retry");
      assert.equal(captured.method, step.method, "Unexpected HTTP method");
      assert.equal(url.pathname, step.path, "Unexpected route");
      // Compare entries, not Object.fromEntries: duplicate query keys must fail.
      assert.deepEqual(
        [...url.searchParams].sort(([a], [b]) => a.localeCompare(b)),
        queryEntries(step.query),
      );
      for (const key of Object.keys(request.headers)) {
        assert.doesNotMatch(
          key,
          /authorization|cookie|token|acl|encryption|user-project/i,
        );
      }
      if (step.method === "GET") {
        assert.equal(length, 0);
        assert.equal(request.headers.range, undefined);
      }
      await step.respond(response);
    } catch (error) {
      violations.push(error);
      // Unknown methods/routes/shapes fail closed, with no redirect or retryable 5xx.
      if (!response.headersSent)
        jsonResponse(
          response,
          { error: { code: 400, message: "Unexpected contract request" } },
          400,
        );
      else response.destroy();
    }
  });
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    endpoint = `http://127.0.0.1:${server.address().port}`;
    loopbackUrl(endpoint, endpoint);
    // Installed 7.21.0 storage.js marks apiEndpoint as custom. Its
    // nodejs-common/util.js prepareRequest returns the explicit project ID and
    // skips authorizeRequest when useAuthWithCustomEndpoint is false.
    // GoogleAuth's constructor only assigns options; no ADC discovery occurs.
    const storage = new Storage({
      projectId: "demo-fincontrol",
      apiEndpoint: endpoint,
      useAuthWithCustomEndpoint: false,
      timeout: 2000,
    });
    assert.equal(storage.packageJson.version, "7.21.0");
    assert.equal(storage.customEndpoint, true);
    assert.equal(storage.useAuthWithCustomEndpoint, false);
    assert.equal(storage.projectId, "demo-fincontrol");
    assert.equal(storage.baseUrl, `${endpoint}/storage/v1`);
    // Tripwires, not replacement credentials: any auth/discovery attempt fails
    // before it can consult HOME, the environment, or a metadata server.
    let authAttempts = 0;
    for (const method of [
      "getProjectId",
      "getClient",
      "getApplicationDefault",
      "getCredentials",
      "authorizeRequest",
    ]) {
      storage.authClient[method] = () => {
        authAttempts++;
        throw new Error("Authentication/discovery forbidden in transport test");
      };
    }
    let guardedRequests = 0;
    storage.interceptors.push({
      request(options) {
        loopbackUrl(options.uri, endpoint);
        guardedRequests++;
        return options; // Never add generation/preconditions or repair SDK options.
      },
    });
    const bucket = storage.bucket(BUCKET);
    const store = createGcsArchiveStore({ bucket });
    await exercise({ store, requests });
    assert.equal(authAttempts, 0);
    assert.equal(guardedRequests, requests.length);
  } finally {
    const closed = server.listening
      ? new Promise((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        })
      : Promise.resolve();
    server.closeAllConnections();
    await closed;
    assert.deepEqual(violations, [], "HTTP fixture rejected a wire contract");
    assert.equal(
      requests.length,
      steps.length,
      "Expected complete request sequence",
    );
  }
}

function assertMultipart(request) {
  const match = /^multipart\/related; boundary=([^;]+)$/.exec(
    request.headers["content-type"],
  );
  assert.ok(match, "Must use JSON multipart upload, not resumable transport");
  const boundary = match[1];
  const body = request.body.toString("latin1");
  const parts = body.split(`--${boundary}`);
  assert.equal(parts.length, 4);
  assert.equal(parts[0], "");
  assert.equal(parts[3], "--");
  const metadataPrefix = "\r\nContent-Type: application/json\r\n\r\n";
  assert.ok(parts[1].startsWith(metadataPrefix));
  assert.ok(parts[1].endsWith("\r\n"));
  assert.deepEqual(JSON.parse(parts[1].slice(metadataPrefix.length, -2)), {
    contentType: "application/pdf",
    cacheControl: "private, no-store",
    metadata: PROVENANCE,
  }); // Exact root/custom keys exclude tokens, ACLs and unexpected encoding.
  const bytesPrefix = "\r\nContent-Type: application/pdf\r\n\r\n";
  assert.ok(parts[2].startsWith(bytesPrefix));
  assert.ok(parts[2].endsWith("\r\n"));
  assert.deepEqual(
    Buffer.from(parts[2].slice(bytesPrefix.length, -2), "latin1"),
    BYTES,
  );
  assert.equal(request.headers["content-encoding"], undefined);
}

const create = (store) =>
  store.createOnly({ objectName: OBJECT, bytes: BYTES, metadata: PROVENANCE });
const read = (store) =>
  store.readSnapshot({ objectName: OBJECT, maxBytes: BYTES.length });

async function rejectsWithoutSnapshot(store, expected) {
  let escaped;
  await assert.rejects(async () => {
    escaped = await read(store);
  }, expected);
  assert.equal(
    escaped,
    undefined,
    "Neither body nor metadata may escape a failed snapshot",
  );
}

test("real SDK uploads fixed private provenance with create-only multipart query", {
  timeout: 10000,
}, async () => {
  await withPeer([uploadStep()], async ({ store, requests }) => {
    await create(store);
    assertMultipart(requests[0]);
  });
});

test("upload HTTP 412 remains numeric 412 and never retries unconditionally", {
  timeout: 10000,
}, async () => {
  await withPeer([uploadStep(412)], async ({ store, requests }) => {
    await assert.rejects(create(store), (error) => {
      assert.equal(typeof error.code, "number");
      assert.equal(error.code, 412);
      return true;
    });
    assertMultipart(requests[0]);
  });
});

test("large generation pins media AND recheck; a second read starts unpinned", {
  timeout: 10000,
}, async () => {
  assert.notEqual(
    String(Number(GENERATION)),
    GENERATION,
    "Fixture must detect numeric coercion",
  );
  const sequence = () => [
    metadataStep(),
    mediaStep(),
    metadataStep({ pinned: true }),
  ];
  await withPeer(
    [...sequence(), ...sequence()],
    async ({ store, requests }) => {
      for (let attempt = 0; attempt < 2; attempt++) {
        const snapshot = await read(store);
        assert.deepEqual(snapshot, {
          bytes: BYTES,
          metadata: PROVENANCE,
          generation: GENERATION,
        });
        assert.notStrictEqual(snapshot.bytes, BYTES);
        assert.equal(typeof snapshot.generation, "string");
      }
      for (const index of [1, 2, 4, 5]) {
        assert.equal(
          requests[index].url.searchParams.get("generation"),
          GENERATION,
        );
      }
    },
  );
});

test("media HTTP 412 rejects without returning a snapshot or rechecking metadata", {
  timeout: 10000,
}, async () => {
  await withPeer(
    [metadataStep(), mediaStep({ status: 412 })],
    async ({ store }) => {
      await rejectsWithoutSnapshot(store, { code: 412 });
    },
  );
});

test("pinned metadata HTTP 412 rejects even after the complete media body", {
  timeout: 10000,
}, async () => {
  const recheck = metadataStep({ pinned: true });
  recheck.respond = (response) =>
    jsonResponse(
      response,
      {
        error: { code: 412, message: "Fixture metadata precondition failed" },
      },
      412,
    );
  await withPeer([metadataStep(), mediaStep(), recheck], async ({ store }) => {
    await rejectsWithoutSnapshot(store, { code: 412 });
  });
});

for (const [label, overrides] of [
  ["metageneration edit/revert", { metageneration: "9007199254740996" }],
  [
    "provenance change",
    { metadata: { ...PROVENANCE, tenantId: "different-tenant" } },
  ],
  ["generation change", { generation: "9007199254740997" }],
]) {
  test(`pinned metadata recheck rejects ${label} without exposing bytes`, {
    timeout: 10000,
  }, async () => {
    await withPeer(
      [metadataStep(), mediaStep(), metadataStep({ pinned: true, overrides })],
      async ({ store }) => {
        await rejectsWithoutSnapshot(
          store,
          /Archive metadata changed during read/,
        );
      },
    );
  });
}

for (const [label, bytes, expected] of [
  [
    "overflow",
    Buffer.concat([BYTES, Buffer.from("extra")]),
    /Archive stream exceeds declared size/,
  ],
  ["underflow", BYTES.subarray(0, -1), /Archive stream size mismatch/],
]) {
  test(`bounded stream rejects ${label} even with a valid response CRC`, {
    timeout: 10000,
  }, async () => {
    await withPeer(
      [metadataStep(), mediaStep({ bytes })],
      async ({ store }) => {
        await rejectsWithoutSnapshot(store, expected);
      },
    );
  });
}

test("SDK CRC32C validation rejects corrupt media before any snapshot escapes", {
  timeout: 10000,
}, async () => {
  await withPeer(
    [metadataStep(), mediaStep({ hash: crc32c(Buffer.from("wrong")) })],
    async ({ store }) => {
      await rejectsWithoutSnapshot(store, {
        code: "CONTENT_DOWNLOAD_MISMATCH",
      });
    },
  );
});

test("metadata above the byte limit rejects before opening a media request", {
  timeout: 10000,
}, async () => {
  await withPeer(
    [metadataStep({ overrides: { size: String(BYTES.length + 1) } })],
    async ({ store }) => {
      await rejectsWithoutSnapshot(store, /Invalid archive size/);
    },
  );
});
