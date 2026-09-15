import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import { createGcsArchiveStore } from "../src/invoiceArchive/gcsStore.mjs";

const MAX_BYTES = 20 * 1024 * 1024;
const bytes = Buffer.from("%PDF-archive fixture");
const generation = "90071992547409931234";
const objectName = `invoice-pdfs/1:example:web:archive/${"a".repeat(64)}.pdf`;
const provenance = {
  archiveVersion: "1",
  tenantId: "1:example:web:archive",
  sha256: "a".repeat(64),
  sizeBytes: String(bytes.length),
  mimeType: "application/pdf",
};
const rootMetadata = () => ({
  generation,
  metageneration: "1",
  size: String(bytes.length),
  contentType: "application/pdf",
  cacheControl: "private, no-store",
  metadata: { ...provenance },
});

// Contract spy, not an emulator or evidence of cloud IAM/privacy. Model the
// SDK's public File.interceptors request hook on both metadata and media reads.
function fixture({
  first = rootMetadata(),
  after = first,
  chunks = [bytes],
  saveError,
  streamFactory,
} = {}) {
  const calls = { files: [], saves: [], metadata: [], streams: [] };
  let stream;
  const bucket = {
    file(name, options) {
      calls.files.push({ name, options });
      const interceptors = [];
      const query = (qs) =>
        interceptors.reduce((request, hook) => hook.request(request), { qs })
          .qs;
      return {
        interceptors,
        async save(data, options) {
          calls.saves.push({ data, options });
          if (saveError) throw saveError;
        },
        async getMetadata() {
          calls.metadata.push(query({}));
          const result = calls.metadata.length === 1 ? first : after;
          if (result instanceof Error) throw result;
          return [result];
        },
        createReadStream(options) {
          calls.streams.push({ query: query({ alt: "media" }), options });
          stream = streamFactory ? streamFactory() : Readable.from(chunks);
          return stream;
        },
      };
    },
  };
  const store = createGcsArchiveStore({ bucket });
  return {
    store,
    calls,
    get stream() {
      return stream;
    },
    read: (maxBytes = MAX_BYTES) =>
      store.readSnapshot({ objectName, maxBytes }),
    create: (overrides = {}) =>
      store.createOnly({
        objectName,
        bytes,
        metadata: provenance,
        ...overrides,
      }),
  };
}

test("createOnly sends only fixed private, create-only save options", async () => {
  const f = fixture();
  await f.create({ options: { public: true }, contentType: "text/plain" });
  assert.deepEqual(f.calls.files, [{ name: objectName, options: undefined }]);
  assert.equal(f.calls.saves.length, 1);
  assert.notEqual(f.calls.saves[0].data, bytes);
  assert.notEqual(f.calls.saves[0].options.metadata.metadata, provenance);
  assert.deepEqual(f.calls.saves[0], {
    data: bytes,
    options: {
      resumable: false,
      gzip: false,
      preconditionOpts: { ifGenerationMatch: 0 },
      metadata: {
        contentType: "application/pdf",
        cacheControl: "private, no-store",
        metadata: provenance,
      },
    },
  });
});

test("createOnly owns bytes and provenance before awaiting IO", async () => {
  const f = fixture();
  const input = Buffer.from(bytes);
  const metadata = { ...provenance };
  const pending = f.create({ bytes: input, metadata });
  input.fill(0);
  metadata.tenantId = "changed";
  await pending;
  assert.deepEqual(f.calls.saves[0].data, bytes);
  assert.deepEqual(f.calls.saves[0].options.metadata.metadata, provenance);
});

for (const code of [412, 403, 404, 429, 500, "412", "ECONNRESET", undefined]) {
  test(`save failure ${typeof code}:${String(code)} stays unchanged`, async () => {
    const error = Object.assign(new Error("save failed: 412"), { code });
    const f = fixture({ saveError: error });
    await assert.rejects(f.create(), (actual) => actual === error);
    assert.equal(f.calls.saves.length, 1);
    assert.equal(f.calls.files.length, 1);
    assert.deepEqual(f.calls.metadata, []);
  });
}

const invalidProvenance = [
  ["missing", undefined],
  ["missing tenant", { ...provenance, tenantId: undefined }],
  ["wrong version", { ...provenance, archiveVersion: "2" }],
  ["wrong mime", { ...provenance, mimeType: "text/plain" }],
  ["numeric size", { ...provenance, sizeBytes: bytes.length }],
  ["wrong size", { ...provenance, sizeBytes: "1" }],
  ["token", { ...provenance, firebaseStorageDownloadTokens: "forbidden" }],
  ["extra", { ...provenance, contentDisposition: "inline" }],
  ["symbol", { ...provenance, [Symbol("extra")]: "forbidden" }],
  [
    "inherited token",
    Object.assign(Object.create({ token: "forbidden" }), provenance),
  ],
];
for (const [label, metadata] of invalidProvenance) {
  test(`rejects ${label} provenance before save or byte read`, async () => {
    const f = fixture({ first: { ...rootMetadata(), metadata } });
    await assert.rejects(f.create({ metadata }), /Invalid archive provenance/);
    assert.equal(f.calls.files.length, 0);
    await assert.rejects(f.read(), /Invalid archive provenance/);
    assert.equal(f.calls.streams.length, 0);
  });
}

test("rejects invalid input paths, byte types and byte bounds before IO", async () => {
  const f = fixture();
  const unsafeNames = [
    "other/file.pdf",
    objectName.replace("1:example:web:archive", ".."),
    objectName.replace("1:example:web:archive", "a/b"),
    objectName + "?token=x",
    objectName + "\n",
  ];
  for (const name of unsafeNames) {
    await assert.rejects(
      f.create({ objectName: name }),
      /Invalid archive object name/,
    );
    await assert.rejects(
      f.store.readSnapshot({ objectName: name, maxBytes: MAX_BYTES }),
    );
  }
  for (const input of [
    "%PDF-",
    null,
    new Uint8Array(),
    new Uint8Array(MAX_BYTES + 1),
  ]) {
    await assert.rejects(
      f.create({ bytes: input }),
      /Invalid archive (bytes|size)/,
    );
  }
  assert.equal(f.calls.files.length, 0);
});

test("readSnapshot pins exact long generation strings for bytes and metadata recheck", async () => {
  const f = fixture();
  const snapshot = await f.read(bytes.length);
  assert.deepEqual(snapshot, { bytes, metadata: provenance, generation });
  assert.deepEqual(Object.keys(snapshot).sort(), [
    "bytes",
    "generation",
    "metadata",
  ]);
  assert.deepEqual(f.calls.files, [
    { name: objectName, options: undefined },
    { name: objectName, options: undefined },
  ]);
  assert.deepEqual(f.calls.streams, [
    { query: { alt: "media", generation }, options: { decompress: false } },
  ]);
  assert.deepEqual(f.calls.metadata, [{}, { generation }]);
});

test("readSnapshot returns owned buffers and detached provenance", async () => {
  const shared = Buffer.from(bytes);
  const first = rootMetadata();
  async function* mutableChunks() {
    yield shared.subarray(0, 5);
    await new Promise((resolve) => setImmediate(resolve));
    shared.fill(0, 0, 5);
    yield shared.subarray(5);
  }
  const f = fixture({
    first,
    streamFactory: () => Readable.from(mutableChunks()),
  });
  const result = await f.read();
  shared.fill(0);
  first.metadata.tenantId = "mutated";
  assert.deepEqual(result.bytes, bytes);
  assert.deepEqual(result.metadata, provenance);
  assert.notEqual(result.bytes.buffer, shared.buffer);
});

test("maxBytes rejects nonfinite, fractional and out-of-range inputs before IO", async () => {
  const f = fixture();
  for (const limit of [
    undefined,
    null,
    "20",
    0,
    -1,
    NaN,
    Infinity,
    1.5,
    MAX_BYTES + 1,
  ]) {
    await assert.rejects(f.store.readSnapshot({ objectName, maxBytes: limit }));
  }
  assert.equal(f.calls.files.length, 0);
});

const invalidRoot = [
  ["missing generation", { generation: undefined }],
  ["zero generation", { generation: "0" }],
  ["unsafe numeric generation", { generation: Number.MAX_SAFE_INTEGER + 1 }],
  ["fractional generation", { generation: "1.5" }],
  ["whitespace generation", { generation: generation + "\n" }],
  ["missing metageneration", { metageneration: undefined }],
  ["negative metageneration", { metageneration: -1 }],
  ["whitespace metageneration", { metageneration: "1\n" }],
  ["zero size", { size: "0" }],
  ["noncanonical size", { size: "01" }],
  ["whitespace size", { size: String(bytes.length) + "\n" }],
  ["nonfinite size", { size: Infinity }],
  ["fractional size", { size: 1.5 }],
  ["missing size", { size: undefined }],
  ["oversized declaration", { size: String(MAX_BYTES + 1) }],
  ["wrong content type", { contentType: "text/plain" }],
  ["missing content type", { contentType: undefined }],
  ["public cache", { cacheControl: "public, max-age=3600" }],
  ["missing cache", { cacheControl: undefined }],
  ["compressed content", { contentEncoding: "gzip" }],
];
for (const [label, patch] of invalidRoot) {
  test(`rejects ${label} metadata before creating a stream`, async () => {
    const f = fixture({ first: { ...rootMetadata(), ...patch } });
    await assert.rejects(f.read());
    assert.equal(f.calls.streams.length, 0);
  });
}

test("declared size beyond caller limit blocks the byte stream", async () => {
  const f = fixture();
  await assert.rejects(f.read(bytes.length - 1));
  assert.equal(f.calls.streams.length, 0);
});

test("safe numeric metadata values normalize without truncating long strings", async () => {
  const first = {
    ...rootMetadata(),
    generation: 7,
    metageneration: 2,
    size: bytes.length,
  };
  const f = fixture({ first });
  assert.equal((await f.read()).generation, "7");
  assert.equal(f.calls.streams[0].query.generation, "7");
});

test("actual overflow destroys the stream without reading the rest", async () => {
  let reads = 0;
  const f = fixture({
    streamFactory: () =>
      new Readable({
        objectMode: true,
        highWaterMark: 1,
        read() {
          reads += 1;
          this.push(Buffer.alloc(bytes.length + 1));
        },
      }),
  });
  await assert.rejects(
    f.read(bytes.length),
    /Archive stream exceeds declared size/,
  );
  assert.equal(f.stream.destroyed, true);
  assert.ok(reads <= 2, "overflow must stop a continuing producer");
  assert.equal(f.calls.metadata.length, 1);
});

test("rejects cumulative overflow, short reads and non-byte chunks", async () => {
  const badChunks = [
    [bytes, Buffer.from("extra")],
    [bytes.subarray(1)],
    ["not bytes"],
    [],
  ];
  for (const chunks of badChunks) {
    const f = fixture({ chunks });
    await assert.rejects(f.read());
    assert.equal(f.stream.destroyed, true);
    assert.equal(f.calls.metadata.length, 1);
  }
});

test("stream errors destroy the stream and never return partial bytes", async () => {
  const error = new Error("stream failed");
  async function* failingChunks() {
    yield bytes.subarray(0, 5);
    throw error;
  }
  const f = fixture({ streamFactory: () => Readable.from(failingChunks()) });
  await assert.rejects(f.read(), (actual) => actual === error);
  assert.equal(f.stream.destroyed, true);
  assert.equal(f.calls.metadata.length, 1);
});

for (const [label, patch] of [
  ["object generation", { generation: "90071992547409931235" }],
  ["metadata revision", { metageneration: "2" }],
  ["custom provenance", { metadata: { ...provenance, tenantId: "other" } }],
  ["root cache policy", { cacheControl: "public" }],
  ["root MIME", { contentType: "text/plain" }],
  [
    "download token",
    { metadata: { ...provenance, firebaseStorageDownloadTokens: "x" } },
  ],
  ["declared size", { size: String(bytes.length + 1) }],
]) {
  test(`rejects changed ${label} on pinned metadata recheck`, async () => {
    const f = fixture({ after: { ...rootMetadata(), ...patch } });
    await assert.rejects(f.read());
    assert.deepEqual(f.calls.metadata, [{}, { generation }]);
  });
}

test("missing object metadata fails before IO or after pinned read", async () => {
  const missing = fixture({ first: null });
  await assert.rejects(missing.read());
  assert.equal(missing.calls.streams.length, 0);
  const vanished = fixture({ after: null });
  await assert.rejects(vanished.read());
  assert.equal(vanished.calls.streams.length, 1);
});

test("metadata request errors fail closed before and after streaming", async () => {
  const error = Object.assign(new Error("metadata failed"), { code: 404 });
  const missing = fixture({ first: error });
  await assert.rejects(missing.read(), (actual) => actual === error);
  assert.equal(missing.calls.streams.length, 0);
  const vanished = fixture({ after: error });
  await assert.rejects(vanished.read(), (actual) => actual === error);
  assert.equal(vanished.stream.destroyed, true);
});

test("missing Bucket dependency fails without SDK initialization", () => {
  for (const deps of [undefined, {}, { bucket: {} }]) {
    assert.throws(() => createGcsArchiveStore(deps), /Invalid archive bucket/);
  }
});
