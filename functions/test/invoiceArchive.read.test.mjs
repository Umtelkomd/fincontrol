import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  ArchiveReadError,
  createArchiveReader,
} from "../src/invoiceArchive/read.mjs";
import { createArchiveUploader } from "../src/invoiceArchive/upload.mjs";

const PDF = Buffer.from("%PDF-1.7\nfixture\n%%EOF");
const LIMIT = 20 * 1024 * 1024;
const TENANT = "1:123456:web:abcdef";
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const HASH = digest(PDF);
const CONTEXT = { uid: "member-a", role: "manager", tenantId: TENANT };
const objectName = (tenant = TENANT, hash = HASH) =>
  `invoice-pdfs/${tenant}/${hash}.pdf`;

function snapshot(bytes = PDF, tenantId = TENANT) {
  return {
    bytes: Buffer.from(bytes),
    generation: "1",
    metadata: {
      archiveVersion: "1",
      tenantId,
      sha256: digest(bytes),
      sizeBytes: String(bytes.length),
      mimeType: "application/pdf",
    },
  };
}

function fixture(context = CONTEXT, value = snapshot()) {
  const calls = { auth: [], reads: [] };
  const store = {
    value,
    async readSnapshot(request) {
      calls.reads.push(request);
      return this.value;
    },
  };
  const authorize = async (header) => {
    calls.auth.push(header);
    return context;
  };
  return { calls, store, authorize };
}
const request = (read, sha256 = HASH) =>
  read({ authorization: "Bearer fixture", sha256 });
const code = (expected) => (error) => {
  assert.ok(error instanceof ArchiveReadError);
  assert.equal(error.code, expected);
  assert.equal(error.message, expected);
  assert.equal(error.cause, undefined);
  assert.deepEqual(Object.keys(error).sort(), ["code", "name"]);
  return true;
};

test("returns only owned verified bytes and ignores caller storage coordinates", async () => {
  const f = fixture();
  const result = await createArchiveReader(f)({
    authorization: "Bearer fixture",
    sha256: HASH,
    tenantId: "attacker",
    objectName: "attacker/file",
    filename: "secret.pdf",
  });
  assert.ok(Buffer.isBuffer(result));
  assert.deepEqual(result, PDF);
  assert.notEqual(result, f.store.value.bytes);
  assert.deepEqual(f.calls.auth, ["Bearer fixture"]);
  assert.deepEqual(f.calls.reads, [
    { objectName: objectName(), maxBytes: LIMIT },
  ]);
  result[0] = 0;
  assert.deepEqual(f.store.value.bytes, PDF);
  f.store.value.bytes[1] = 0;
  assert.equal(result[1], PDF[1]);
});

test("validates dependencies at construction", () => {
  for (const options of [
    undefined,
    {},
    { authorize: 1, store: fixture().store },
    { authorize() {}, store: {} },
    { authorize() {}, store: { readSnapshot: 1 } },
  ]) {
    assert.throws(() => createArchiveReader(options), TypeError);
  }
});

test("authorizes every request, including revocation and malformed digests", async () => {
  const f = fixture();
  const denial = Object.assign(new Error("accessdenied"), {
    code: "accessdenied",
  });
  let revoked = false;
  const read = createArchiveReader({
    store: f.store,
    authorize: async (header) => {
      f.calls.auth.push(header);
      if (revoked) throw denial;
      return CONTEXT;
    },
  });
  await request(read);
  revoked = true;
  for (const sha256 of [HASH, "bad"]) {
    await assert.rejects(request(read, sha256), (error) => error === denial);
  }
  assert.deepEqual(f.calls.auth, Array(3).fill("Bearer fixture"));
  assert.equal(f.calls.reads.length, 1);
});

test("waits for authorization before any read", async () => {
  const f = fixture();
  const { promise, resolve } = Promise.withResolvers();
  const pending = request(
    createArchiveReader({ ...f, authorize: () => promise }),
  );
  await Promise.resolve();
  assert.equal(f.calls.reads.length, 0);
  resolve(CONTEXT);
  await pending;
  assert.equal(f.calls.reads.length, 1);
});

test("rejects malformed digests after authorization without store IO", async () => {
  for (const sha256 of [
    null,
    123,
    {},
    "",
    HASH.toUpperCase(),
    HASH.slice(1),
    `${HASH}0`,
    `${HASH}\n`,
    `../${HASH}`,
    "g".repeat(64),
  ]) {
    const f = fixture();
    await assert.rejects(
      request(createArchiveReader(f), sha256),
      code("invaliddigest"),
    );
    assert.equal(f.calls.auth.length, 1);
    assert.equal(f.calls.reads.length, 0);
  }
  const f = fixture();
  await assert.rejects(createArchiveReader(f)(), code("invaliddigest"));
  assert.deepEqual(f.calls.auth, [undefined]);
  assert.equal(f.calls.reads.length, 0);
});

test("rejects malformed authorized context without store IO", async () => {
  for (const context of [
    null,
    {},
    { ...CONTEXT, uid: " " },
    { ...CONTEXT, role: "" },
    ...[
      null,
      1,
      "",
      ".",
      "..",
      "a/b",
      "a\\b",
      "a\n",
      "a\0",
      "a\x7f",
      "a b",
    ].map((tenantId) => ({ ...CONTEXT, tenantId })),
  ]) {
    const f = fixture(context);
    await assert.rejects(request(createArchiveReader(f)), code("accessdenied"));
    assert.equal(f.calls.auth.length, 1);
    assert.equal(f.calls.reads.length, 0);
  }
});

test("uses distinct authorized tenant paths for identical digests", async () => {
  for (const tenantId of [TENANT, "another:tenant"]) {
    const f = fixture({ ...CONTEXT, tenantId }, snapshot(PDF, tenantId));
    assert.deepEqual(await request(createArchiveReader(f)), PDF);
    assert.deepEqual(f.calls.reads, [
      { objectName: objectName(tenantId), maxBytes: LIMIT },
    ]);
  }
});

test("missing snapshots and read failures expose no SDK details or bytes", async () => {
  for (const value of [undefined, null]) {
    const f = fixture();
    f.store.value = value;
    await assert.rejects(request(createArchiveReader(f)), code("invalidblob"));
  }
  for (const failure of [
    new Error("private SDK detail"),
    null,
    { code: "404" },
    { code: 404.5 },
    { code: -404 },
  ]) {
    const f = fixture();
    f.store.readSnapshot = async () => {
      throw failure;
    };
    await assert.rejects(
      request(createArchiveReader(f)),
      code("storagefailure"),
    );
  }
});

test("a numeric 404 from the store is reported as a missing digest, not a storage failure", async () => {
  const f = fixture();
  f.store.readSnapshot = async () => {
    throw { code: 404, bucket: "private" };
  };
  await assert.rejects(request(createArchiveReader(f)), code("notfound"));
});

test("rejects nonbytes, empty, oversized, corrupted, and non-PDF bodies", async () => {
  for (const bytes of [
    undefined,
    null,
    [...PDF],
    PDF.toString(),
    new ArrayBuffer(5),
    new Uint16Array(5),
    Buffer.alloc(0),
    Buffer.alloc(LIMIT + 1),
    Buffer.from("%PDF-1.7\ncorrupt\n%%EOF"),
    PDF.subarray(0, PDF.length - 1),
  ]) {
    const f = fixture();
    f.store.value.bytes = bytes;
    await assert.rejects(request(createArchiveReader(f)), code("invalidblob"));
  }
  // Matching hash/provenance cannot legitimize a missing PDF signature.
  for (const bytes of [
    Buffer.from("NOT-PDF"),
    Buffer.from("%PDF"),
    Buffer.from(" %PDF-"),
  ]) {
    const f = fixture(CONTEXT, snapshot(bytes));
    await assert.rejects(
      request(createArchiveReader(f), digest(bytes)),
      code("invalidblob"),
    );
  }
  await assert.rejects(
    request(createArchiveReader(fixture()), "0".repeat(64)),
    code("invalidblob"),
  );
});

test("requires exact custom provenance, including hidden and symbol keys", async () => {
  const changes = [
    ...Object.keys(snapshot().metadata).flatMap((key) => [
      (s) => {
        s.metadata[key] = "wrong";
      },
      (s) => {
        delete s.metadata[key];
      },
    ]),
    (s) => {
      s.metadata.sizeBytes = PDF.length;
    },
    (s) => {
      s.metadata = null;
    },
    (s) => {
      s.metadata = Object.create(s.metadata);
    },
    (s) => {
      s.metadata.firebaseStorageDownloadTokens = "forbidden";
    },
    (s) => {
      s.metadata.actor = "member-a";
    },
    (s) => {
      s.metadata[Symbol("extra")] = "forbidden";
    },
    (s) => {
      Object.defineProperty(s.metadata, "hidden", { value: "forbidden" });
    },
    (s) => {
      Object.defineProperty(s, "metadata", {
        get() {
          throw new Error("private");
        },
      });
    },
  ];
  for (const change of changes) {
    const f = fixture();
    change(f.store.value);
    await assert.rejects(request(createArchiveReader(f)), code("invalidblob"));
  }
});

test("validates positive canonical generations", async () => {
  for (const generation of [
    undefined,
    null,
    "",
    "0",
    "01",
    "-1",
    "1.5",
    "abc",
    "1\n",
    0,
    -1,
    1.5,
    NaN,
    Infinity,
    Number.MAX_SAFE_INTEGER + 1,
    {},
    1n,
  ]) {
    const f = fixture();
    f.store.value.generation = generation;
    await assert.rejects(request(createArchiveReader(f)), code("invalidblob"));
  }
  for (const generation of [
    1,
    Number.MAX_SAFE_INTEGER,
    "18446744073709551615",
  ]) {
    const f = fixture();
    f.store.value.generation = generation;
    assert.deepEqual(await request(createArchiveReader(f)), PDF);
  }
});

test("accepts signature-only and exactly 20 MiB PDFs; copies only the typed array view", async () => {
  for (const bytes of [Buffer.from("%PDF-"), Buffer.alloc(LIMIT)]) {
    bytes.set(Buffer.from("%PDF-"));
    const f = fixture(CONTEXT, snapshot(bytes));
    assert.deepEqual(
      await request(createArchiveReader(f), digest(bytes)),
      bytes,
    );
  }
  const f = fixture();
  const wrapped = Buffer.concat([
    Buffer.from("prefix"),
    PDF,
    Buffer.from("suffix"),
  ]);
  f.store.value.bytes = new Uint8Array(
    wrapped.buffer,
    wrapped.byteOffset + 6,
    PDF.length,
  );
  assert.deepEqual(await request(createArchiveReader(f)), PDF);
});

test("copies store bytes before accessing provenance or generation", async () => {
  const f = fixture();
  Object.defineProperty(f.store.value, "generation", {
    get() {
      f.store.value.bytes.fill(0);
      return "1";
    },
  });
  assert.deepEqual(await request(createArchiveReader(f)), PDF);
});

test("real uploader and reader roundtrip through an in-memory conditional store", async () => {
  // Models atomic create-only and pinned snapshots, not cloud transport or IAM.
  const objects = new Map();
  const store = {
    async createOnly({ objectName, bytes, metadata }) {
      if (objects.has(objectName)) throw { code: 412 };
      objects.set(objectName, {
        bytes: Buffer.from(bytes),
        metadata: { ...metadata },
        generation: "1",
      });
    },
    async readSnapshot({ objectName, maxBytes }) {
      const value = objects.get(objectName);
      if (value?.bytes.length > maxBytes) throw new Error("limit");
      return value;
    },
  };
  const options = { store, authorize: async () => CONTEXT };
  const upload = createArchiveUploader(options);
  const first = await upload({ bytes: PDF });
  assert.deepEqual(await upload({ bytes: PDF }), first);
  assert.equal(objects.size, 1);
  const result = await request(createArchiveReader(options), first.sha256);
  assert.deepEqual(result, PDF);
  result.fill(0);
  assert.deepEqual(
    await request(createArchiveReader(options), first.sha256),
    PDF,
  );
});
