/**
 * Generic browser-side PDF text extraction adapter.
 *
 * pdfjs returns positioned text items, NOT lines. We reconstruct lines by
 * grouping items on the same Y coordinate (top→bottom) and ordering each line
 * left→right.
 *
 * pdfjs (~400kB) + its worker are loaded LAZILY on first extraction so they
 * never weigh down the importing route's chunk — they download only when the
 * caller actually extracts a PDF. The worker is instantiated via Vite's
 * `?worker` import so it loads as a proper ES module worker (setting
 * workerSrc to a URL makes pdfjs load the ESM worker as a classic worker,
 * which fails in production).
 *
 * Not unit-tested — it needs the pdfjs worker (jsdom has no Worker/canvas
 * support), so it is exercised only through manual/integration testing of its
 * callers. Pure parsing of the extracted text belongs in caller-specific
 * modules (e.g. datevPayrollParser.js, invoiceHeaderParser.js), which ARE
 * unit-tested.
 */
let pdfjsPromise = null;

/** Compute the SHA-256 hex digest of an ArrayBuffer via the Web Crypto API. */
export const sha256Hex = async (arrayBuffer) => {
  const digest = await crypto.subtle.digest('SHA-256', arrayBuffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
};

/** Lazy-load pdfjs and instantiate its module worker exactly once. */
const loadPdfjs = async () => {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const pdfjsLib = await import('pdfjs-dist');
      const { default: PdfjsWorker } = await import('pdfjs-dist/build/pdf.worker.min.mjs?worker');
      pdfjsLib.GlobalWorkerOptions.workerPort = new PdfjsWorker();
      return pdfjsLib;
    })();
  }
  return pdfjsPromise;
};

/**
 * Extract reconstructed-line text from a PDF File/Blob.
 * Returns { text, pageCount, hash } — hash is the SHA-256 hex of the raw bytes
 * (computed from the SAME buffer read here, so callers don't re-read the file).
 */
export const extractPdfText = async (file) => {
  const pdfjsLib = await loadPdfjs();
  const buffer = await file.arrayBuffer();
  const hash = await sha256Hex(buffer);
  const data = new Uint8Array(buffer.slice(0));
  const loadingTask = pdfjsLib.getDocument({ data, isEvalSupported: false });
  const pdf = await loadingTask.promise;
  const pageCount = pdf.numPages;
  let out = '';
  try {
    for (let p = 1; p <= pdf.numPages; p += 1) {

      const page = await pdf.getPage(p);

      const content = await page.getTextContent();

      const rows = {};
      for (const item of content.items) {
        if (!item.str || !item.str.trim()) continue;
        const y = Math.round(item.transform[5]);
        (rows[y] ||= []).push(item);
      }

      const ys = Object.keys(rows)
        .map(Number)
        .sort((a, b) => b - a); // top to bottom
      for (const y of ys) {
        const items = rows[y].sort((a, b) => a.transform[4] - b.transform[4]);
        out += `${items.map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim()}\n`;
      }
    }
  } finally {
    // Cleanup is best-effort — pdfjs v6 destroys via the loading task, and a
    // cleanup error must never discard the text we already extracted.
    try {
      await loadingTask.destroy();
    } catch {
      /* ignore */
    }
  }
  return { text: out, pageCount, hash };
};
