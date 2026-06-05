/**
 * Browser-side PDF text extraction for DATEV payroll imports.
 *
 * pdfjs returns positioned text items, NOT lines. We reconstruct lines by
 * grouping items on the same Y coordinate (top→bottom) and ordering each line
 * left→right. This matches the line shape the datevPayrollParser expects.
 *
 * pdfjs (~400kB) is loaded LAZILY on first extraction so it never weighs down
 * the Nóminas route chunk — it only downloads when the user actually imports.
 *
 * Pure parsing lives in datevPayrollParser.js (unit-tested). This module is the
 * thin pdfjs adapter and is not unit-tested (it needs the pdfjs worker).
 */
import { logError } from '../../../utils/logger';
import { classifyPayrollPdf } from './datevPayrollParser';

let pdfjsPromise = null;

/** Lazy-load pdfjs and wire its worker exactly once. */
const loadPdfjs = async () => {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const pdfjsLib = await import('pdfjs-dist');
      const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
      pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
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
 * @returns {Promise<{ texts: Object<string,string>, recognized: string[], ignored: string[] }>}
 */
export const extractPayrollTexts = async (files) => {
  const texts = {};
  const ignored = [];
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
      ignored.push(file.name);
    }
  }
  return { texts, recognized: Object.keys(texts), ignored };
};
