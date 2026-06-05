/**
 * Browser-side PDF text extraction for DATEV payroll imports.
 *
 * pdfjs returns positioned text items, NOT lines. We reconstruct lines by
 * grouping items on the same Y coordinate (top→bottom) and ordering each line
 * left→right. This matches the line shape the datevPayrollParser expects.
 *
 * pdfjs (~400kB) + its worker are loaded LAZILY on first extraction so they
 * never weigh down the Nóminas route chunk — they download only when the user
 * actually imports. The worker is instantiated via Vite's `?worker` import so
 * it loads as a proper ES module worker (setting workerSrc to a URL makes pdfjs
 * load the ESM worker as a classic worker, which fails in production).
 *
 * Pure parsing lives in datevPayrollParser.js (unit-tested). This module is the
 * thin pdfjs adapter and is not unit-tested (it needs the pdfjs worker).
 */
import { logError } from '../../../utils/logger';
import { classifyPayrollPdf } from './datevPayrollParser';

let pdfjsPromise = null;

/** Compute the SHA-256 hex digest of an ArrayBuffer via the Web Crypto API. */
const sha256Hex = async (arrayBuffer) => {
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
 * (computed from the SAME buffer read here, so callers don't re-read the file)
 * and is used for the document-fingerprint registry.
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

/**
 * Extract and classify a list of dropped/selected files.
 * @param {File[]} files
 * @returns {Promise<{
 *   texts,
 *   documents: Array<{hash,fileName,kind,pageCount}>,
 *   recognized: string[],
 *   ignored: string[],
 *   failed: Array<{name,error}>
 * }>}
 *   texts      — per recognized DATEV type → reconstructed line text
 *   documents  — per recognized file: sha-256 hash + fileName + kind + pageCount
 *                (no Firebase Storage upload — fingerprint registry only)
 *   recognized — DATEV files read successfully
 *   ignored    — files whose name prefix is not a known DATEV report
 *   failed     — known DATEV files that could not be read (carries the error)
 */
export const extractPayrollTexts = async (files) => {
  const texts = {};
  const documents = [];
  const ignored = [];
  const failed = [];
  for (const file of files) {
    const type = classifyPayrollPdf(file.name);
    if (type === 'unknown') {
      ignored.push(file.name);
      continue;
    }
    try {
      const { text, pageCount, hash } = await extractPdfText(file);
      texts[type] = text;
      documents.push({ hash, fileName: file.name, kind: type, pageCount });
    } catch (err) {
      logError('Failed to extract payroll PDF text:', file.name, err);
      failed.push({ name: file.name, error: err?.message || String(err) });
    }
  }
  return { texts, documents, recognized: Object.keys(texts), ignored, failed };
};
