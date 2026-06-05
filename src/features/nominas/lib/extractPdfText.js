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

/** Extract reconstructed-line text from a PDF File/Blob. */
export const extractPdfText = async (file) => {
  const pdfjsLib = await loadPdfjs();
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjsLib.getDocument({ data, isEvalSupported: false }).promise;
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
    await pdf.destroy();
  }
  return out;
};

/**
 * Extract and classify a list of dropped/selected files.
 * @param {File[]} files
 * @returns {Promise<{ texts, recognized: string[], ignored: string[], failed: Array<{name,error}> }>}
 *   recognized — DATEV files read successfully
 *   ignored    — files whose name prefix is not a known DATEV report
 *   failed     — known DATEV files that could not be read (carries the error)
 */
export const extractPayrollTexts = async (files) => {
  const texts = {};
  const ignored = [];
  const failed = [];
  for (const file of files) {
    const type = classifyPayrollPdf(file.name);
    if (type === 'unknown') {
      ignored.push(file.name);
      continue;
    }
    try {
       
      texts[type] = await extractPdfText(file);
    } catch (err) {
      logError('Failed to extract payroll PDF text:', file.name, err);
      failed.push({ name: file.name, error: err?.message || String(err) });
    }
  }
  return { texts, recognized: Object.keys(texts), ignored, failed };
};
