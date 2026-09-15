import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  ArchiveUploadError,
  createArchiveUploader,
} from "../src/invoiceArchive/upload.mjs";

const PDF = Buffer.from("%PDF-1.7\nfixture\n%%EOF");
const LIMIT = 20 * 1024 * 1024;
const TENANT = "1:123456:web:abcdef";
const HASH = createHash("sha256").update(PDF).digest("hex");
const CONTEXT = Object.freeze({
  uid: "member-a",
  tenantId: TENANT,
  role: "editor",
});
const METADATA = Object.freeze({
  archiveVersion: "1",
  tenantId: TENANT,
  sha256: HASH,
  sizeBytes: String(PDF.length),
  mimeType: "application/pdf",
});
const code = (expected) => (error) => {
  assert.ok(error instanceof ArchiveUploadError);
  assert.equal(error.code, expected);
  assert.equal(error.message, expected);
  assert.equal(error.cause, undefined);
  return true;
};

// Synchronous check-and-set models atomic create-only, not a real GCS transport.
function fixture(context = CONTEXT) {
  const objects = new Map();
  const calls = { auth: [], creates: [], reads: [] };
  const store = {
    async createOnly(request) {
      calls.creates.push(request);
      if (objects.has(request.objectName)) throw { code: 412 };
      objects.set(request.objectName, {
        bytes: Buffer.from(request.bytes),
        metadata: { ...request.metadata },
        generation: "1",
      });
    },
    async readSnapshot(request) {
      calls.reads.push(request);
      return objects.get(request.objectName);
    },
  };
  const authorize = async (header) => {
    calls.auth.push(header);
    return context;
  };
  return { objects, calls, store, authorize };
}
const send = (upload, bytes = PDF) =>
  upload({ authorization: "Bearer fixture", bytes });

for (const bytes of [
  undefined,
  null,
  "pdf",
  [],
  new ArrayBuffer(5),
  new Uint16Array(5),
  new Uint8Array(),
  Buffer.alloc(LIMIT + 1),
  Buffer.from("%PDF"),
  Buffer.from(" %PDF-"),
  Buffer.from("NOT-PDF"),
]) {
  test(`rejects invalid PDF input: ${Object.prototype.toString.call(bytes)} / ${bytes?.length}`, async () => {
    const f = fixture();
    await assert.rejects(
      createArchiveUploader(f)({ bytes }),
      code("invalidpdf"),
    );
    assert.equal(f.calls.auth.length, 1);
    assert.equal(f.calls.creates.length + f.calls.reads.length, 0);
  });
}

test("first create hashes only view bytes, derives tenant path, and freezes public data", async () => {
  const f = fixture();
  const wrapped = Buffer.concat([
    Buffer.from("prefix"),
    PDF,
    Buffer.from("suffix"),
  ]);
  const bytes = new Uint8Array(
    wrapped.buffer,
    wrapped.byteOffset + 6,
    PDF.length,
  );
  const result = await createArchiveUploader(f)({
    authorization: "Bearer fixture",
    bytes,
    tenantId: "attacker",
    objectName: "attacker/file",
    sha256: "forged",
    filename: "secret.pdf",
  });
  assert.deepEqual(result, {
    sha256: HASH,
    sizeBytes: PDF.length,
    mimeType: "application/pdf",
  });
  assert.ok(Object.isFrozen(result));
  assert.deepEqual(f.calls.auth, ["Bearer fixture"]);
  const request = f.calls.creates[0];
  assert.equal(request.objectName, `invoice-pdfs/${TENANT}/${HASH}.pdf`);
  assert.deepEqual(request.bytes, PDF);
  assert.notEqual(request.bytes, bytes);
  assert.deepEqual(request.metadata, METADATA);
  assert.ok(Object.isFrozen(request.metadata));
  assert.throws(() => {
    request.metadata.tenantId = "other";
  }, TypeError);
  assert.notEqual([...f.objects.values()][0].metadata, request.metadata);
  assert.equal(f.calls.reads.length, 0);
});

test("accepts exactly 20 MiB and signature-only content", async () => {
  for (const bytes of [Buffer.from("%PDF-"), Buffer.alloc(LIMIT)]) {
    bytes.set(Buffer.from("%PDF-"));
    const result = await send(createArchiveUploader(fixture()), bytes);
    assert.equal(result.sizeBytes, bytes.length);
  }
});

test("copies bytes before authorization can mutate caller memory", async () => {
  const f = fixture();
  const bytes = Buffer.from(PDF);
  const upload = createArchiveUploader({
    ...f,
    authorize: async () => {
      bytes.fill(0);
      await Promise.resolve();
      return CONTEXT;
    },
  });
  assert.equal((await send(upload, bytes)).sha256, HASH);
  assert.deepEqual(f.calls.creates[0].bytes, PDF);
});

test("preserves sanitized authorization denial and performs no store IO", async () => {
  const f = fixture();
  const denial = Object.assign(new Error("accessdenied"), {
    code: "accessdenied",
  });
  const upload = createArchiveUploader({
    ...f,
    authorize: async () => {
      throw denial;
    },
  });
  await assert.rejects(send(upload), (error) => error === denial);
  assert.equal(f.calls.creates.length + f.calls.reads.length, 0);
});

test("fails closed for unusable authorized contexts and unsafe tenant segments", async () => {
  const contexts = [
    null,
    {},
    { ...CONTEXT, uid: "" },
    { ...CONTEXT, role: "" },
    ...["", ".", "..", "a/b", "a\\b", "a\n", "a\u0000", "a\u007f", "a b"].map(
      (tenantId) => ({ ...CONTEXT, tenantId }),
    ),
  ];
  for (const context of contexts) {
    const f = fixture(context);
    await assert.rejects(send(createArchiveUploader(f)), code("accessdenied"));
    assert.equal(f.calls.creates.length + f.calls.reads.length, 0);
  }
});

test("waits for successful authorization before store IO", async () => {
  const f = fixture();
  const { promise, resolve } = Promise.withResolvers();
  const upload = createArchiveUploader({ ...f, authorize: () => promise });
  const pending = send(upload);
  await Promise.resolve();
  assert.equal(f.calls.creates.length + f.calls.reads.length, 0);
  resolve(CONTEXT);
  await pending;
  assert.equal(f.calls.creates.length, 1);
});

test("different authorized tenants never share an object path", async () => {
  const f = fixture();
  await send(createArchiveUploader(f));
  await send(
    createArchiveUploader({
      ...f,
      authorize: async () => ({ ...CONTEXT, tenantId: "another:tenant" }),
    }),
  );
  assert.equal(f.objects.size, 2);
  assert.ok(f.objects.has(`invoice-pdfs/another:tenant/${HASH}.pdf`));
  assert.equal(f.calls.reads.length, 0);
});

test("rejects misconfigured dependencies at construction", () => {
  for (const options of [
    undefined,
    {},
    { authorize() {}, store: {} },
    { authorize: 1, store: fixture().store },
    { authorize() {}, store: { createOnly() {} } },
  ]) {
    assert.throws(() => createArchiveUploader(options), TypeError);
  }
});

test("concurrent duplicate and cross-user reuse retain identical provenance", async () => {
  const f = fixture();
  const upload = createArchiveUploader(f);
  const results = await Promise.all([send(upload), send(upload)]);
  const original = [...f.objects.values()][0];
  const secondMember = createArchiveUploader({
    ...f,
    authorize: async () =>
      Object.freeze({ ...CONTEXT, uid: "member-b", role: "manager" }),
  });
  results.push(await send(secondMember));
  assert.deepEqual(results[0], results[1]);
  assert.deepEqual(results[0], results[2]);
  assert.equal(f.objects.size, 1);
  assert.equal([...f.objects.values()][0], original);
  assert.deepEqual(original.metadata, METADATA);
  assert.equal(f.calls.auth.length, 2);
  assert.equal(f.calls.creates.length, 3);
  assert.deepEqual(
    f.calls.reads,
    Array(2).fill({
      objectName: `invoice-pdfs/${TENANT}/${HASH}.pdf`,
      maxBytes: LIMIT,
    }),
  );
});

test("412 rejects corrupted bytes, provenance, size, or generation without repair", async () => {
  const corruptions = [
    (s) => {
      s.bytes = Buffer.from("%PDF-1.7\ncorrupt\n%%EOF");
    },
    (s) => {
      s.bytes = Buffer.alloc(LIMIT + 1);
    },
    (s) => {
      s.bytes = [...PDF];
    },
    ...Object.keys(METADATA).flatMap((key) => [
      (s) => {
        s.metadata[key] = "wrong";
      },
      (s) => {
        delete s.metadata[key];
      },
    ]),
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
      s.metadata = Object.create(METADATA);
    },
    (s) => {
      s.bytes = PDF.subarray(0, PDF.length - 1);
    },
    (s) => {
      s.metadata.sizeBytes = PDF.length;
    },
    (s) => {
      s.metadata = null;
    },
    ...[
      undefined,
      null,
      "",
      "0",
      "01",
      "-1",
      "1.5",
      "abc",
      0,
      -1,
      NaN,
      Number.MAX_SAFE_INTEGER + 1,
      {},
    ].map((generation) => (s) => {
      s.generation = generation;
    }),
  ];
  for (const corrupt of corruptions) {
    const f = fixture();
    const upload = createArchiveUploader(f);
    await send(upload);
    const snapshot = [...f.objects.values()][0];
    corrupt(snapshot);
    await assert.rejects(send(upload), code("conflict"));
    assert.equal(f.objects.size, 1);
    assert.equal([...f.objects.values()][0], snapshot);
    assert.equal(f.calls.creates.length, 2);
    assert.equal(f.calls.reads.length, 1);
  }
});

test("accepts positive safe numeric and canonical decimal string generations", async () => {
  for (const generation of [1, "18446744073709551615"]) {
    const f = fixture();
    const upload = createArchiveUploader(f);
    await send(upload);
    [...f.objects.values()][0].generation = generation;
    assert.equal((await send(upload)).sha256, HASH);
  }
});

test("non-412 failures never read or leak SDK messages; snapshot failures are sanitized", async () => {
  for (const failure of [
    new Error("private SDK detail"),
    { code: 403 },
    { code: 500 },
    { code: "412" },
    { status: 412 },
    null,
  ]) {
    const f = fixture();
    f.store.createOnly = async () => {
      throw failure;
    };
    await assert.rejects(
      send(createArchiveUploader(f)),
      code("storagefailure"),
    );
    assert.equal(f.calls.reads.length, 0);
  }
  const f = fixture();
  f.store.createOnly = async () => {
    throw { code: 412 };
  };
  f.store.readSnapshot = async () => {
    throw new Error("private snapshot detail");
  };
  await assert.rejects(send(createArchiveUploader(f)), code("storagefailure"));
  f.store.readSnapshot = async () => undefined;
  await assert.rejects(send(createArchiveUploader(f)), code("conflict"));
});
