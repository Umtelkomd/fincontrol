# Feature: safari-pdf-extraction

Locator: `odd/tasks/safari-pdf-extraction.md` · Engram topic: `odd/safari-pdf-extraction/tasks`
Branch: `fix/safari-pdf-extraction` (from `main` @ b2dab07)
Delivery strategy: `single-pr`, small.
TDD: applicable for the polyfill and the intake notice · Runner: `npx vitest run <file>` (full: `npm test`) · Lint: `npm run lint` · Build: `npm run build`
RDD: on (global) → native review offered per work-unit commit.

## Objective
Invoice (and payroll) PDF intake must work in Safari 26.x, and a PDF without a text layer must open the
confirm form for manual entry instead of failing with the misleading "scanned PDF" message.

## Problem (verified evidence, 2026-10-09)
1. **Safari cannot extract any PDF.** pdfjs-dist 6.0.227 `getTextContent` iterates `for await (const value of readableStream)`.
   `ReadableStream[Symbol.asyncIterator]` ships only in Safari 27 (MDN BCD); the user runs Safari 26.6. Reproduced with
   Playwright WebKit through the Vite dev server against the real `src/lib/pdf/extractPdfText.js`:
   `TypeError: undefined is not a function (near '...value of readableStream...')` — for a text PDF (BWA, ArialMT) and for the
   invoice alike. Node (legacy build) extracts both fine.
2. **Error message hides the cause.** `src/features/facturas/components/InvoiceIntakePanel.jsx:189` bare `catch {}` maps every
   failure (pdfjs, header parser, classifier) to "Asegúrate de que sea un PDF con texto (no escaneado)" and logs nothing.
3. **No-text PDFs.** "Umtelkomd GmbH- Factura de honorarios 08.2026.pdf" (Producer "Microsoft: Print To PDF", from the accounting
   program) has 0 fonts; glyphs are vector paths → 0 extracted chars. With empty text the intake already reaches the confirm form
   (verified with a probe test), but silently with blank fields.

## Decision
Owner chose manual entry for no-text PDFs (no in-app OCR). Fix the Safari root cause with a minimal polyfill rather than switching
to the pdfjs legacy build.

## Tasks
- [x] 1. Polyfill `ReadableStream.prototype[Symbol.asyncIterator]`/`values` before pdfjs loads; unit test; verify in WebKit.
- [x] 2. Invoice intake: empty-text notice for manual entry + catch logs the real error with an accurate message; tests.
  (Former tasks 2 and 3 merged: both change the same extraction handler in `InvoiceIntakePanel.jsx`.)

## Evidence log
- Task 1 — `77455f7`. RED: missing module, then no-op stub `4 failed | 2 passed` (`stream is not async iterable`). GREEN: `npx vitest run src/lib/pdf` 6/6; eslint clean. Playwright WebKit + Vite dev server with real `extractPdfText`: BWA PDF ok (2461 chars), honorarios invoice ok (0 chars, no throw); before the fix both threw.
- Task 2 — see commit below. RED: `npx vitest run src/features/facturas` 5 failed | 173 passed. GREEN: 178/178. Full `npm test` 3302/3302, `npm run lint` clean, `npm run build` ok. Not yet checked by hand in a real Safari.
