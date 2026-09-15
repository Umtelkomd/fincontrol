import {
  MAX_BYTES,
  archiveMetadata,
  authorizedTenant,
  hasPdfSignature,
  matchesMetadata,
  sha256 as hashBytes,
  validGeneration,
} from "./blob.mjs";

export class ArchiveReadError extends Error {
  constructor(code) {
    super(code);
    this.name = "ArchiveReadError";
    this.code = code;
  }
}

function verifiedCopy(snapshot, tenantId, digest) {
  try {
    const stored = snapshot?.bytes;
    if (
      !(stored instanceof Uint8Array) ||
      stored.length === 0 ||
      stored.length > MAX_BYTES
    ) {
      return null;
    }
    // Copy before inspecting generation/provenance; never return store memory.
    const owned = Buffer.from(stored);
    if (
      !validGeneration(snapshot.generation) ||
      !hasPdfSignature(owned) ||
      hashBytes(owned) !== digest ||
      !matchesMetadata(
        snapshot.metadata,
        archiveMetadata(tenantId, digest, owned.length),
      )
    ) {
      return null;
    }
    return owned;
  } catch {
    return null;
  }
}

/**
 * Trusted readSnapshot({ objectName, maxBytes }) MUST bound the stream while
 * reading and pin bytes + custom metadata to the same generation. No unbounded
 * download or response streaming is allowed; this core cannot enforce adapter IO.
 * authorize is the fresh membership/revocation gate, not caller-supplied context.
 * Signature validation only, not a PDF parser or malware scan. A later HTTP
 * boundary owns the returned Buffer and private,no-store/nosniff/safe disposition.
 */
export function createArchiveReader({ authorize, store } = {}) {
  if (
    typeof authorize !== "function" ||
    typeof store?.readSnapshot !== "function"
  ) {
    throw new TypeError("Invalid archive reader dependencies");
  }
  const readSnapshot = store.readSnapshot.bind(store);

  return async function read({ authorization, sha256 } = {}) {
    // Preserve the trusted authorizer's sanitized failure; never cache access.
    const tenantId = authorizedTenant(await authorize(authorization));
    if (!tenantId) throw new ArchiveReadError("accessdenied");
    if (typeof sha256 !== "string" || !/^[a-f0-9]{64}$/.test(sha256)) {
      throw new ArchiveReadError("invaliddigest");
    }
    const objectName = `invoice-pdfs/${tenantId}/${sha256}.pdf`;
    let snapshot;
    try {
      snapshot = await readSnapshot({ objectName, maxBytes: MAX_BYTES });
    } catch (error) {
      // GCS reports a missing object as an ApiError with a numeric code 404
      // (nodejs-common/util.js normalizes it to a number). Only that exact
      // signal means "no such digest"; anything else stays a storage failure
      // so no SDK detail ever reaches the caller.
      if (error?.code === 404) throw new ArchiveReadError("notfound");
      throw new ArchiveReadError("storagefailure");
    }
    const owned = verifiedCopy(snapshot, tenantId, sha256);
    if (!owned) throw new ArchiveReadError("invalidblob");
    return owned;
  };
}
