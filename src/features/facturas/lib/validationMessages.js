/**
 * Neutral, professional Spanish translations for the English validation
 * messages thrown by the pure core (src/finance/invoiceArchive.js —
 * validateConfirmedInvoice / validateInvoiceFile / planInvoiceLink). The core
 * itself stays in English (see CLAUDE.md: code/comments in English, UI copy
 * in Spanish); this module is the one place that bridges the two for the
 * Facturas intake UI.
 *
 * Exact-match by message text. "Existing invoice conflict: <field>" carries a
 * dynamic field suffix (rechnungId | invoiceNumber | documentNumber), so it
 * is handled as a prefix rule instead of an exact key. Any message this table
 * does not recognize falls back to the original (English) text unchanged —
 * the core stays the single source of truth for wording, this never guesses.
 */

const EXACT_MESSAGES = {
  "Invalid invoice direction": "Dirección de factura no válida",
  "Human confirmation is required": "Se requiere confirmación humana",
  "Only invoices are supported; credit notes are unsupported":
    "Solo se admiten facturas; las notas de crédito no son compatibles",
  "Explicit sourceSystem is required":
    "Se requiere un sistema de origen explícito",
  "Insyte invoices must be outgoing":
    "Las facturas de Insyte deben ser emitidas (salientes)",
  "Invalid ISO invoice date": "Fecha de factura ISO no válida",
  "Invalid calendar invoice date":
    "Fecha de factura no válida en el calendario",
  "Only EUR is supported; no currency conversion":
    "Solo se admite EUR; no hay conversión de moneda",
  "Invalid invoice totals": "Totales de factura no válidos",
  "Unbalanced invoice totals": "Los totales de la factura no cuadran",
  "Invalid SHA-256": "SHA-256 no válido",
  "Invalid PDF size": "Tamaño de PDF no válido",
  "Only PDF files are supported": "Solo se admiten archivos PDF",
  "Missing obligation selection": "Falta seleccionar la obligación",
  "Invalid or mixed obligation family":
    "Familia de obligación no válida o mixta",
  "Invalid recordId": "Identificador de registro (recordId) no válido",
  "Existing archived invoice conflict or unresolved identity":
    "Conflicto con la factura archivada existente o identidad sin resolver",
  "links must be an array": "links debe ser un arreglo",
  "Explicit link mode is required":
    "Se requiere un modo de vinculación explícito",
  "Insyte is link-only": "Insyte solo permite vincular, no crear",
  "Creation cannot attach existing obligations":
    "La creación no puede vincular obligaciones existentes",
  "Existing obligation references are required":
    "Se requieren referencias a obligaciones existentes",
  "Duplicate obligation link": "Vínculo de obligación duplicado",
  "Unresolved or ambiguous obligation reference":
    "Referencia de obligación sin resolver o ambigua",
  "Counterparty mismatch": "La contraparte no coincide",
  "Obligation source mismatch":
    "El sistema de origen de la obligación no coincide",
};

// [englishPrefix, spanishPrefix] — matched only when no exact key applies;
// the original suffix (the field name) is preserved verbatim.
const PREFIXED_MESSAGES = [
  ["Existing invoice conflict: ", "Conflicto con factura existente: "],
];

/**
 * Translates a core validation message to neutral Spanish. Accepts an Error
 * (reads `.message`) or a plain string. Unknown messages pass through
 * unchanged rather than being mistranslated or hidden.
 */
export const translateValidationMessage = (error) => {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (Object.hasOwn(EXACT_MESSAGES, message)) return EXACT_MESSAGES[message];
  for (const [prefix, translatedPrefix] of PREFIXED_MESSAGES) {
    if (message.startsWith(prefix)) {
      return `${translatedPrefix}${message.slice(prefix.length)}`;
    }
  }
  return message;
};
