/**
 * Client for the invoice PDF archive HTTP API (see
 * functions/src/invoiceArchive/http.mjs for the server contract — read only,
 * not modified here).
 *
 * `POST /api/invoice-pdfs` uploads raw PDF bytes (idempotent: re-uploading
 * identical bytes returns the same 200). `GET /api/invoice-pdfs/{sha256}`
 * downloads them back. Both require `Authorization: Bearer <firebase id
 * token>`; there is no CORS, so this only ever talks to the same origin.
 *
 * `fetchImpl` is injectable so this stays testable without a network stack.
 */

const UPLOAD_PATH = '/api/invoice-pdfs';
const MIME_TYPE = 'application/pdf';
const SHA256_RE = /^[a-f0-9]{64}$/;

/** Spanish user-facing messages for every backend error code, plus client-only ones. */
export const ARCHIVE_ERROR_MESSAGES = {
  'invalid-body': 'El archivo enviado no es válido.',
  'access-denied': 'No tienes acceso al archivo de facturas.',
  'not-found': 'No se encontró el PDF solicitado.',
  'method-not-allowed': 'Operación no permitida en el archivo de facturas.',
  conflict: 'Ya existe un archivo en conflicto con esta operación.',
  'too-large': 'El PDF supera el tamaño máximo permitido (20 MB).',
  'unsupported-media-type': 'Solo se admiten archivos PDF.',
  'internal-error': 'Error interno al procesar el archivo de facturas.',
  network: 'No se pudo conectar con el servidor. Verifica tu conexión.',
  'hash-mismatch': 'El archivo recibido no coincide con el enviado.',
  'invalid-digest': 'El identificador del PDF no es válido.',
};

export class InvoiceArchiveError extends Error {
  constructor(code, status) {
    super(ARCHIVE_ERROR_MESSAGES[code] || `Invoice archive error: ${code}`);
    this.name = 'InvoiceArchiveError';
    this.code = code;
    this.status = status;
  }
}

/** Firebase ID token for the request, or access-denied when unavailable. */
const resolveToken = async (user) => {
  if (!user || typeof user.getIdToken !== 'function') {
    throw new InvoiceArchiveError('access-denied');
  }
  try {
    return await user.getIdToken();
  } catch {
    throw new InvoiceArchiveError('access-denied');
  }
};

/** The `{ error }` code from a non-200 JSON error envelope, defaulting safely. */
const errorCodeFrom = async (response) => {
  try {
    const body = await response.json();
    return body?.error ?? 'internal-error';
  } catch {
    return 'internal-error';
  }
};

/**
 * Uploads raw PDF bytes and returns the server-confirmed descriptor.
 *
 * @param {{ user: object, bytes: ArrayBuffer|Uint8Array, expectedSha256?: string }} params
 * @param {{ fetchImpl?: typeof fetch }} [deps]
 * @returns {Promise<{ sha256: string, sizeBytes: number, mimeType: string }>}
 */
export const uploadInvoicePdf = async (
  { user, bytes, expectedSha256 } = {},
  { fetchImpl = globalThis.fetch } = {},
) => {
  const token = await resolveToken(user);

  let response;
  try {
    response = await fetchImpl(UPLOAD_PATH, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': MIME_TYPE,
      },
      body: bytes,
    });
  } catch {
    throw new InvoiceArchiveError('network');
  }

  if (response.status !== 200) {
    throw new InvoiceArchiveError(await errorCodeFrom(response), response.status);
  }

  const payload = await response.json();
  if (expectedSha256 && payload?.sha256 !== expectedSha256) {
    throw new InvoiceArchiveError('hash-mismatch');
  }

  return { sha256: payload.sha256, sizeBytes: payload.sizeBytes, mimeType: payload.mimeType };
};

/**
 * Downloads a previously archived PDF by its SHA-256 digest.
 *
 * @param {{ user: object, sha256: string }} params
 * @param {{ fetchImpl?: typeof fetch }} [deps]
 * @returns {Promise<Blob>}
 */
export const fetchInvoicePdf = async ({ user, sha256 } = {}, { fetchImpl = globalThis.fetch } = {}) => {
  if (typeof sha256 !== 'string' || !SHA256_RE.test(sha256)) {
    throw new InvoiceArchiveError('invalid-digest');
  }

  const token = await resolveToken(user);

  let response;
  try {
    response = await fetchImpl(`${UPLOAD_PATH}/${sha256}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    throw new InvoiceArchiveError('network');
  }

  if (response.status !== 200) {
    throw new InvoiceArchiveError(await errorCodeFrom(response), response.status);
  }

  const blob = await response.blob();
  return blob.type === MIME_TYPE ? blob : new Blob([blob], { type: MIME_TYPE });
};
