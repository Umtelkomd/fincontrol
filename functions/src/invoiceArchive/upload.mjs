import {
  MAX_BYTES,
  MIME_TYPE,
  archiveMetadata,
  authorizedTenant,
  hasPdfSignature,
  matchesMetadata,
  sha256,
  validGeneration,
} from "./blob.mjs";

export class ArchiveUploadError extends Error {
  constructor(code) {
    super(code);
    this.name = "ArchiveUploadError";
    this.code = code;
  }
}

function matchesSnapshot(snapshot, bytes, metadata) {
  try {
    const stored = snapshot?.bytes;
    const provenance = snapshot?.metadata;
    return (
      stored instanceof Uint8Array &&
      stored.length <= MAX_BYTES &&
      stored.length === bytes.length &&
      validGeneration(snapshot.generation) &&
      matchesMetadata(provenance, metadata) &&
      Buffer.from(stored).equals(bytes) &&
      sha256(stored) === metadata.sha256
    );
  } catch {
    return false;
  }
}

/**
 * Private, injected store contract (no transport or IAM implementation here):
 * createOnly must atomically create with GCS ifGenerationMatch: 0 and report
 * precondition failure as numeric error.code === 412. readSnapshot must enforce
 * maxBytes while reading bytes + custom metadata from one pinned generation.
 * The adapter must set fixed root contentType/cacheControl, never public tokens.
 * These custom metadata fields describe the blob, not its uploader or filename.
 */
export function createArchiveUploader({ authorize, store } = {}) {
  if (
    typeof authorize !== "function" ||
    typeof store?.createOnly !== "function" ||
    typeof store?.readSnapshot !== "function"
  ) {
    throw new TypeError("Invalid archive uploader dependencies");
  }
  const createOnly = store.createOnly.bind(store);
  const readSnapshot = store.readSnapshot.bind(store);

  return async function upload({ authorization, bytes } = {}) {
    // Bound the copy before the first await; never retain the caller's memory.
    const owned =
      bytes instanceof Uint8Array &&
      bytes.length > 0 &&
      bytes.length <= MAX_BYTES
        ? Buffer.from(bytes)
        : null;
    // Authorization failures remain the trusted gate's sanitized denial.
    const tenantId = authorizedTenant(await authorize(authorization));
    if (!tenantId) throw new ArchiveUploadError("accessdenied");
    // Signature check only: not structural PDF validation or malware clearance.
    if (!owned || !hasPdfSignature(owned)) {
      throw new ArchiveUploadError("invalidpdf");
    }
    const digest = sha256(owned);
    const metadata = archiveMetadata(tenantId, digest, owned.length);
    const objectName = `invoice-pdfs/${tenantId}/${digest}.pdf`;
    try {
      await createOnly({ objectName, bytes: owned, metadata });
    } catch (error) {
      if (error?.code !== 412) throw new ArchiveUploadError("storagefailure");
      let snapshot;
      try {
        snapshot = await readSnapshot({ objectName, maxBytes: MAX_BYTES });
      } catch {
        throw new ArchiveUploadError("storagefailure");
      }
      if (!matchesSnapshot(snapshot, owned, metadata)) {
        throw new ArchiveUploadError("conflict");
      }
    }
    return Object.freeze({
      sha256: digest,
      sizeBytes: owned.length,
      mimeType: MIME_TYPE,
    });
  };
}
