/**
 * Firestore-chunk-backed invoice PDF archive (replaces the retired HTTP
 * client — the Firebase project stays on the Spark plan: no Cloud Functions,
 * no Storage bucket, so PDF bytes live in Firestore itself).
 *
 * Metadata doc: artifacts/{appId}/public/data/invoiceDocuments/{sha256}
 * (written by effects.commit in src/features/facturas/lib/intake.js, not
 * here). Chunks: the `chunks` subcollection under that doc, one doc per
 * CHUNK_BYTES slice, id = zero-padded index (see src/finance/invoiceChunks.js).
 *
 * `deps` is injectable so this stays testable without a live Firestore
 * connection — see invoiceArchiveStore.test.js for fakes exercising every
 * branch; src/test/firestore.rules.integration.test.js covers the matching
 * security rules.
 */
import { collection, doc, getDoc, getDocs, orderBy, query, writeBatch, Bytes } from 'firebase/firestore';
import {
  CHUNK_BYTES,
  chunkIdOf,
  hasPdfSignature,
  joinChunks,
  MAX_INVOICE_BYTES,
  sha256Hex,
  splitIntoChunks,
} from '../../../finance/invoiceChunks';

const MIME_TYPE = 'application/pdf';
const SHA256_RE = /^[a-f0-9]{64}$/;

/** Spanish user-facing messages for every archive error code. */
export const ARCHIVE_ERROR_MESSAGES = {
  'too-large': 'El PDF supera el máximo de 2 MB.',
  'invalid-pdf': 'El archivo no es un PDF válido.',
  'not-found': 'La factura no está en el archivo.',
  corrupt: 'El PDF archivado no supera la verificación de integridad.',
  'access-denied': 'No tienes acceso al archivo de facturas.',
  network: 'No se pudo conectar con el archivo de facturas.',
  'hash-mismatch': 'El PDF recibido no coincide con el archivo original.',
  'internal-error': 'Error interno al procesar el archivo de facturas.',
};

export class InvoiceArchiveError extends Error {
  constructor(code, cause) {
    super(ARCHIVE_ERROR_MESSAGES[code] || `Invoice archive error: ${code}`);
    this.name = 'InvoiceArchiveError';
    this.code = code;
    if (cause !== undefined) this.cause = cause;
  }
}

const firestoreDeps = { collection, doc, getDoc, getDocs, orderBy, query, writeBatch, Bytes };

/** Maps a Firestore error's `.code` to an archive error code. Fails closed to internal-error. */
const mapFirestoreErrorCode = (error) => {
  const code = String(error?.code || '');
  if (code === 'permission-denied') return 'access-denied';
  if (code === 'unavailable' || /network/i.test(code)) return 'network';
  return 'internal-error';
};

const invoiceDocRef = (deps, db, appId, sha256) =>
  deps.doc(db, 'artifacts', appId, 'public', 'data', 'invoiceDocuments', sha256);

const chunksCollectionRef = (deps, db, appId, sha256) =>
  deps.collection(db, 'artifacts', appId, 'public', 'data', 'invoiceDocuments', sha256, 'chunks');

const chunkDocRef = (deps, db, appId, sha256, index) =>
  deps.doc(db, 'artifacts', appId, 'public', 'data', 'invoiceDocuments', sha256, 'chunks', chunkIdOf(index));

/**
 * Uploads PDF `bytes`, validating signature, size and the caller-supplied
 * digest before writing every chunk in one atomic batch. Never writes the
 * `invoiceDocuments/{sha256}` metadata document — that is the caller's
 * `effects.commit` (see src/features/facturas/lib/intake.js).
 *
 * @param {{ db: object, appId: string, bytes: ArrayBuffer|Uint8Array, expectedSha256: string }} params
 * @param {typeof firestoreDeps} [deps]
 * @returns {Promise<{ sha256: string, sizeBytes: number, mimeType: string }>}
 */
export const uploadInvoicePdf = async ({ db, appId, bytes, expectedSha256 } = {}, deps = firestoreDeps) => {
  if (!hasPdfSignature(bytes)) {
    throw new InvoiceArchiveError('invalid-pdf');
  }

  const sizeBytes = bytes.byteLength;
  if (sizeBytes > MAX_INVOICE_BYTES) {
    throw new InvoiceArchiveError('too-large');
  }

  const sha256 = await sha256Hex(bytes);
  if (sha256 !== String(expectedSha256 || '').toLowerCase()) {
    throw new InvoiceArchiveError('hash-mismatch');
  }

  const chunks = splitIntoChunks(bytes, CHUNK_BYTES);
  const batch = deps.writeBatch(db);
  chunks.forEach((chunk) => {
    batch.set(chunkDocRef(deps, db, appId, sha256, chunk.index), {
      index: chunk.index,
      bytes: deps.Bytes.fromUint8Array(chunk.bytes),
      sha256,
    });
  });

  try {
    await batch.commit();
  } catch (thrown) {
    throw new InvoiceArchiveError(mapFirestoreErrorCode(thrown), thrown);
  }

  return { sha256, sizeBytes, mimeType: MIME_TYPE };
};

/**
 * Fetches a previously archived PDF by its sha256 digest: reads the metadata
 * document, reads every chunk (ordered by index), reassembles and verifies
 * the digest again before returning the bytes as a Blob.
 *
 * @param {{ db: object, appId: string, sha256: string }} params
 * @param {typeof firestoreDeps} [deps]
 * @returns {Promise<Blob>}
 */
export const fetchInvoicePdf = async ({ db, appId, sha256 } = {}, deps = firestoreDeps) => {
  if (typeof sha256 !== 'string' || !SHA256_RE.test(sha256)) {
    throw new InvoiceArchiveError('not-found');
  }

  let metadataSnapshot;
  try {
    metadataSnapshot = await deps.getDoc(invoiceDocRef(deps, db, appId, sha256));
  } catch (thrown) {
    throw new InvoiceArchiveError(mapFirestoreErrorCode(thrown), thrown);
  }
  if (!metadataSnapshot.exists()) {
    throw new InvoiceArchiveError('not-found');
  }
  const metadata = metadataSnapshot.data();

  let chunksSnapshot;
  try {
    chunksSnapshot = await deps.getDocs(
      deps.query(chunksCollectionRef(deps, db, appId, sha256), deps.orderBy('index')),
    );
  } catch (thrown) {
    throw new InvoiceArchiveError(mapFirestoreErrorCode(thrown), thrown);
  }

  const chunks = chunksSnapshot.docs.map((entry) => {
    const data = entry.data();
    return { index: data.index, bytes: data.bytes.toUint8Array() };
  });

  let joined;
  try {
    joined = joinChunks(chunks, { expectedSize: metadata.sizeBytes, expectedCount: metadata.chunkCount });
  } catch (thrown) {
    throw new InvoiceArchiveError('corrupt', thrown);
  }

  const recomputed = await sha256Hex(joined);
  if (recomputed !== sha256) {
    throw new InvoiceArchiveError('corrupt');
  }

  return new Blob([joined], { type: MIME_TYPE });
};
