import { MAX_BYTES, MIME_TYPE, validGeneration } from "./blob.mjs";

const CACHE_CONTROL = "private, no-store";
const CUSTOM_KEYS = [
  "archiveVersion",
  "tenantId",
  "sha256",
  "sizeBytes",
  "mimeType",
];
const OBJECT_PATH = /^invoice-pdfs\/([A-Za-z0-9_.:-]+)\/[a-f0-9]{64}\.pdf$/;

function requireObjectName(objectName) {
  const match = typeof objectName === "string" && OBJECT_PATH.exec(objectName);
  if (!match || match[1] === "." || match[1] === "..") {
    throw new TypeError("Invalid archive object name");
  }
}

function positiveSize(value, limit) {
  if (typeof value === "string" && !/^[1-9][0-9]*$/.test(value)) {
    throw new TypeError("Invalid archive size");
  }
  const size = typeof value === "string" ? Number(value) : value;
  if (!Number.isSafeInteger(size) || size <= 0 || size > limit) {
    throw new TypeError("Invalid archive size");
  }
  return size;
}

function copyProvenance(metadata, size) {
  if (
    !metadata ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(metadata)) ||
    Reflect.ownKeys(metadata).length !== CUSTOM_KEYS.length ||
    !CUSTOM_KEYS.every((key) => Object.hasOwn(metadata, key))
  ) {
    throw new TypeError("Invalid archive provenance");
  }
  // Reject extras rather than stripping tokens or manufacturing missing fields.
  const copy = { ...metadata };
  if (
    !CUSTOM_KEYS.every(
      (key) => typeof copy[key] === "string" && copy[key].length > 0,
    ) ||
    copy.archiveVersion !== "1" ||
    copy.mimeType !== MIME_TYPE ||
    copy.sizeBytes !== String(size)
  ) {
    throw new TypeError("Invalid archive provenance");
  }
  return copy;
}

function snapshotMetadata(root, maxBytes) {
  if (
    !root ||
    !validGeneration(root.generation) ||
    !validGeneration(root.metageneration) ||
    root.contentType !== MIME_TYPE ||
    root.cacheControl !== CACHE_CONTROL ||
    (root.contentEncoding !== undefined && root.contentEncoding !== "identity")
  ) {
    throw new TypeError("Invalid archive object metadata");
  }
  const size = positiveSize(root.size, maxBytes);
  return {
    generation: String(root.generation),
    metageneration: String(root.metageneration),
    size,
    metadata: copyProvenance(root.metadata, size),
  };
}

function pinnedFile(bucket, objectName, generation) {
  // SDK 7.21.0 file.d.ts FileOptions permits string generations, but file.js
  // constructor coerces them through Number (both qs and this.generation).
  // Use the public ServiceObject.interceptors API instead: service-object.js
  // request_ attaches it to metadata AND media requests; service.js request_
  // applies the hooks before calling makeAuthenticatedRequest.
  // This fresh handle belongs only to this read; never mutate Bucket/global state.
  const file = bucket.file(objectName);
  file.interceptors.push({
    request(options) {
      return { ...options, qs: { ...options.qs, generation } };
    },
  });
  return file;
}

async function boundedBytes(file, size) {
  // CreateReadStreamOptions supports decompress, not preconditionOpts. Keep
  // CRC validation at the SDK default; metadata revisions are rechecked below.
  const stream = file.createReadStream({ decompress: false });
  try {
    const owned = Buffer.alloc(size);
    let length = 0;
    for await (const chunk of stream) {
      if (!(chunk instanceof Uint8Array)) {
        throw new TypeError("Invalid archive stream chunk");
      }
      if (chunk.length > size - length) {
        throw new Error("Archive stream exceeds declared size");
      }
      owned.set(chunk, length);
      length += chunk.length;
    }
    if (length !== size) throw new Error("Archive stream size mismatch");
    return owned;
  } finally {
    stream.destroy();
  }
}

/** Inject a trusted Admin GCS Bucket; this module never initializes an SDK. */
export function createGcsArchiveStore({ bucket } = {}) {
  if (typeof bucket?.file !== "function") {
    throw new TypeError("Invalid archive bucket");
  }
  return {
    async createOnly({ objectName, bytes, metadata }) {
      requireObjectName(objectName);
      if (!(bytes instanceof Uint8Array)) {
        throw new TypeError("Invalid archive bytes");
      }
      const size = positiveSize(bytes.length, MAX_BYTES);
      const custom = copyProvenance(metadata, size);
      const owned = Buffer.from(bytes);
      // @google-cloud/storage 7.21.0: file.d.ts SaveOptions inherits
      // CreateWriteStreamOptions; file.js startSimpleUpload_ merges these
      // preconditions into qs. save retries retain these same options.
      // nodejs-common/util.{js,d.ts} ApiError.code is numeric: propagate errors
      // unchanged. Only numeric 412 reaches the core's duplicate branch.
      await bucket.file(objectName).save(owned, {
        resumable: false,
        gzip: false,
        preconditionOpts: { ifGenerationMatch: 0 },
        metadata: {
          contentType: MIME_TYPE,
          cacheControl: CACHE_CONTROL,
          metadata: custom,
        },
      });
    },

    async readSnapshot({ objectName, maxBytes }) {
      requireObjectName(objectName);
      if (typeof maxBytes !== "number") {
        throw new TypeError("Invalid archive limit");
      }
      positiveSize(maxBytes, MAX_BYTES);
      const [root] = await bucket.file(objectName).getMetadata();
      const before = snapshotMetadata(root, maxBytes);
      const file = pinnedFile(bucket, objectName, before.generation);
      const bytes = await boundedBytes(file, before.size);
      // GCS generation pins content, not mutable custom metadata. Re-read the
      // pinned generation after bytes: even an edit followed by a revert changes
      // metageneration. Never return bytes with provenance from a different revision.
      const [checkedRoot] = await file.getMetadata();
      const after = snapshotMetadata(checkedRoot, maxBytes);
      if (
        after.generation !== before.generation ||
        after.metageneration !== before.metageneration ||
        after.size !== before.size ||
        !CUSTOM_KEYS.every(
          (key) => after.metadata[key] === before.metadata[key],
        )
      ) {
        throw new Error("Archive metadata changed during read");
      }
      return {
        bytes,
        metadata: before.metadata,
        generation: before.generation,
      };
    },
  };
}
