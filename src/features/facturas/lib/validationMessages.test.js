import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { translateValidationMessage } from "./validationMessages";

const CORE_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../finance/invoiceArchive.js",
);

// Every literal `requireValue(condition, "message")` string thrown by the
// core (src/finance/invoiceArchive.js), enumerated by hand. The `: field`
// suffix message ("Existing invoice conflict: ...") is a template literal in
// the core, not a plain string, and is exercised separately below; the guard
// test further down extracts it from source instead of trusting this list.
const CORE_LITERAL_MESSAGES = [
  "Invalid invoice direction",
  "Human confirmation is required",
  "Only invoices are supported; credit notes are unsupported",
  "Explicit sourceSystem is required",
  "Insyte invoices must be outgoing",
  "Invalid ISO invoice date",
  "Invalid calendar invoice date",
  "Only EUR is supported; no currency conversion",
  "Invalid invoice totals",
  "Unbalanced invoice totals",
  "Invalid SHA-256",
  "Invalid PDF size",
  "Only PDF files are supported",
  "Missing obligation selection",
  "Invalid or mixed obligation family",
  "Invalid recordId",
  "Existing archived invoice conflict or unresolved identity",
  "links must be an array",
  "Explicit link mode is required",
  "Insyte is link-only",
  "Creation cannot attach existing obligations",
  "Existing obligation references are required",
  "Duplicate obligation link",
  "Unresolved or ambiguous obligation reference",
  "Counterparty mismatch",
  "Obligation source mismatch",
];

/**
 * Extracts the literal (plain double-quoted, non-template) message string
 * from every `requireValue(condition, "message")` call in the core source,
 * by scanning for balanced parens from each `requireValue(` call site.
 * Template-literal messages (backtick, dynamic field text) never match the
 * trailing-quote pattern and are intentionally excluded — they cannot be
 * exact-matched and are covered by the prefix-rule test instead. This keeps
 * the translation table honest: a new literal core message fails this guard
 * until it is also added to validationMessages.js.
 */
function extractRequireValueLiterals(source) {
  const messages = [];
  const marker = "requireValue(";
  let index = source.indexOf(marker);
  while (index !== -1) {
    let depth = 1;
    let cursor = index + marker.length;
    while (depth > 0 && cursor < source.length) {
      if (source[cursor] === "(") depth += 1;
      else if (source[cursor] === ")") depth -= 1;
      cursor += 1;
    }
    const call = source.slice(index + marker.length, cursor - 1).trimEnd();
    const match = /"((?:[^"\\]|\\.)*)"\s*,?\s*$/.exec(call);
    if (match) messages.push(match[1]);
    index = source.indexOf(marker, cursor);
  }
  return messages;
}

describe("translateValidationMessage", () => {
  it("translates every enumerated core validation message to Spanish", () => {
    for (const message of CORE_LITERAL_MESSAGES) {
      const translated = translateValidationMessage(new Error(message));
      expect(translated).not.toBe(message);
      expect(translated.length).toBeGreaterThan(0);
    }
  });

  it('translates the "Existing invoice conflict: <field>" suffix, keeping the field', () => {
    for (const field of ["rechnungId", "invoiceNumber", "documentNumber"]) {
      const translated = translateValidationMessage(
        new Error(`Existing invoice conflict: ${field}`),
      );
      expect(translated).toBe(`Conflicto con factura existente: ${field}`);
    }
  });

  it("falls back to the original message for unknown input", () => {
    const message = "Some future core message not yet translated";
    expect(translateValidationMessage(new Error(message))).toBe(message);
  });

  it("accepts a plain string as well as an Error", () => {
    expect(translateValidationMessage("Counterparty mismatch")).toBe(
      "La contraparte no coincide",
    );
    expect(translateValidationMessage("")).toBe("");
  });

  it("guards against drift: every literal requireValue(...) message in the core has a translation", () => {
    const source = readFileSync(CORE_PATH, "utf8");
    const literals = extractRequireValueLiterals(source);
    // Sanity check on the extractor itself: it must find every message this
    // test already knows about, or it is silently failing to parse the core.
    expect(literals.sort()).toEqual([...CORE_LITERAL_MESSAGES].sort());
    for (const message of literals) {
      const translated = translateValidationMessage(new Error(message));
      expect(
        translated,
        `no Spanish translation for core message: ${message}`,
      ).not.toBe(message);
    }
  });
});
