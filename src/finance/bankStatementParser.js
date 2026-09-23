/**
 * Bank statement CSV parser (RFC 4180-ish, quoted multiline tolerant)
 *
 * The bank statement, not DATEV, is the reconciliation source. This module
 * parses TWO real Volksbank export layouts. `detectBankStatementFormat`
 * resolves which one a file is by header NAME, never by position or file
 * name, and every column is then read through a per-format index
 * (`resolveColumnIndex`) — never a fixed position — so an inserted or
 * reordered column never shifts the rest.
 *
 * 1. "kontobewegungen_export" — `sourceFormat: 'sparkasse-kontobewegungen'`.
 *    UTF-8, `;`, 12 columns: Automat, Sammlerauflösung, Buchungsdatum,
 *    Valutadatum, Empfängername/Auftraggeber, IBAN/Kontonummer, BIC/BLZ,
 *    Verwendungszweck, Betrag in EUR, Notiz, Anzahl Belege, Geprüft.
 *    Optionally carries a 14th running-balance column — any of "Saldo",
 *    "Saldo nach Buchung", "Kontostand", "Saldo in EUR", "Kontostand nach
 *    Buchung" — in ANY position (`resolveBalanceColumnIndex`). When present,
 *    each row gets a numeric `balanceAfter`. The dedupe hash still carries
 *    the "datev-" prefix and the "sparkasse-kontobewegungen" format id must
 *    not be renamed — they are frozen identity fields folded into rowHash;
 *    renaming either would make every already-stored movement look new on
 *    the next import. The balance column is deliberately EXCLUDED from
 *    `row.raw.columns` (reconstructed in canonical order, not a positional
 *    slice) because `raw.columns` feeds `rowHash` — the invariant is: the
 *    same movement hashes the same whether or not the file carries a
 *    balance column.
 *
 * 2. "Umsätze" — `sourceFormat: 'volksbank-umsaetze'`. UTF-8, `;`, CRLF, 18
 *    columns, newest-first, ALWAYS carries "Saldo nach Buchung" (not
 *    optional here). Header: Bezeichnung/IBAN/BIC/Bankname Auftragskonto,
 *    Buchungstag, Valutadatum, Name/IBAN/BIC Zahlungsbeteiligter,
 *    Buchungstext, Verwendungszweck, Betrag, Waehrung, Saldo nach Buchung,
 *    Bemerkung, Gekennzeichneter Umsatz, Glaeubiger ID, Mandatsreferenz.
 *    Fee/closing rows (Buchungstext "Entgelt/Auslagen", "Abschluss") carry
 *    an empty Name Zahlungsbeteiligter — counterpartyName falls back to
 *    Bankname Auftragskonto so the movement is never nameless. Unlike
 *    format 1, `row.raw.columns` here is ALL 18 columns in file order
 *    INCLUDING Saldo nach Buchung: it is deterministic per booking and is
 *    what tells two same-day, same-amount transfers apart, so it stays IN
 *    the hash for this format (the phase-2 exclusion rule above is
 *    format-1-only).
 *
 * Both formats share: German dates (DD.MM.YYYY), German amounts
 * (1.234,56 / -12,98), positive=inflow/negative=outflow, and the shared
 * `datev-` rowHash prefix. `sourceFormat` is itself folded into the
 * fingerprint (`buildBankRowIdentity`), so the two formats can never
 * collide even if every other field matched.
 */

/**
 * `importSource` on a bankMovement is 'datev' for the 720 documents written
 * before this parser was renamed, and 'bank-csv' for every import since.
 * Both mean the same thing: imported from the bank statement CSV. Readers
 * must accept either — never gate logic on a single literal value.
 */
export const BANK_IMPORT_SOURCES = ['datev', 'bank-csv'];

export const isBankImport = (movement) => BANK_IMPORT_SOURCES.includes(movement?.importSource);

/** RFC 4180-style CSV parser that respects quoted multiline fields. */
export const parseCSVText = (text, separator = ';') => {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === separator) {
        row.push(field);
        field = '';
      } else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        if (field !== '' || row.length > 0) {
          row.push(field);
          rows.push(row);
          row = [];
          field = '';
        }
      } else {
        field += c;
      }
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
};

/** Convert German number "1.234,56" → JS 1234.56. */
export const parseGermanAmount = (str) => {
  if (str == null) return 0;
  if (typeof str === 'number') return Number.isFinite(str) ? str : 0;
  const s = String(str).trim();
  if (!s) return 0;
  const normalized = s.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(normalized);
  return Number.isFinite(n) ? n : 0;
};

export const normalizeBankRowAmount = (value) => parseGermanAmount(value).toFixed(2);

// Balances are authoritative: unlike the legacy amount normalizer, never
// accept numeric prefixes, malformed grouping, or turn invalid text into zero.
const parseOptionalBalance = (value) => {
  const text = String(value ?? '').trim();
  if (!/^[+-]?(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?$/.test(text)) return null;
  const balance = Number(text.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(balance) ? balance : null;
};

// CSV observations must be whole, safely representable cents. Keep the exported
// permissive amount normalizer frozen for legacy identity compatibility.
const parseObservedAmount = (value) => {
  const amount = parseOptionalBalance(value);
  if (amount === null) return null;
  const [whole, fraction = ''] = String(value).trim().replace(/\./g, '').split(',');
  const cents = Number(`${whole}${fraction.padEnd(2, '0')}`);
  return Number.isSafeInteger(cents) && Math.round(amount * 100) === cents ? amount : null;
};

/** Convert German date "DD.MM.YYYY" → ISO "YYYY-MM-DD". */
export const parseGermanDate = (str) => {
  if (!str) return '';
  const m = String(str).trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!m) return '';
  return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
};

export const normalizeBankRowDate = parseGermanDate;

const normalizeText = (value) => String(value || '').replace(/\s+/g, ' ').trim();

export const normalizeBankRowCounterparty = (value) => normalizeText(value).toLowerCase();

export const normalizeBankRowIbanBic = (value) => normalizeText(value).replace(/\s+/g, '').toUpperCase();

export const normalizeBankRowDescription = (value) => normalizeText(value).toLowerCase();

export const normalizeBankRowRawColumns = (columns) => (columns || []).map(normalizeText);

const stableHash = (value) => {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  const input = String(value);
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const combined = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return combined.toString(16).padStart(14, '0');
};

export const buildBankRowIdentity = (row) => {
  const normalizedColumns = normalizeBankRowRawColumns(row.raw?.columns);
  const parts = [
    row.sourceFormat || 'sparkasse-kontobewegungen',
    row.accountId || row.sourceAccountIban || '',
    normalizeBankRowDate(row.postedDate) || row.postedDate || '',
    normalizeBankRowDate(row.valueDate) || row.valueDate || row.postedDate || '',
    Number(row.signedAmount ?? row.amountSigned ?? row.amount ?? 0).toFixed(2),
    normalizeBankRowCounterparty(row.counterpartyName),
    normalizeBankRowIbanBic(row.counterpartyIban),
    normalizeBankRowIbanBic(row.counterpartyBic),
    normalizeBankRowDescription(row.rawDescription || row.description),
    normalizedColumns.join('|').toLowerCase(),
  ];
  const rowFingerprint = parts.join('||');
  return {
    rowFingerprint,
    rowHash: `datev-${stableHash(rowFingerprint)}`,
  };
};

const parseGermanBool = (str) => String(str || '').trim().toLowerCase() === 'ja';

const normalizeHeader = (header) => normalizeBankRowRawColumns(header).map((col) => col.toLowerCase());

/**
 * The 12 required kontobewegungen_export columns, keyed by the field they
 * feed. Column order in the file is NOT assumed — every file we've seen
 * matches this order, but a bank could ship an extra column (e.g. a running
 * balance) anywhere, including in the middle. Row parsing resolves each
 * column by its header NAME via `resolveColumnIndex`, never by a fixed
 * position, so an inserted column shifts nothing.
 */
const REQUIRED_COLUMNS = [
  { key: 'automat', name: 'automat' },
  { key: 'sammler', name: 'sammlerauflösung' },
  { key: 'postedDate', name: 'buchungsdatum' },
  { key: 'valueDate', name: 'valutadatum' },
  { key: 'counterpartyName', name: 'empfängername/auftraggeber' },
  { key: 'counterpartyIban', name: 'iban/kontonummer' },
  { key: 'counterpartyBic', name: 'bic/blz' },
  { key: 'description', name: 'verwendungszweck' },
  { key: 'amount', name: 'betrag in eur' },
  { key: 'notes', name: 'notiz' },
  { key: 'receiptCount', name: 'anzahl belege' },
  { key: 'verified', name: 'geprüft' },
];

/**
 * A bank statement may optionally carry a running balance column. Any of
 * these names (case-insensitive, after the same header normalization used
 * everywhere else) is recognized, wherever it sits in the file.
 */
const BALANCE_COLUMN_NAMES = new Set([
  'saldo',
  'saldo nach buchung',
  'kontostand',
  'saldo in eur',
  'kontostand nach buchung',
]);

/**
 * The 18 "Umsätze" export columns, keyed by the field they feed. Same
 * name-indexed resolution as REQUIRED_COLUMNS — column order is read from
 * the header, never assumed.
 */
const UMSAETZE_COLUMNS = [
  { key: 'accountLabel', name: 'bezeichnung auftragskonto' },
  { key: 'accountIban', name: 'iban auftragskonto' },
  { key: 'accountBic', name: 'bic auftragskonto' },
  { key: 'accountBankName', name: 'bankname auftragskonto' },
  { key: 'postedDate', name: 'buchungstag' },
  { key: 'valueDate', name: 'valutadatum' },
  { key: 'counterpartyName', name: 'name zahlungsbeteiligter' },
  { key: 'counterpartyIban', name: 'iban zahlungsbeteiligter' },
  { key: 'counterpartyBic', name: 'bic (swift-code) zahlungsbeteiligter' },
  { key: 'bookingText', name: 'buchungstext' },
  { key: 'description', name: 'verwendungszweck' },
  { key: 'amount', name: 'betrag' },
  { key: 'currency', name: 'waehrung' },
  { key: 'balanceAfter', name: 'saldo nach buchung' },
  { key: 'remark', name: 'bemerkung' },
  { key: 'flaggedTurnover', name: 'gekennzeichneter umsatz' },
  { key: 'creditorId', name: 'glaeubiger id' },
  { key: 'mandateRef', name: 'mandatsreferenz' },
];

/** The subset of UMSAETZE_COLUMNS names that must ALL be present to detect this format. */
const UMSAETZE_DETECT_NAMES = [
  'buchungstag',
  'valutadatum',
  'name zahlungsbeteiligter',
  'verwendungszweck',
  'betrag',
  'saldo nach buchung',
];

const COLUMNS_BY_FORMAT = {
  'sparkasse-kontobewegungen': REQUIRED_COLUMNS,
  'volksbank-umsaetze': UMSAETZE_COLUMNS,
};

/** Map each format's column keys to their column index in this file's header. */
const resolveColumnIndex = (header, sourceFormat) => {
  const normalized = normalizeHeader(header);
  const columns = COLUMNS_BY_FORMAT[sourceFormat] || [];
  const index = {};
  for (const { key, name } of columns) {
    index[key] = normalized.indexOf(name);
  }
  return index;
};

/** Index of the optional balance column, or -1 when the file doesn't carry one. */
const resolveBalanceColumnIndex = (header) => {
  const normalized = normalizeHeader(header);
  return normalized.findIndex((name) => BALANCE_COLUMN_NAMES.has(name));
};

const detectBankStatementFormat = (header) => {
  const normalized = normalizeHeader(header);
  const headerSet = new Set(normalized);
  const hasKontobewegungenColumns = REQUIRED_COLUMNS.every(({ name }) => headerSet.has(name));
  // These columns are the standard German kontobewegungen_export layout, shared
  // across banks — Volksbank files match it just as well as Sparkasse ones.
  // An extra column (e.g. a running balance) anywhere in the header does not
  // change this detection — only presence of the required names matters.
  //
  // The returned id is deliberately NOT renamed: buildBankRowIdentity folds it
  // into rowFingerprint and therefore into rowHash, the key that stops a
  // re-imported statement from duplicating rows. Changing this string would
  // make every already-stored movement look new. See the stability test in
  // bankStatementParser.test.js.
  if (hasKontobewegungenColumns) return 'sparkasse-kontobewegungen';

  const hasUmsaetzeColumns = UMSAETZE_DETECT_NAMES.every((name) => headerSet.has(name));
  if (hasUmsaetzeColumns) return 'volksbank-umsaetze';

  const hasClassicColumns = normalized.some((name) => (
    name.includes('soll/haben-kennzeichen')
    || name.includes('umsatz (ohne soll/haben-kz)')
    || name === 'gegenkonto'
  ));
  return hasClassicColumns ? 'datev-classic' : 'unknown';
};

const SEPA_TAG_FIELD = {
  EREF: 'endToEndRef',
  KREF: 'customerRef',
  MREF: 'mandateRef',
  CRED: 'creditorId',
  DEBT: 'debtorId',
  PURP: 'purposeCode',
  SVWZ: 'purpose',
  ABWA: 'alternativeCounterparty',
  ABWE: 'alternativeCounterparty',
  // "Umsätze"-only tags — not part of the SEPA standard, but the same
  // trailing "TAG: value" syntax this export tacks onto free text.
  ANAM: 'alternativeCounterparty',
  TAN: 'tan',
  IBAN: 'iban',
  BIC: 'bic',
};

// Two delimiter styles share one pattern: the old kontobewegungen export
// glues tags with "+" (no space, e.g. "SVWZ+58654564-1"); the Umsätze
// export uses "TAG: value" (colon, optional space) — including mid-word,
// e.g. "...aus JuliTAN: 131919". Neither uses a word boundary before the
// tag name, matching both real-world shapes.
// OAMT/COAM (original/compensation amount) and the Umsätze BNAM (bank name)
// carry no identity, but must still END the previous tag's value: otherwise
// "CRED+DE37GAA…OAMT+800.00" or "BIC: PBNKDEFFXXX BNAM: …" pollute the
// creditor id / BIC and make the same booking look different per export.
const SEPA_TAG_PATTERN = /(EREF|KREF|MREF|CRED|DEBT|PURP|SVWZ|ABWA|ABWE|ANAM|TAN|IBAN|BIC|OAMT|COAM|BNAM)(?:\+|:\s*)/g;

const emptySepaPurpose = () => ({
  endToEndRef: '',
  customerRef: '',
  mandateRef: '',
  creditorId: '',
  debtorId: '',
  purposeCode: '',
  purpose: '',
  alternativeCounterparty: '',
  tan: '',
  iban: '',
  bic: '',
});

/**
 * Parse a SEPA-structured Verwendungszweck/purpose blob into its tagged
 * fields. Recognizes both delimiter styles (`TAG+value` and `TAG: value`,
 * in any order) for EREF/KREF/MREF/CRED/DEBT/PURP/SVWZ/ABWA/ABWE, plus the
 * Umsätze-only ANAM (→ alternativeCounterparty) and the trailing
 * TAN/IBAN/BIC fragments (→ `tan`/`iban`/`bic`). A tag's value runs from
 * right after its delimiter to the start of the next recognized tag (or
 * the end of the string), trimmed. A field whose tag is absent comes back
 * as ''.
 *
 * `purpose`: when an SVWZ tag is present and non-empty, its value wins
 * (matches the old kontobewegungen format, which always structures the
 * whole blob under SVWZ+). Otherwise — the Umsätze export usually carries
 * no SVWZ tag at all — `purpose` is whatever free text precedes the FIRST
 * recognized tag (equivalently: the blob with every tag+value removed,
 * since each tag's value already extends to the next tag or end of
 * string). Plain text with no recognized tags at all is returned whole,
 * trimmed, as `purpose`.
 */
export const parseSepaPurpose = (raw) => {
  const text = String(raw || '');
  if (!text.trim()) return emptySepaPurpose();

  const matches = [...text.matchAll(SEPA_TAG_PATTERN)];
  if (matches.length === 0) {
    return { ...emptySepaPurpose(), purpose: text.trim() };
  }

  const result = emptySepaPurpose();
  matches.forEach((match, index) => {
    const tag = match[1];
    const valueStart = match.index + match[0].length;
    const valueEnd = index + 1 < matches.length ? matches[index + 1].index : text.length;
    const field = SEPA_TAG_FIELD[tag];
    if (field) result[field] = text.slice(valueStart, valueEnd).trim();
  });

  if (!result.purpose) {
    result.purpose = text.slice(0, matches[0].index).trim();
  }
  return result;
};

/**
 * bankEvidenceVersion: 1; bankEvidence: deduplicated, sorted flat assertions.
 * Required: sourceFormat + rowHash (provenance), postedDate, signedCents,
 * balanceState ('valid' | 'missing' | 'invalid'). Only 'valid' has balanceCents.
 * Optional strings below are bank observations, never display defaults. EUR
 * is observed in the Kontobewegungen amount header, not inferred from the app.
 * No full raw aliases, filenames, nested SEPA objects, or TAN values are copied.
 * Integer cents preserve zero. Unsupported/malformed envelopes have no authority;
 * reading legacy documents does not create metadata or trigger any backfill.
 */
const EVIDENCE_TEXT_FIELDS = [
  'sourceFormat', 'rowHash', 'postedDate', 'valueDate', 'currency', 'accountIban',
  'counterpartyName', 'counterpartyIban', 'counterpartyBic', 'purpose',
  'customerRef', 'endToEndRef', 'creditorId', 'mandateRef', 'debtorId', 'purposeCode',
];
const EVIDENCE_FIELDS = new Set([...EVIDENCE_TEXT_FIELDS, 'signedCents', 'balanceState', 'balanceCents']);
const evidenceDateValid = (date) => /^\d{4}-\d{2}-\d{2}$/.test(date || '')
  && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;

/** Reject an entire unsupported/malformed envelope; never salvage authority. */
export const readBankEvidence = (data) => {
  if (data?.bankEvidenceVersion !== 1 || !Array.isArray(data.bankEvidence) || !data.bankEvidence.length) return {};
  const records = [];
  for (const input of data.bankEvidence) {
    if (!input || typeof input !== 'object' || Array.isArray(input)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(input))
      || Object.keys(input).some((key) => !EVIDENCE_FIELDS.has(key))) return {};
    const record = {};
    for (const key of EVIDENCE_TEXT_FIELDS) {
      if (input[key] === undefined) continue;
      if (typeof input[key] !== 'string' || input[key].length > (key === 'purpose' ? 4096 : 256)) return {};
      let value = normalizeText(input[key]);
      if (key.endsWith('Iban') || key.endsWith('Bic') || key === 'currency') value = normalizeBankRowIbanBic(value);
      if (key === 'counterpartyName' || key === 'purpose') value = value.toLowerCase();
      if (value.length > (key === 'purpose' ? 4096 : 256)) return {};
      if (value) record[key] = value;
    }
    if (!['sparkasse-kontobewegungen', 'volksbank-umsaetze'].includes(record.sourceFormat)
      || !/^datev-[a-z0-9-]+$/i.test(record.rowHash || '')
      || !evidenceDateValid(record.postedDate)
      || (record.valueDate && !evidenceDateValid(record.valueDate))
      || !Number.isSafeInteger(input.signedCents)
      || !['valid', 'missing', 'invalid'].includes(input.balanceState)) return {};
    if (input.balanceState === 'valid' ? !Number.isSafeInteger(input.balanceCents) : input.balanceCents !== undefined) return {};
    record.signedCents = input.signedCents;
    record.balanceState = input.balanceState;
    if (input.balanceState === 'valid') record.balanceCents = input.balanceCents;
    records.push(JSON.stringify(record));
  }
  return { bankEvidenceVersion: 1, bankEvidence: [...new Set(records)].sort().map((record) => JSON.parse(record)) };
};

const observedBankEvidence = (row, cols, index, balanceCell) => {
  const text = {
    sourceFormat: row.sourceFormat, rowHash: row.rowHash, postedDate: row.postedDate,
    valueDate: parseGermanDate(cols[index.valueDate]),
    currency: row.sourceFormat === 'sparkasse-kontobewegungen' ? 'EUR' : cols[index.currency],
    accountIban: row.accountIban,
    counterpartyName: normalizeBankRowCounterparty(cols[index.counterpartyName]),
    counterpartyIban: row.counterpartyIban || row.sepa?.iban,
    counterpartyBic: row.counterpartyBic || row.sepa?.bic,
    purpose: normalizeBankRowDescription(row.sepa?.purpose),
  };
  for (const key of ['customerRef', 'endToEndRef', 'creditorId', 'mandateRef', 'debtorId', 'purposeCode']) text[key] = row.sepa?.[key];
  if (Object.values(text).some((value) => typeof value === 'string' && value.length > 4096)) return {};
  // Keep long display names on the movement, not in the bounded assertion.
  // Never truncate matching identifiers, references or purpose to fit the schema.
  if (text.counterpartyName.length > 256) delete text.counterpartyName;
  const validBalance = Number.isFinite(row.balanceAfter);
  const assertion = {
    ...Object.fromEntries(Object.entries(text).filter(([, value]) => typeof value === 'string' && value.trim())),
    signedCents: Math.round(row.signedAmount * 100),
    balanceState: validBalance ? 'valid' : String(balanceCell ?? '').trim() ? 'invalid' : 'missing',
    ...(validBalance ? { balanceCents: Math.round(row.balanceAfter * 100) } : {}),
  };
  return readBankEvidence({ bankEvidenceVersion: 1, bankEvidence: [assertion] });
};

const accumulatedBankEvidence = (aliases) => readBankEvidence({
  bankEvidenceVersion: 1,
  bankEvidence: aliases.flatMap((row) => authoritativeBankEvidence(row).bankEvidence || []),
});

const unsupportedFormatError = (format, header) => ({
  type: 'unsupported-format',
  format,
  lineNumber: 1,
  raw: header.join(';'),
  message: format === 'datev-classic'
    ? 'DATEV classic CSV is not supported for bank movement import yet.'
    : 'Unrecognized kontobewegungen CSV headers; no rows were imported.',
});

const bankCents = (value) => Number.isFinite(value) && Number.isSafeInteger(Math.round(value * 100))
  ? Math.round(value * 100) : null;
const balanceFollows = (before, after) => bankCents(before.balanceAfter) !== null
  && bankCents(after.balanceAfter) !== null && bankCents(after.signedAmount) !== null
  && bankCents(after.balanceAfter) - bankCents(before.balanceAfter) === bankCents(after.signedAmount);

/** Contiguous source records + corroborating balances, never date/sort alone. */
export const validateBankStatementSequence = (rows) => {
  const source = [...rows].sort((a, b) => a.lineNumber - b.lineNumber);
  const unavailable = { reason: 'unavailable-balance-sequence' };
  if (!source.length) return unavailable;
  if (source.some((row) => !evidenceDateValid(row.postedDate) || row.matchingIssue || row.balanceSourceIncomplete
    || bankCents(row.signedAmount) === null
    || (row.balanceAfter != null && bankCents(row.balanceAfter) === null)
    || row.bankEvidence?.some((record) => record.balanceState === 'invalid'))) return { reason: 'invalid-balance-sequence' };
  if (source.length > 1 && source.some((row, i) => !Number.isInteger(row.lineNumber)
    || (i > 0 && row.lineNumber !== source[i - 1].lineNumber + 1))) return unavailable;
  for (const field of ['accountIban', 'currency']) {
    const values = source.map((row) => normalizeBankRowIbanBic(observedBankFacts(row)[field]));
    const known = new Set(values.filter(Boolean));
    if (known.size > 1) return { reason: 'mixed-bank-context' };
    if (source.length > 1 && (known.size || field === 'currency') && values.some((value) => !value)) return { reason: 'incomplete-bank-context' };
  }
  if (source.filter((row) => bankCents(row.balanceAfter) !== null).length < Math.min(2, source.length)) return unavailable;
  const candidates = [];
  for (const order of ['ascending', 'descending']) {
    const ordered = order === 'ascending' ? source : [...source].reverse();
    let sum = 0, opening = null;
    const consistent = ordered.every((row, i) => {
      if (i && row.postedDate < ordered[i - 1].postedDate) return false;
      sum += bankCents(row.signedAmount);
      if (!Number.isSafeInteger(sum)) return false;
      const balance = bankCents(row.balanceAfter);
      if (balance === null) return true;
      if (opening === null) opening = balance - sum;
      return Number.isSafeInteger(opening) && balance - sum === opening;
    });
    if (consistent && bankCents(ordered.at(-1).balanceAfter) !== null) {
      let balance = opening;
      const verified = ordered.map((row) => {
        balance += bankCents(row.signedAmount);
        return bankCents(row.balanceAfter) === null ? { ...row, balanceAfter: balance / 100 } : row;
      });
      if (verified.every((row) => bankCents(row.balanceAfter) !== null)) candidates.push({ ordered: verified, order, openingCents: opening });
    }
  }
  if (!candidates.length) return { reason: 'inconsistent-or-incomplete-balance-sequence' };
  if (candidates.some((candidate) => candidate.openingCents !== candidates[0].openingCents)) return unavailable;
  return candidates[0];
};

/** Unique chronological chain for a day's distinct occurrences, or null. */
export const orderBankStatementDay = (rows) => {
  if (!rows.length || rows.some((row) => !Number.isFinite(row.balanceAfter) || !Number.isFinite(row.signedAmount))) return null;
  const starts = rows.filter((row) => !rows.some((other) => other !== row && balanceFollows(other, row)));
  if (starts.length !== 1) return null;
  const ordered = [starts[0]];
  const remaining = new Set(rows.filter((row) => row !== starts[0]));
  while (remaining.size) {
    const next = [...remaining].filter((row) => balanceFollows(ordered.at(-1), row));
    if (next.length !== 1) return null;
    ordered.push(next[0]);
    remaining.delete(next[0]);
  }
  return ordered;
};

// Infer only within a source file. A format's usual direction is not evidence
// when an incomplete or contradictory single-day sequence could run either way.
const statementOrder = (rows) => validateBankStatementSequence(rows).order || null;

/**
 * Select each file's latest booking per month before comparing files. Never
 * infer a file's order from another file or renumber its source lines. Conflicting
 * same-date closings and unknown order are not authoritative anchors.
 * Dates remain observed booking dates: a later export cannot certify month end.
 */
export const analyzeBankStatementBalances = (rows) => {
  if (!Array.isArray(rows) || rows.length === 0) return { balances: [] };
  const balanceIssues = [];
  for (const field of ['accountIban', 'currency']) {
    if (new Set(rows.map((row) => normalizeBankRowIbanBic(row[field])).filter(Boolean)).size > 1) return { balances: [], balanceIssues: [{ reason: 'mixed-bank-context' }] };
  }
  const groups = new Map();
  for (const row of rows) {
    if (!row?.postedDate) continue;
    const key = row.sourceFileIndex ?? 0;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const candidates = new Map();
  for (const group of groups.values()) {
    group.sort((a, b) => a.lineNumber - b.lineNumber);
    const sequence = validateBankStatementSequence(group);
    const order = sequence.order;
    if (sequence.reason) balanceIssues.push({ reason: sequence.reason, file: group[0].sourceFileName || '', line: group[0].lineNumber || 0 });
    const months = new Map();
    for (const row of sequence.ordered || group) {
      const month = row.postedDate.slice(0, 7);
      if (!months.has(month)) months.set(month, []);
      months.get(month).push(row);
    }
    for (const [month, inMonth] of months) {
      const latestDate = inMonth.map((row) => row.postedDate).sort().at(-1);
      const latest = inMonth.filter((row) => row.postedDate === latestDate);
      const closing = latest.at(-1);
      const unambiguous = !!order;
      if (!candidates.has(month)) candidates.set(month, []);
      candidates.get(month).push({ postedDate: latestDate, balanceAfter: unambiguous ? closing.balanceAfter : null });
    }
  }
  const balances = [...candidates.entries()].sort(([a], [b]) => a.localeCompare(b)).flatMap(([month, entries]) => {
    const date = entries.map((entry) => entry.postedDate).sort().at(-1);
    const latest = entries.filter((entry) => entry.postedDate === date);
    const balance = latest[0].balanceAfter;
    if (!Number.isFinite(balance) || latest.some((entry) => bankCents(entry.balanceAfter) !== bankCents(balance))) {
      balanceIssues.push({ reason: 'conflicting-or-unavailable-closing', month });
      return [];
    }
    return [{ date, balance: bankCents(balance) / 100 }];
  });
  return { balances, ...(balanceIssues.length ? { balanceIssues } : {}) };
};
export const deriveMonthEndBalances = (rows) => analyzeBankStatementBalances(rows).balances;

/**
 * Merge several already-parsed files (each from its own `parseBankStatementCSV`
 * call — one format per file, no mixed-format parsing needed) into one
 * chronologically-ordered row set, then derive one balance per calendar
 * month from that UNION via a single `deriveMonthEndBalances` call.
 *
 * Each file must independently support its arithmetic chain. Closing dates
 * remain observed dates: later files do not prove intervening month-end coverage.
 * Source identity and line numbers survive the merge. Output is newest-first;
 * balance derivation compares independently validated file evidence.
 *
 * @param {Array<{name?: string, rows: object[], period: {minDate:string,maxDate:string,count:number}|null}>} files
 * @returns {{ rows: object[], balances: Array<{date: string, balance: number}> }}
 */
export const mergeParsedFiles = (files, unresolvedRows = []) => {
  const withRows = (files || []).filter((file) => (file?.rows?.length || 0) > 0);
  const rows = withRows.flatMap((file, sourceFileIndex) => {
    const order = statementOrder(file.rows);
    return file.rows.map((row) => ({ ...row, sourceFileIndex, sourceFileName: file.name || '', statementOrder: order }));
  });
  rows.sort((a, b) => b.postedDate.localeCompare(a.postedDate)
    || a.sourceFileIndex - b.sourceFileIndex
    || (a.statementOrder === 'ascending' ? b.lineNumber - a.lineNumber : a.lineNumber - b.lineNumber));
  // Account-level anchors must not certify an incompletely reconciled batch.
  const incomplete = unresolvedRows.length || rows.some((row) => row.matchingIssue);
  const analysis = analyzeBankStatementBalances(rows);
  return { rows, ...analysis, balances: incomplete ? [] : analysis.balances };
};

/**
 * Build one kontobewegungen_export row. Returns null when the row is
 * unparsable (caller pushes it to `errors`).
 */
const buildKontobewegungenRow = (cols, columnIndex, balanceColumnIndex, lineNumber, sourceFormat) => {
  const postedDate = parseGermanDate(cols[columnIndex.postedDate]);
  const amountSigned = parseObservedAmount(cols[columnIndex.amount]);
  if (!postedDate || amountSigned === null || amountSigned === 0) return null;

  const direction = amountSigned >= 0 ? 'in' : 'out';
  const rawDescription = (cols[columnIndex.description] || '').trim();
  const sepa = parseSepaPurpose(rawDescription);
  const description = sepa.purpose || rawDescription;
  const balanceCell = balanceColumnIndex >= 0 ? cols[balanceColumnIndex] : null;
  const balanceAfter = parseOptionalBalance(balanceCell);

  // raw.columns feeds buildBankRowIdentity \u2192 rowHash. It is reconstructed
  // in the canonical REQUIRED_COLUMNS order (NOT a positional slice of
  // `cols`) so a balance column added anywhere in the file \u2014 or absent
  // entirely \u2014 never changes the hash of an otherwise-identical movement.
  return {
    sourceFormat,
    lineNumber,
    currency: 'EUR', // Observed in the required Betrag in EUR header.
    automat: parseGermanBool(cols[columnIndex.automat]),
    sammler: parseGermanBool(cols[columnIndex.sammler]),
    postedDate,
    valueDate: parseGermanDate(cols[columnIndex.valueDate]) || postedDate,
    counterpartyName: (cols[columnIndex.counterpartyName] || '').trim(),
    counterpartyIban: normalizeBankRowIbanBic(cols[columnIndex.counterpartyIban]),
    counterpartyBic: normalizeBankRowIbanBic(cols[columnIndex.counterpartyBic]),
    description,
    rawDescription,
    sepa,
    balanceAfter,
    amountSigned,
    signedAmount: amountSigned,
    direction,
    amount: Math.abs(amountSigned),
    notes: (cols[columnIndex.notes] || '').trim(),
    receiptCount: parseInt(cols[columnIndex.receiptCount] || '0', 10) || 0,
    verified: parseGermanBool(cols[columnIndex.verified]),
    raw: {
      columns: REQUIRED_COLUMNS.map(({ key }) => cols[columnIndex[key]]),
      line: lineNumber,
    },
  };
};

/**
 * Build one "Ums\u00E4tze" row. Returns null when the row is unparsable.
 * counterpartyName falls back to the account's own bank name (Bankname
 * Auftragskonto) for fee/closing rows, which carry an empty Name
 * Zahlungsbeteiligter \u2014 a movement is never nameless.
 */
const buildUmsaetzeRow = (cols, columnIndex, lineNumber, sourceFormat) => {
  const postedDate = parseGermanDate(cols[columnIndex.postedDate]);
  const amountSigned = parseObservedAmount(cols[columnIndex.amount]);
  if (!postedDate || amountSigned === null || amountSigned === 0) return null;

  const direction = amountSigned >= 0 ? 'in' : 'out';
  const rawDescription = (cols[columnIndex.description] || '').trim();
  const sepaParsed = parseSepaPurpose(rawDescription);
  const description = sepaParsed.purpose || rawDescription;
  // The purpose text usually already carries CRED+/MREF (or their colon
  // form); when it doesn't, the file's own Glaeubiger ID / Mandatsreferenz
  // columns are the fallback source for the same information.
  const sepa = {
    ...sepaParsed,
    creditorId: sepaParsed.creditorId || (cols[columnIndex.creditorId] || '').trim(),
    mandateRef: sepaParsed.mandateRef || (cols[columnIndex.mandateRef] || '').trim(),
  };
  const bankName = (cols[columnIndex.accountBankName] || '').trim();
  const counterpartyName = (cols[columnIndex.counterpartyName] || '').trim() || bankName;
  const balanceCell = cols[columnIndex.balanceAfter];
  const balanceAfter = parseOptionalBalance(balanceCell);

  // Unlike kontobewegungen, raw.columns here is ALL 18 file columns in file
  // order, INCLUDING Saldo nach Buchung: see the module header comment for
  // why this format keeps the balance IN the identity.
  return {
    sourceFormat,
    lineNumber,
    postedDate,
    valueDate: parseGermanDate(cols[columnIndex.valueDate]) || postedDate,
    counterpartyName,
    counterpartyIban: normalizeBankRowIbanBic(cols[columnIndex.counterpartyIban]),
    counterpartyBic: normalizeBankRowIbanBic(cols[columnIndex.counterpartyBic]),
    description,
    rawDescription,
    sepa,
    bookingText: (cols[columnIndex.bookingText] || '').trim(),
    accountIban: normalizeBankRowIbanBic(cols[columnIndex.accountIban]),
    currency: (cols[columnIndex.currency] || '').trim(),
    balanceAfter,
    amountSigned,
    signedAmount: amountSigned,
    direction,
    amount: Math.abs(amountSigned),
    raw: {
      columns: [...cols],
      line: lineNumber,
    },
  };
};

/**
 * Parse a bank statement CSV file content \u2014 kontobewegungen_export or
 * Ums\u00E4tze, auto-detected (see the module header comment for both layouts).
 * Returns { rows, errors, header, period, balances }.
 *   rows:      array of normalized movement objects
 *   errors:    invalid rows or balances (movements with invalid balances are retained)
 *   header:    raw header line as array of column names
 *   period:    { minDate, maxDate, count }
 *   balances:  deriveMonthEndBalances(rows) \u2014 [] when the file has no balance column
 */
export const parseBankStatementCSV = (text) => {
  if (!text) return { rows: [], errors: [], header: [], period: null, balances: [] };

  // Strip BOM if present
  const cleaned = text.replace(/^\uFEFF/, '');
  const allRows = parseCSVText(cleaned, ';');
  if (allRows.length === 0) return { rows: [], errors: [], header: [], period: null, balances: [] };

  const header = allRows[0];
  const sourceFormat = detectBankStatementFormat(header);
  if (sourceFormat !== 'sparkasse-kontobewegungen' && sourceFormat !== 'volksbank-umsaetze') {
    return {
      rows: [],
      errors: [unsupportedFormatError(sourceFormat, header)],
      header,
      period: null,
      balances: [],
    };
  }

  const columnIndex = resolveColumnIndex(header, sourceFormat);
  const balanceColumnIndex = sourceFormat === 'sparkasse-kontobewegungen'
    ? resolveBalanceColumnIndex(header)
    : -1;
  const requiredIndices = Object.values(columnIndex);
  const maxRequiredIndex = Math.max(...requiredIndices, balanceColumnIndex);

  const rows = [];
  const errors = [];

  let minDate = '9999-99-99';
  let maxDate = '0000-00-00';

  for (let i = 1; i < allRows.length; i++) {
    const cols = allRows[i];
    if (cols.length <= maxRequiredIndex) {
      errors.push({ lineNumber: i + 1, raw: cols.join(';') });
      continue;
    }

    const row = sourceFormat === 'volksbank-umsaetze'
      ? buildUmsaetzeRow(cols, columnIndex, i + 1, sourceFormat)
      : buildKontobewegungenRow(cols, columnIndex, balanceColumnIndex, i + 1, sourceFormat);

    if (!row) {
      errors.push({ lineNumber: i + 1, raw: cols.join(';') });
      continue;
    }

    const balanceCell = cols[sourceFormat === 'volksbank-umsaetze' ? columnIndex.balanceAfter : balanceColumnIndex];
    if (String(balanceCell ?? '').trim() && row.balanceAfter === null) {
      errors.push({ type: 'invalid-balance', lineNumber: i + 1, raw: cols.join(';'), message: 'Invalid running balance; movement retained without an anchor.' });
    }
    Object.assign(row, buildBankRowIdentity(row));
    const evidence = observedBankEvidence(row, cols, columnIndex, balanceCell);
    if (!evidence.bankEvidence) {
      errors.push({ type: 'invalid-bank-evidence', lineNumber: i + 1, message: 'Bank evidence exceeds supported bounds or is invalid; row not imported.' });
      continue;
    }
    Object.assign(row, evidence);
    rows.push(row);
    if (row.postedDate < minDate) minDate = row.postedDate;
    if (row.postedDate > maxDate) maxDate = row.postedDate;
  }

  if (errors.some((error) => error.type !== 'invalid-balance')) rows.forEach((row) => { row.balanceSourceIncomplete = true; });
  const period = rows.length > 0 ? { minDate, maxDate, count: rows.length } : null;
  return { rows, errors, header, period, ...analyzeBankStatementBalances(rows) };
};

/**
 * Normalize a counterparty name for the legacy movement fingerprint:
 * lowercase, collapse every run of non-letter/non-digit characters
 * (spaces, `&`, `+`, `.`, `,`, `/`, `-`, …) to one space, trim. Keeps
 * umlauts (Unicode letters). This is what makes "Schomerus & Partner mbB"
 * and "Schomerus + Partner mbB" (an old-format export literally wrote "&"
 * as "+") — and "E&F Elektrotechnik GmbH" / "E+F Elektrotechnik GmbH" —
 * fingerprint identically.
 */
const normalizeFingerprintCounterparty = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/**
 * Build a deterministic fingerprint for an existing bankMovement so we
 * can detect duplicates across import sessions.
 *
 * Used by the importer to skip rows that already exist with the same
 * postedDate + amount + direction + counterparty (case-insensitive,
 * punctuation-insensitive).
 */
export const movementFingerprint = (m) => {
  const date = (m.postedDate || '').trim().slice(0, 10);
  const amount = Math.abs(Number(m.amount) || 0).toFixed(2);
  const direction = m.direction || (Number(m.amount) >= 0 ? 'in' : 'out');
  const cp = normalizeFingerprintCounterparty(m.counterpartyName);
  return `${date}|${amount}|${direction}|${cp}`;
};

/**
 * Build the same fingerprint for a parsed bank statement row.
 */
export const bankRowFingerprint = (row) => {
  const date = (row.postedDate || '').trim();
  const amount = Math.abs(Number(row.amount) || 0).toFixed(2);
  const direction = row.direction || 'in';
  const cp = normalizeFingerprintCounterparty(row.counterpartyName);
  return `${date}|${amount}|${direction}|${cp}`;
};

export const movementIdentityKey = (movement) => movement?.rowHash || movementFingerprint(movement);

const dedupTripleKey = (date, amount, direction) =>
  `${String(date || '').slice(0, 10)}|${Math.abs(Number(amount) || 0).toFixed(2)}|${direction || (Number(amount) >= 0 ? 'in' : 'out')}`;

/**
 * Whether two counterparty names should be treated as the same real-world
 * party for legacy-ledger matching. Cross-format batch matching additionally
 * requires a shared purpose and compatible IBAN/balance evidence. This never
 * changes the frozen rowHash/rowFingerprint identity.
 * Beyond an exact match after the same punctuation-insensitive
 * normalization `movementFingerprint` uses:
 *   - a blank name requires the same nonempty booking purpose. The old kontobewegungen
 *     parser left fee/closing rows (Buchungstext "Entgelt/Auslagen" /
 *     "Abschluss") with an empty counterparty; this parser fills the same
 *     kind of row with the account's own bank name (buildUmsaetzeRow), so a
 *     blank vs. a bank name alone is not identity evidence; the purpose must
 *     corroborate it, even when both names are blank.
 *   - a long shared prefix also matches. The old export truncates long
 *     counterparty names (observed in production: cut mid-word around 55
 *     characters, e.g. "Schomerus & Partner mbB Steuerberater Rechtsanwälte
 *     Wi" vs the untruncated "Schomerus + Partner mbB Steuerberater
 *     Rechtsanwälte Wirtschaftsprüfer"). Requiring at least 15 matching
 *     characters keeps this from ever matching two genuinely different
 *     (short) names that merely start alike.
 */
// Only presentation at a recognized invoice label is interchangeable. Do not
// strip booking words in the middle, or numbers/dates between a label and invoice.
const normalizeBookingPurpose = (value) => normalizeBankRowDescription(value)
  .replace(/^(?:überweisungsauftrag|sepa[- ]überweisung|überweisung|transfer)(?:\s*:\s*|\s+)(?=(?:invoice|rechnung)\b)/, '')
  .replace(/^(invoice|rechnung)\s*:\s*/, '$1 ');
const observedSepaFields = (row) => [row.sepa || {}, row,
  ...[...new Set([row.rawDescription, row.description].filter(Boolean))].map((text) => parseSepaPurpose(text)),
];
const knownBankValues = (values, normalize) => [...new Set(values.map(normalize).filter(Boolean))].sort();
const purposeValues = (sources) => knownBankValues(sources.map((source) => source.purpose), normalizeBookingPurpose);
// Bare booking labels are not invoice identities. Dates/numbers/extra text remain
// meaningful; do not discard a purpose merely because it contains a bank word.
const GENERIC_BANK_PURPOSES = new Set([
  'payment', 'transfer', 'überweisung', 'überweisungsauftrag', 'sepa überweisung',
  'lastschrift', 'sepa basislastschrift', 'entgelt/auslagen', 'abschluss', 'account fee',
]);
// Slash-coded remittance ("/MISTRAL-SO//…//USTRD//Kartenzahlung") is a card
// network code in the kontobewegungen export, not the merchant text Umsätze
// shows for the same payment — it identifies nothing across formats.
const SLASH_CODED_PURPOSE = /^\/[a-z0-9-]+\/\//;
const meaningfulPurpose = (purpose) => (GENERIC_BANK_PURPOSES.has(purpose.replace(/[- ]+/g, ' '))
  || SLASH_CODED_PURPOSE.test(purpose) ? '' : purpose);
// The same SEPA purpose arrives with different spacing per export: Umsätze
// joins its lines with a space ("Gehalt April SecureGo plus"), kontobewegungen
// concatenates the SVWZ fields ("Gehalt AprilSecureGo plus"). Compare purposes
// without whitespace, or every re-import across formats looks like a new booking.
const comparablePurpose = (purpose) => purpose.replace(/\s+/g, '');
const bankReference = (value) => {
  const reference = normalizeText(value);
  return /^(NOTPROVIDED|NONREF)$/i.test(reference) ? '' : reference;
};

const counterpartiesMatchForDedup = (a, b) => {
  const na = a.name, nb = b.name;
  if (!na || !nb) return !!a.purpose && a.purpose === b.purpose;
  if (na === nb) return true;
  const [shorter, longer] = na.length <= nb.length ? [na, nb] : [nb, na];
  return shorter.length >= 15 && longer.startsWith(shorter);
};

// Known contradictory evidence always vetoes a match, including frozen hashes:
// Kontobewegungen hashes deliberately do not include running balances.
const bookingFacts = (row) => {
  const sources = observedSepaFields(row);
  const sepa = row.sepa || sources[2] || {}; // Same identity precedence; reuse the first parsed text.
  const purposes = purposeValues(sources);
  const identity = [
    normalizeBankRowIbanBic(row.counterpartyIban || sepa.iban),
    // First token only: movements stored before BNAM was a delimiter carry
    // "PBNKDEFFXXX BNAM: <bank name>" in the BIC.
    normalizeBankRowIbanBic(String(row.counterpartyBic || sepa.bic || '').trim().split(/\s+/)[0]).replace(/XXX$/, ''),
    normalizeBankRowIbanBic(row.accountIban || row.sourceAccountIban),
    normalizeBankRowIbanBic(row.currency),
  ];
  // Resolve each reference independently. Keep all known observations so sparse
  // objects/placeholders cannot hide tagged facts, nor can one source win a conflict.
  const purpose = purposes.find(meaningfulPurpose) || purposes[0] || '';
  return { balance: row.balanceAfter, purpose: comparablePurpose(purpose), evidence: [
    ...identity.map((value) => value ? [value] : []),
    ...['creditorId', 'mandateRef', 'endToEndRef', 'customerRef'].map((key) =>
      knownBankValues(sources.map((source) => source[key]), bankReference)),
    [...new Set(purposes.filter(meaningfulPurpose).map(comparablePurpose))],
  ] };
};
// Structured source facts outrank evidence; raw columns and unshipped provenance
// hints cannot rewrite them. Adapter .raw excludes display-only defaults.
const observedBankFacts = (row) => row.source && row.raw ? row.raw : row;
const assertionRows = (records) => records.map((record) => ({
  ...record,
  balanceAfter: record.balanceState === 'valid' ? record.balanceCents / 100 : null,
}));
const bankFactsConflict = (a, b) => {
  if (Number.isFinite(a.balance) && Number.isFinite(b.balance) && a.balance !== b.balance) return true;
  return a.evidence.some((values, i) => values.length > 1 || b.evidence[i].length > 1
    || (values.length && b.evidence[i].length && values[0] !== b.evidence[i][0]));
};

/** Shape validation alone cannot grant assertions authority over a booking. */
const bankEvidenceAuthority = (row, factsFor = bookingFacts) => {
  const actual = observedBankFacts(row);
  const evidence = readBankEvidence(actual);
  const fallback = { evidence: {}, facts: [factsFor(actual)] };
  if (!evidence.bankEvidence) return fallback;
  const signed = actual.signedAmount ?? (Number.isFinite(actual.amount) && ['in', 'out'].includes(actual.direction)
    ? Math.abs(actual.amount) * (actual.direction === 'out' ? -1 : 1) : NaN);
  if (!Number.isFinite(signed) || !evidenceDateValid(actual.postedDate)) return fallback;
  if (evidence.bankEvidence.some((record) => record.postedDate !== actual.postedDate || record.signedCents !== Math.round(signed * 100))) return fallback;
  const facts = [...fallback.facts, ...assertionRows(evidence.bankEvidence).map(factsFor)];
  if (facts.some((a, i) => facts.slice(i + 1).some((b) => bankFactsConflict(a, b)))) return fallback;
  return { evidence, facts };
};
export const authoritativeBankEvidence = (row) => bankEvidenceAuthority(row).evidence;

// Caches belong to one synchronous operation only. Alias arrays may grow, but
// decision fields stay unchanged during union. Resolution flags are read afresh
// each pass, and later operations start with fresh caches.
const createBookingPreparation = (stats = {}) => {
  Object.assign(stats, { normalizedFacts: 0, candidateComparisons: 0, workUnits: 0, searchWork: 0 });
  const memo = (build) => {
    const cache = new Map();
    return (row) => {
      if (!cache.has(row)) cache.set(row, build(row));
      return cache.get(row);
    };
  };
  const factsFor = memo((row) => {
    stats.normalizedFacts += 1;
    const facts = bookingFacts(row);
    return { ...facts, key: JSON.stringify([Number.isFinite(facts.balance) ? facts.balance : null, facts.evidence]) };
  });
  return memo((row) => {
    const own = factsFor(row);
    const facts = bankEvidenceAuthority(row, factsFor).facts;
    const prepared = { hash: row.rowHash, triple: dedupTripleKey(row.postedDate, row.amount, row.direction),
      name: normalizeFingerprintCounterparty(row.counterpartyName), purpose: own.purpose,
      bankFingerprint: bankRowFingerprint(row), movementFingerprint: movementFingerprint(row), facts,
      weight: (Number.isFinite(row.balanceAfter) ? 10 : 0) + own.evidence.filter((values) => values.length).length };
    prepared.key = JSON.stringify([row.rowHash, prepared.bankFingerprint, row.balanceAfter, own.evidence]);
    prepared.signature = JSON.stringify([prepared.triple, prepared.name, prepared.purpose, prepared.bankFingerprint,
      prepared.movementFingerprint, !!prepared.hash, [...new Set(facts.map((fact) => fact.key))].sort()]);
    return prepared;
  });
};
const prepareOccurrence = (aliases, prepare) => {
  const all = aliases.map(prepare);
  const rows = [...new Map(all.map((row) => [row.signature, row])).values()];
  return { rows, hashes: new Set(all.map((row) => row.hash).filter(Boolean)), triples: new Set(rows.map((row) => row.triple)),
    facts: [...new Map(rows.flatMap((row) => row.facts).map((fact) => [fact.key, fact])).values()],
    weight: all.reduce((weight, row) => Math.max(weight, row.weight), -Infinity),
    signature: JSON.stringify(rows.map((row) => row.signature).sort()) };
};
const occurrenceRank = (a, b, crossFile, charge = () => {}, detectAmbiguity = false) => {
  if (a.facts.some((left) => b.facts.some((right) => {
    charge('evidence');
    return bankFactsConflict(left, right);
  }))) return 0;
  if ([...a.hashes].some((hash) => b.hashes.has(hash))) return 3;
  let best = 0;
  for (const left of a.rows) for (const right of b.rows) {
    charge('alias');
    // Unknown names may make multiplicity uncertain, but never authorize aliases.
    const unknownParty = detectAmbiguity && (!left.name || !right.name);
    if (left.triple !== right.triple || (!unknownParty && !counterpartiesMatchForDedup(left, right))) continue;
    if (crossFile && (left.hash || right.hash) && (!left.purpose || left.purpose !== right.purpose)) continue;
    best = Math.max(best, left.bankFingerprint === right.movementFingerprint ? 2 : 1);
  }
  return best;
};
export const representativeBankOccurrence = (aliases) => {
  const prepare = createBookingPreparation();
  return [...aliases].sort((a, b) => prepare(b).weight - prepare(a).weight || prepare(a).key.localeCompare(prepare(b).key))[0];
};

/** Shared match priority for importer and report; zero means no match. */
export const bankMovementMatchRank = (row, movement) => {
  const prepare = createBookingPreparation();
  return occurrenceRank(prepareOccurrence([row], prepare), prepareOccurrence([movement], prepare), false);
};

/**
 * An occurrence is an array of export aliases, not a fingerprint. Match two
 * occurrence sets one-to-one, reserving stronger evidence first. Equal-rank
 * assignments can be rerouted so an early broad match cannot strand a booking.
 */
const occurrenceIndex = (groups, indices, field) => {
  const index = new Map();
  for (const i of indices) for (const key of groups[i][field]) {
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(i);
  }
  return index;
};
const matchPreparedComponent = (left, right, crossFile, stats, charge) => {
  const order = left.map((_, i) => i).sort((a, b) => left[b].weight - left[a].weight);
  const rightOrder = right.map((_, i) => i);
  const indexes = { hashes: occurrenceIndex(right, rightOrder, 'hashes'), triples: occurrenceIndex(right, rightOrder, 'triples') };
  const ranks = left.map(() => new Map());
  const rankFor = (i, j, linear = false) => {
    if (!ranks[i].has(j)) {
      stats.candidateComparisons += 1;
      ranks[i].set(j, occurrenceRank(left[i], right[j], crossFile, (phase) => charge(phase, linear)));
    }
    return ranks[i].get(j);
  };
  const matches = new Map(), owners = new Map();
  for (const rank of [3, 2, 1]) {
    // Hashes are a separate first pass: exact priority can bypass date/amount.
    // Lower ranks require the triple, never a guessed account/currency/IBAN.
    const field = rank === 3 ? 'hashes' : 'triples';
    const pending = order.filter((i) => !matches.has(i));
    const components = occurrenceIndex(left, pending, field);
    const edges = new Map();
    for (const [key, indices] of components) {
      const available = (indexes[field].get(key) || []).filter((j) => !owners.has(j));
      if (!available.length || indices.some((i) => left[i][field].size !== 1)
        || available.some((j) => right[j][field].size !== 1)) continue;
      if (indices.some((i) => left[i].signature !== left[indices[0]].signature)
        || available.some((j) => right[j].signature !== right[available[0]].signature)) continue;
      // Isolated, complete equivalent components need capacity, not a dense graph.
      // Recursive first-slot rerouting reverses the first min(L,R) right slots.
      // At lower ranks no free exact edge survives the preceding maximal pass.
      for (const i of indices) edges.set(i, []);
      if (rankFor(indices[0], available[0], true) !== rank) continue;
      const count = Math.min(indices.length, available.length);
      for (let k = 0; k < count; k += 1) {
        const i = indices[k], j = available[count - 1 - k];
        matches.set(i, j);
        owners.set(j, { i, rank });
      }
      stats.tentativeMatches = matches.size;
    }
    const candidates = (i) => {
      if (!edges.has(i)) {
        const found = new Set();
        for (const key of left[i][field]) for (const j of indexes[field].get(key) || []) {
          charge('candidate'); // Before allocating a candidate, including repeated keys.
          found.add(j);
        }
        edges.set(i, [...found].sort((a, b) => a - b).filter((j) =>
          (!owners.has(j) || owners.get(j).rank === rank) && rankFor(i, j) === rank));
      }
      return edges.get(i);
    };
    const assign = (root) => {
      const visited = new Set();
      const stack = [{ i: root, next: 0 }];
      while (stack.length) {
        charge('assignment');
        const frame = stack[stack.length - 1], choices = candidates(frame.i);
        if (frame.next === choices.length) { stack.pop(); continue; }
        const j = choices[frame.next++];
        if (visited.has(j)) continue;
        visited.add(j);
        const owner = owners.get(j);
        if (owner) {
          if (owner.rank === rank) stack.push({ i: owner.i, next: 0, via: j });
          continue;
        }
        matches.set(frame.i, j);
        owners.set(j, { i: frame.i, rank });
        while (stack.length > 1) {
          charge('assignment');
          const child = stack.pop(), parent = stack[stack.length - 1];
          matches.set(parent.i, child.via);
          owners.set(child.via, { i: parent.i, rank });
        }
        stats.tentativeMatches = matches.size;
        return;
      }
    };
    for (const i of pending) if (!matches.has(i) && candidates(i).length) assign(i);
  }
  // Retain the original Map insertion order despite batching isolated components.
  return [3, 2, 1].flatMap((rank) => order.filter((i) => matches.has(i)
    && owners.get(matches.get(i)).rank === rank).map((i) => [i, matches.get(i), rank]));
};

// Deterministic units: candidate enumeration, fact/alias comparison and DFS steps.
// 25k caps a component before dense 120x120 search/rewiring can expand unchecked.
// 250k caps non-linear search across a union operation; proven linear capacity
// components can still resolve afterwards. These are not user-overridable limits.
export const BANK_MATCH_WORK_LIMITS = Object.freeze({ component: 25000, search: 250000 });
const MATCH_WORK_EXCEEDED = Symbol('matching-work-budget-exceeded');
// Partition the union of both discovery indexes, including cross-date hashes.
// These are potential components: exhaustion can also withhold vetoed pairs.
const matchingComponents = (groups, leftCount) => {
  const parents = groups.map((_, i) => i), sizes = groups.map(() => 1);
  const root = (i) => {
    while (parents[i] !== i) { parents[i] = parents[parents[i]]; i = parents[i]; }
    return i;
  };
  for (const field of ['hashes', 'triples']) {
    const first = new Map();
    groups.forEach((group, i) => {
      for (const key of group[field]) {
        if (!first.has(key)) first.set(key, i);
        let a = root(i), b = root(first.get(key));
        if (a === b) continue;
        if (sizes[a] < sizes[b]) [a, b] = [b, a];
        parents[b] = a;
        sizes[a] += sizes[b];
      }
    });
  }
  const components = new Map();
  groups.forEach((_, i) => {
    const key = root(i);
    if (!components.has(key)) components.set(key, { left: [], right: [] });
    components.get(key)[i < leftCount ? 'left' : 'right'].push(i < leftCount ? i : i - leftCount);
  });
  return components.values();
};
const matchPreparedOccurrences = (leftRows, rightRows, crossFile, prepare, stats) => {
  const left = leftRows.map((rows) => prepareOccurrence(rows, prepare));
  const right = rightRows.map((rows) => prepareOccurrence(rows, prepare));
  const resolved = [], unresolved = [];
  for (const part of matchingComponents([...left, ...right], left.length)) {
    const source = part.left.flatMap((i) => leftRows[i]);
    const other = part.right.flatMap((j) => rightRows[j]);
    const inherited = [...source, ...other].find((row) => row.matchingIssue)?.matchingIssue;
    let work = 0, phase = inherited?.phase || 'inherited';
    stats.tentativeMatches = 0;
    const charge = (step, linear) => {
      phase = step;
      if (work >= BANK_MATCH_WORK_LIMITS.component || (!linear && stats.searchWork >= BANK_MATCH_WORK_LIMITS.search)) throw MATCH_WORK_EXCEEDED;
      work += 1;
      stats.workUnits += 1;
      if (!linear) stats.searchWork += 1;
    };
    try {
      if (inherited) throw MATCH_WORK_EXCEEDED;
      const decisions = matchPreparedComponent(part.left.map((i) => left[i]), part.right.map((j) => right[j]), crossFile, stats, charge);
      for (const [i, j, rank] of decisions) resolved.push([part.left[i], part.right[j], rank]);
    } catch (error) {
      if (error !== MATCH_WORK_EXCEEDED) throw error;
      // The component's local owners, rank cache and tentative assignments are
      // discarded together. No partial match can become an insertion or orphan.
      const input = crossFile ? [...source, ...other] : source;
      unresolved.push({ ...part, reason: inherited?.reason || 'matching-work-budget-exceeded', phase,
        work: work || inherited?.work || 0, discardedMatches: inherited?.discardedMatches || stats.tentativeMatches,
        sourceRows: input.length, ledgerRows: crossFile ? 0 : other.length,
        sources: input.map((row) => ({ file: row.sourceFileName || row.importFile?.name || '',
          line: row.importLineNumber || row.lineNumber || 0, rowHash: row.rowHash || '' })) });
    }
  }
  resolved.sort((a, b) => b[2] - a[2] || left[b[0]].weight - left[a[0]].weight || a[0] - b[0]);
  const result = new Map(resolved.map(([i, j]) => [i, j]));
  if (unresolved.length) result.unresolved = unresolved;
  return result;
};
// Consumers must quarantine both sides of any result.unresolved component.
export const matchBookingOccurrences = (left, right, crossFile = false, stats = {}) =>
  matchPreparedOccurrences(left, right, crossFile, createBookingPreparation(stats), stats);

/**
 * Union exports by occurrences. Richer files establish slots before partial
 * representations are attached. Every alias must agree with accumulated known
 * evidence; a balance-less alias cannot bridge two contradictory balances.
 * Source lines are candidate occurrences only; multiplicity needs corroboration.
 */
export const collectBankStatementOccurrences = (files) => {
  const stats = {}, prepare = createBookingPreparation(stats);
  const sources = (files || []).map((file, sourceFileIndex) => {
    const rows = (file.rows || []).map((row, sourceRowIndex) => ({ ...row, sourceFileIndex, sourceRowIndex, sourceFileName: file.name || '' }));
    return { rows, weight: rows.reduce((sum, row) => sum + prepare(row).weight, 0), key: rows.map((row) => prepare(row).key).sort().join('|') };
  }).sort((a, b) => b.weight - a.weight || b.rows.length - a.rows.length || a.key.localeCompare(b.key));
  const occurrences = [];
  for (const { rows } of sources) {
    const matches = matchPreparedOccurrences(rows.map((row) => [row]), occurrences, true, prepare, stats);
    for (const issue of matches.unresolved || []) {
      for (const i of issue.left) rows[i].matchingIssue = issue;
      for (const j of issue.right) for (const row of occurrences[j]) row.matchingIssue = issue;
    }
    rows.forEach((row, i) => {
      if (matches.has(i)) occurrences[matches.get(i)].push(row);
      else occurrences.push([row]);
    });
  }
  withholdUnprovenMultiplicity(occurrences, sources, prepare, stats);
  return occurrences;
};

// A complete contiguous source chain proves repeated balances can be revisited.
// Either direction suffices for cardinality, not for an opening/closing anchor.
// Never use declared order alone, skipped lines, or a mixed-account chain as proof.
// Account-less legacy layouts can verify arithmetic, but cannot prove that a
// repeated balance represents distinct payments. Every bridge needs identity.
const completeSourceChain = (rows) => rows.length > 1
  && rows.every((row) => normalizeBankRowIbanBic(observedBankFacts(row).accountIban))
  && !validateBankStatementSequence(rows).reason;

const withholdUnprovenMultiplicity = (occurrences, sources, prepare, stats) => {
  const provenSources = new Set(sources.filter(({ rows }) => completeSourceChain(rows))
    .map(({ rows }) => rows[0].sourceFileIndex));
  // Prepare and index aliases once, after richer exports have corroborated sparse
  // observations. Hashes identify representations, never extra financial payments.
  const prepared = occurrences.map((aliases) => prepareOccurrence(aliases, prepare));
  const proofs = occurrences.map((aliases) => new Set(aliases.map((row) => row.sourceFileIndex)
    .filter((index) => provenSources.has(index))));
  for (const { left } of matchingComponents(prepared, prepared.length)) {
    if (left.length < 2 || left.some((i) => occurrences[i].some((row) => row.matchingIssue))) continue;
    const proofCounts = new Map();
    for (const i of left) for (const source of proofs[i]) proofCounts.set(source, (proofCounts.get(source) || 0) + 1);
    if ([...proofCounts.values()].includes(left.length)) continue;
    let work = 0, reason = '';
    const charge = () => {
      if (work >= BANK_MATCH_WORK_LIMITS.component || stats.searchWork >= BANK_MATCH_WORK_LIMITS.search) throw MATCH_WORK_EXCEEDED;
      work += 1;
      stats.workUnits += 1;
      stats.searchWork += 1;
    };
    try {
      outer: for (let a = 0; a < left.length; a += 1) for (let b = a + 1; b < left.length; b += 1) {
        charge();
        const i = left[a], j = left[b];
        if ([...proofs[i]].some((source) => { charge(); return proofs[j].has(source); })) continue;
        if (occurrenceRank(prepared[i], prepared[j], false, charge, true)) {
          reason = 'unproven-booking-multiplicity';
          break outer;
        }
      }
    } catch (error) {
      if (error !== MATCH_WORK_EXCEEDED) throw error;
      reason = 'matching-work-budget-exceeded';
    }
    if (reason) {
      const issue = { reason, phase: 'multiplicity', work };
      for (const i of left) for (const row of occurrences[i]) row.matchingIssue = issue;
    }
  }
};

/**
 * Diff a parsed bank statement file against existing bank movements.
 *   Returns { newRows, duplicateRows }.
 *   - newRows: not present in existing → candidates to insert
 *   - duplicateRows: found a match → skip
 */
export const diffAgainstExisting = (parsedRows, existingMovements) => {
  const occurrences = collectBankStatementOccurrences([{ rows: parsedRows }]);
  const matches = matchBookingOccurrences(occurrences, (existingMovements || []).map((row) => [row]));
  const held = new Map((matches.unresolved || []).flatMap((issue) => issue.left.map((i) => [i, issue])));
  return {
    newRows: parsedRows.filter((_, i) => !matches.has(i) && !held.has(i)),
    duplicateRows: parsedRows.filter((_, i) => matches.has(i)),
    ...(held.size ? { unresolvedRows: [...held].map(([i, matchingIssue]) => ({ ...parsedRows[i], matchingIssue })) } : {}),
  };
};

const importFileMetadata = (file = {}) => {
  if (file && typeof file === 'object') {
    return {
      name: file.name || '',
      size: Number(file.size) || 0,
      lastModified: Number(file.lastModified) || null,
    };
  }

  return {
    name: file ? String(file) : '',
    size: 0,
    lastModified: null,
  };
};

const withImportMetadata = (row, importRunId, file) => {
  const importFile = importFileMetadata(file);
  const importLineNumber = row.importLineNumber || row.lineNumber || row.raw?.line || null;
  return { ...row, importRunId, importFile, importLineNumber };
};

const markDuplicate = (row, duplicateReason) => ({ ...row, duplicateReason });

export const classifyBankImportFiles = (fileEntries, existingMovements = [], importRunId = '') => {
  const files = (fileEntries || []).map((entry) => ({
    ...entry,
    importRunId: entry.importRunId || importRunId,
    parsed: entry.parsed || { rows: [], errors: [] },
    diff: { newRows: [], duplicateRows: [] },
    unsupported: (entry.parsed?.errors || []).some((error) => error?.type === 'unsupported-format'),
  }));
  const occurrences = collectBankStatementOccurrences(files.map((file) => ({
    name: file.name,
    rows: (file.parsed.rows || []).map((row) => withImportMetadata(row, file.importRunId, file.file)),
  })));
  const existing = matchBookingOccurrences(occurrences, existingMovements.map((row) => [row]));
  for (const issue of existing.unresolved || []) {
    for (const i of issue.left) for (const row of occurrences[i]) row.matchingIssue = issue;
  }
  occurrences.forEach((aliases, index) => {
    const ordered = [...aliases].sort((a, b) => a.sourceFileIndex - b.sourceFileIndex || a.sourceRowIndex - b.sourceRowIndex);
    ordered.forEach((row, i) => {
      const diff = files[row.sourceFileIndex].diff;
      if (row.matchingIssue) (diff.unresolvedRows ||= []).push(row);
      else if (existing.has(index)) diff.duplicateRows.push(markDuplicate(row, 'existing'));
      else if (i > 0) diff.duplicateRows.push(markDuplicate(row, 'run'));
      else diff.newRows.push({ ...row, ...accumulatedBankEvidence(aliases) });
    });
  });
  for (const file of files) {
    for (const rows of Object.values(file.diff)) rows.sort((a, b) => a.sourceRowIndex - b.sourceRowIndex);
    // Keep the current batch quarantined on retry/removal, even if its graph
    // becomes smaller. Clone parsed rows; never mutate the caller's source facts.
    const held = new Map((file.diff.unresolvedRows || []).map((row) => [row.sourceRowIndex, row.matchingIssue]));
    if (held.size) file.parsed = { ...file.parsed, rows: file.parsed.rows.map((row, i) =>
      held.has(i) ? { ...row, matchingIssue: held.get(i) } : row) };
  }
  const unresolved = files.reduce((sum, file) => sum + (file.diff.unresolvedRows?.length || 0), 0);
  return { files, summary: {
    ...(unresolved ? { unresolved } : {}),
    newRows: files.reduce((sum, file) => sum + file.diff.newRows.length, 0),
    duplicates: files.reduce((sum, file) => sum + file.diff.duplicateRows.length, 0),
    errors: files.reduce((sum, file) => sum + (file.parsed.errors || []).length, 0),
    unsupportedFiles: files.filter((file) => file.unsupported).length,
  } };
};

/** Build the Firestore payload for a parsed bank statement row. */
export const bankRowToMovementPayload = (row, fileName = '') => {
  const direction = row.direction;
  const amount = Math.abs(Number(row.amount) || 0);
  const signedAmount = Number.isFinite(Number(row.signedAmount))
    ? Number(row.signedAmount)
    : (direction === 'out' ? -amount : amount);
  const importFile = importFileMetadata(row.importFile || fileName);
  const importLineNumber = row.importLineNumber || row.lineNumber || row.raw?.line || null;
  const evidence = authoritativeBankEvidence(row);
  const currency = observedBankFacts(row).currency || evidence.bankEvidence?.find((record) => record.currency)?.currency;

  return {
    kind: direction === 'in' ? 'collection' : 'payment',
    direction,
    amount,
    postedDate: row.postedDate,
    valueDate: row.valueDate || row.postedDate,
    description: row.description,
    counterpartyName: row.counterpartyName,
    documentNumber: '',
    // Source tracing — these fields make it easy to re-derive what came from
    // each import run.
    importSource: 'bank-csv',
    importRunId: row.importRunId || '',
    importFile,
    importLineNumber,
    rowHash: row.rowHash || '',
    rowFingerprint: row.rowFingerprint || '',
    ...evidence,
    currency: currency || '', // Missing bank currency stays unknown in storage.
    signedAmount,
    counterpartyIban: row.counterpartyIban || '',
    counterpartyBic: row.counterpartyBic || '',
    sepa: row.sepa || null,
    // Umsätze-only fields — '' / null for kontobewegungen rows, which don't have them.
    bookingText: row.bookingText || '',
    accountIban: row.accountIban || '',
    balanceAfter: typeof row.balanceAfter === 'number' ? row.balanceAfter : null,
    rawDatev: row.rawDatev || row.raw || null,
  };
};
