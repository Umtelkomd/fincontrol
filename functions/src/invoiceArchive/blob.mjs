import { createHash } from "node:crypto";

export const MAX_BYTES = 20 * 1024 * 1024;
export const MIME_TYPE = "application/pdf";
const SIGNATURE = Buffer.from("%PDF-");

export const sha256 = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");
export const hasPdfSignature = (bytes) =>
  bytes.subarray(0, SIGNATURE.length).equals(SIGNATURE);
const usableString = (value) =>
  typeof value === "string" && value.trim().length > 0;

export function authorizedTenant(context) {
  const tenant = context?.tenantId;
  if (
    !usableString(context?.uid) ||
    !usableString(context?.role) ||
    typeof tenant !== "string" ||
    !/^[A-Za-z0-9_.:-]+$/.test(tenant) ||
    tenant === "." ||
    tenant === ".."
  ) {
    return null;
  }
  return tenant;
}

export function validGeneration(value) {
  return typeof value === "string"
    ? /^[1-9][0-9]*$/.test(value)
    : Number.isSafeInteger(value) && value > 0;
}

export function archiveMetadata(tenantId, digest, sizeBytes) {
  return Object.freeze({
    archiveVersion: "1",
    tenantId,
    sha256: digest,
    sizeBytes: String(sizeBytes),
    mimeType: MIME_TYPE,
  });
}

export function matchesMetadata(provenance, metadata) {
  return (
    provenance !== null &&
    typeof provenance === "object" &&
    Reflect.ownKeys(provenance).length === Object.keys(metadata).length &&
    Object.keys(metadata).every(
      (key) =>
        Object.hasOwn(provenance, key) && provenance[key] === metadata[key],
    )
  );
}
