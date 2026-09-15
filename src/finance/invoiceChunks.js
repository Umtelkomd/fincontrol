/**
 * Pure chunking/integrity primitives for storing invoice PDF bytes as
 * Firestore document chunks — the Firebase project stays on the Spark plan
 * (no Cloud Functions, no Storage bucket), so PDF bytes live in Firestore
 * itself, split under the 1 MiB per-document limit.
 *
 * Pure: no Firebase, no I/O beyond `crypto.subtle` — every function is bytes
 * in, bytes/boolean/string out. src/features/facturas/lib/invoiceArchiveStore.js
 * wires these into Firestore reads/writes.
 */

/** Hard cap on an archived invoice PDF's size (bytes). */
export const MAX_INVOICE_BYTES = 2 * 1024 * 1024;

/** Bytes per Firestore chunk document — well under the 1 MiB doc limit. */
export const CHUNK_BYTES = 768 * 1024;

/** The largest chunk count a MAX_INVOICE_BYTES file can ever produce. */
export const MAX_CHUNK_COUNT = Math.ceil(MAX_INVOICE_BYTES / CHUNK_BYTES);

/** Zero-padded 3-digit chunk document id, e.g. `chunkIdOf(1) === '001'`. */
export const chunkIdOf = (index) => String(index).padStart(3, '0');

const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46, 0x2d]; // '%PDF-'

/**
 * Normalizes ArrayBuffer|Uint8Array input to a Uint8Array view. Uses
 * `ArrayBuffer.isView` (a realm-independent brand check) rather than
 * `instanceof Uint8Array`, because a TypedArray created in jsdom's realm
 * (e.g. via its `TextEncoder`) fails `instanceof` against this module's
 * global `Uint8Array` even though it is one.
 */
const toUint8Array = (bytes) => {
  if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes);
  if (bytes && ArrayBuffer.isView(bytes)) {
    return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  throw new Error('Expected a Uint8Array or ArrayBuffer');
};

/** True when `bytes` starts with the PDF magic signature `%PDF-`. */
export const hasPdfSignature = (bytes) => {
  const view = toUint8Array(bytes);
  if (view.byteLength < PDF_SIGNATURE.length) return false;
  return PDF_SIGNATURE.every((byte, index) => view[index] === byte);
};

/**
 * Splits `bytes` into ordered `{ index, bytes }` chunks of at most
 * `chunkBytes` each. Fails closed: throws on empty input or input larger
 * than MAX_INVOICE_BYTES (independent of the `chunkBytes` override).
 */
export const splitIntoChunks = (bytes, chunkBytes = CHUNK_BYTES) => {
  const view = toUint8Array(bytes);
  if (view.byteLength === 0) {
    throw new Error('splitIntoChunks: cannot split empty input');
  }
  if (view.byteLength > MAX_INVOICE_BYTES) {
    throw new Error(`splitIntoChunks: input exceeds MAX_INVOICE_BYTES (${MAX_INVOICE_BYTES} bytes)`);
  }
  const chunks = [];
  for (let offset = 0, index = 0; offset < view.byteLength; offset += chunkBytes, index += 1) {
    chunks.push({ index, bytes: view.slice(offset, offset + chunkBytes) });
  }
  return chunks;
};

/**
 * Reassembles `chunks` (each `{ index, bytes }`) back into one Uint8Array.
 * Fails closed on any mismatch — a missing, duplicate or out-of-order index
 * at any position, a chunk count different from `expectedCount`, or a joined
 * size different from `expectedSize` — every one of these throws rather than
 * silently returning partial/wrong bytes.
 */
export const joinChunks = (chunks, { expectedSize, expectedCount } = {}) => {
  if (!Array.isArray(chunks) || chunks.length !== expectedCount) {
    const got = Array.isArray(chunks) ? chunks.length : typeof chunks;
    throw new Error(`joinChunks: expected ${expectedCount} chunks, got ${got}`);
  }

  const parts = chunks.map((chunk, position) => {
    if (!chunk || chunk.index !== position) {
      throw new Error(
        `joinChunks: missing, duplicate or out-of-order chunk at position ${position} (index=${chunk?.index})`,
      );
    }
    return toUint8Array(chunk.bytes);
  });

  const totalSize = parts.reduce((sum, part) => sum + part.byteLength, 0);
  if (totalSize !== expectedSize) {
    throw new Error(`joinChunks: size mismatch — expected ${expectedSize} bytes, got ${totalSize}`);
  }

  const joined = new Uint8Array(totalSize);
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.byteLength;
  }
  return joined;
};

const toHex = (buffer) =>
  Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');

/** Lowercase hex SHA-256 digest of `bytes`, via the Web Crypto API. */
export const sha256Hex = async (bytes) => {
  const view = toUint8Array(bytes);
  const digest = await crypto.subtle.digest('SHA-256', view);
  return toHex(digest);
};
