/**
 * Browser-side PDF text extraction for DATEV payroll imports.
 *
 * The generic pdfjs adapter (line reconstruction, lazy worker loading, SHA-256
 * hashing) now lives in ../../../lib/pdf/extractPdfText so other features
 * (e.g. invoice PDF intake) can reuse it without depending on nóminas. This
 * module re-exports it for existing callers and keeps the DATEV-specific
 * batch/classify helper below.
 *
 * Pure parsing lives in datevPayrollParser.js (unit-tested). extractPdfText
 * itself is not unit-tested (it needs the pdfjs worker).
 */
import { logError } from '../../../utils/logger';
import { extractPdfText } from '../../../lib/pdf/extractPdfText';
import { classifyPayrollPdf } from './datevPayrollParser';

export { extractPdfText };

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
