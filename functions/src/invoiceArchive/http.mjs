import { ArchiveAccessError } from "./authorize.mjs";
import { ArchiveUploadError } from "./upload.mjs";
import { ArchiveReadError } from "./read.mjs";
import { MAX_BYTES, MIME_TYPE, hasPdfSignature, sha256 } from "./blob.mjs";

const ROOT = "/api/invoice-pdfs";
const DOWNLOAD = /^\/api\/invoice-pdfs\/([a-f0-9]{64})$/;
const ERRORS = {
  400: "invalid-body",
  403: "access-denied",
  404: "not-found",
  405: "method-not-allowed",
  409: "conflict",
  413: "too-large",
  415: "unsupported-media-type",
  500: "internal-error",
};

class HttpError extends Error {
  constructor(status) {
    super(ERRORS[status]);
    this.status = status;
  }
}

function errorStatus(error) {
  if (error instanceof HttpError) return error.status;
  if (error instanceof ArchiveAccessError) return 403;
  if (
    error instanceof ArchiveUploadError ||
    error instanceof ArchiveReadError
  ) {
    switch (error.code) {
      case "accessdenied":
        return 403;
      case "invalidpdf":
        return 415;
      case "invaliddigest":
        return 400;
      case "conflict":
        return 409;
      case "notfound":
        return 404;
    }
  }
  return 500;
}

function contentLength(req) {
  const value = req.headers["content-length"];
  if (value === undefined) return null;
  if (typeof value !== "string" || !/^[0-9]+$/.test(value)) {
    throw new HttpError(400);
  }
  const length = Number(value);
  if (!Number.isSafeInteger(length) || length > MAX_BYTES)
    throw new HttpError(413);
  return length;
}

function checkLength(bytes, declared) {
  if (bytes.length > MAX_BYTES) throw new HttpError(413);
  if (!bytes.length || (declared !== null && bytes.length !== declared)) {
    throw new HttpError(400);
  }
  return bytes;
}

function bodyBytes(req, declared) {
  // Cloud Functions may already own a Buffer. The upload core copies it before
  // its first await; do not introduce another 20 MiB copy at this boundary.
  if (req.rawBody !== undefined) {
    if (!Buffer.isBuffer(req.rawBody)) throw new HttpError(400);
    return checkLength(req.rawBody, declared);
  }
  if (req.aborted || req.destroyed || req.readableEnded)
    throw new HttpError(400);
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    function finish(error) {
      req.pause();
      req.off("data", onData);
      req.off("end", onEnd);
      req.off("aborted", onFailure);
      req.off("error", onFailure);
      req.off("close", onClose);
      if (error) reject(error);
      else resolve(Buffer.concat(chunks, size));
      chunks.length = 0;
    }
    function onData(chunk) {
      if (!Buffer.isBuffer(chunk)) return finish(new HttpError(400));
      size += chunk.length;
      // Never retain the overflowing chunk or concatenate an unchecked stream.
      if (size > MAX_BYTES) return finish(new HttpError(413));
      chunks.push(chunk);
    }
    function onEnd() {
      const invalid = !size || (declared !== null && size !== declared);
      finish(invalid ? new HttpError(400) : null);
    }
    function onFailure() {
      finish(new HttpError(400));
    }
    function onClose() {
      if (!req.complete) onFailure();
    }
    req.on("data", onData);
    req.once("end", onEnd);
    req.once("aborted", onFailure);
    req.once("error", onFailure);
    req.once("close", onClose);
  });
}

function json(res, status, payload) {
  const bytes = Buffer.from(JSON.stringify(payload));
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": bytes.length,
  });
  res.end(bytes);
}

/** Same-origin boundary only: no cookies, CORS, SDK or runtime bootstrap.
 * Accept only bare application/pdf (case-insensitive); parameters are rejected.
 * The host still owns ingress limits/timeouts, including pre-buffered rawBody.
 */
export function createArchiveHttpHandler({ authorize, upload, read } = {}) {
  const dependencies = [authorize, upload, read];
  if (!dependencies.every((dependency) => typeof dependency === "function")) {
    throw new TypeError("Invalid archive HTTP dependencies");
  }
  return async function archiveHttpHandler(req, res) {
    // Keep a listener through socket teardown: abort can be followed by error.
    const ignoreStreamError = () => {};
    req.on("error", ignoreStreamError);
    req.once("close", () => req.off("error", ignoreStreamError));
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Vary", "Authorization");
    try {
      // Match the original target, not Express query/path normalization.
      const target = req.originalUrl ?? req.url;
      const match = typeof target === "string" ? DOWNLOAD.exec(target) : null;
      if (target !== ROOT && !match) throw new HttpError(404);
      if (
        (target === ROOT && req.method !== "POST") ||
        (match && req.method !== "GET")
      ) {
        res.setHeader("Allow", "GET, POST");
        throw new HttpError(405);
      }
      let count = 0;
      for (let index = 0; index < (req.rawHeaders?.length ?? 0); index += 2) {
        if (req.rawHeaders[index].toLowerCase() === "authorization") count++;
      }
      const header = req.headers.authorization;
      const ambiguous = count > 1 || Array.isArray(header);
      // Send malformed/missing values through the trusted gate, never cache it.
      try {
        await authorize(ambiguous ? undefined : header);
        if (ambiguous) throw new HttpError(403);
      } catch {
        throw new HttpError(403);
      }
      if (req.method === "POST") {
        const type = req.headers["content-type"];
        const encoding = req.headers["content-encoding"];
        if (
          typeof type !== "string" ||
          type.toLowerCase() !== MIME_TYPE ||
          (encoding !== undefined && encoding !== "identity")
        ) {
          throw new HttpError(415);
        }
        const bytes = await bodyBytes(req, contentLength(req));
        const expectedDigest = sha256(bytes);
        const uploaded = await upload({ authorization: header, bytes });
        const { sha256: digest, sizeBytes, mimeType } = uploaded ?? {};
        if (
          digest !== expectedDigest ||
          sizeBytes !== bytes.length ||
          mimeType !== MIME_TYPE
        ) {
          throw new HttpError(500);
        }
        json(res, 200, { sha256: digest, sizeBytes, mimeType });
      } else {
        const digest = match[1];
        const bytes = await read({ authorization: header, sha256: digest });
        if (
          !Buffer.isBuffer(bytes) ||
          !bytes.length ||
          bytes.length > MAX_BYTES ||
          !hasPdfSignature(bytes) ||
          sha256(bytes) !== digest
        ) {
          throw new HttpError(500);
        }
        res.writeHead(200, {
          "Content-Type": MIME_TYPE,
          "Content-Length": bytes.length,
          "Content-Disposition": `inline; filename="${digest}.pdf"`,
        });
        res.end(bytes);
      }
    } catch (error) {
      if (res.destroyed || res.writableEnded) return;
      if (!req.readableEnded) {
        req.pause();
        res.setHeader("Connection", "close");
        // Flush the JSON before closing; never destroy req before the response.
        res.once("finish", () => req.socket?.destroySoon());
      }
      const status = errorStatus(error);
      json(res, status, { error: ERRORS[status] });
    }
  };
}
