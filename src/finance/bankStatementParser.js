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
const SEPA_TAG_PATTERN = /(EREF|KREF|MREF|CRED|DEBT|PURP|SVWZ|ABWA|ABWE|ANAM|TAN|IBAN|BIC)(?:\+|:\s*)/g;

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

const unsupportedFormatError = (format, header) => ({
  type: 'unsupported-format',
  format,
  lineNumber: 1,
  raw: header.join(';'),
  message: format === 'datev-classic'
    ? 'DATEV classic CSV is not supported for bank movement import yet.'
    : 'Unrecognized kontobewegungen CSV headers; no rows were imported.',
});

/** Last calendar day of `monthKey` ('YYYY-MM') as an ISO date string. */
const lastDayOfMonth = (monthKey) => {
  const [year, month] = monthKey.split('-').map(Number);
  // `month` (1-indexed, e.g. 2 for February) used as the 0-indexed monthIndex
  // with day 0 yields the day before that month's 1st in JS Date terms —
  // i.e. the last day of the PREVIOUS 0-indexed month, which is `month`
  // itself in 1-indexed terms. Example: month=2 → Date.UTC(y, 2, 0) → last
  // day of February.
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${monthKey}-${String(lastDay).padStart(2, '0')}`;
};

/**
 * One entry per calendar month covered by `rows`: the balance right after
 * the LATEST booking of that month, taken from each row's `balanceAfter`.
 * Rows normally arrive newest-first (Volksbank exports descending by date),
 * but order is detected rather than assumed: when the file is descending
 * (first row's date > last row's date), a same-day tie is broken by the
 * SMALLEST `lineNumber` (closest to the top = the day's latest booking in a
 * newest-first file); when ascending, by the LARGEST `lineNumber`.
 *
 * The reported `date` is normally the actual LAST CALENDAR DAY of the month
 * — a bank's month-end closing booking can land a day or two before the
 * 31st/30th/28th (e.g. a 2026-05-29 closing booking still means "balance as
 * of 2026-05-31") — EXCEPT for the newest month present in `rows`: when its
 * winning row's date is before that month's last calendar day, the month is
 * still open (this is the most current data this call has), so its actual
 * booking date is kept as-is instead of being rounded forward to a day that
 * hasn't happened yet. A caller combining several files/periods should feed
 * this function the full merged, correctly-ordered row set so only the
 * TRULY newest month in the combined history keeps a partial date.
 *
 * Returns [] when no row carries a balance.
 * @param {Array<{postedDate: string, lineNumber: number, balanceAfter: number|null}>} rows
 * @returns {Array<{date: string, balance: number}>}
 */
export const deriveMonthEndBalances = (rows) => {
  if (!Array.isArray(rows) || rows.length === 0) return [];

  const withBalance = rows.filter(
    (row) => typeof row?.balanceAfter === 'number'
      && Number.isFinite(row.balanceAfter)
      && typeof row?.postedDate === 'string'
      && row.postedDate,
  );
  if (withBalance.length === 0) return [];

  const firstDate = rows[0]?.postedDate || '';
  const lastDate = rows[rows.length - 1]?.postedDate || '';
  const descending = firstDate > lastDate;

  const bestByMonth = new Map();
  for (const row of withBalance) {
    const monthKey = row.postedDate.slice(0, 7);
    const current = bestByMonth.get(monthKey);
    if (!current) {
      bestByMonth.set(monthKey, row);
      continue;
    }
    if (row.postedDate > current.postedDate) {
      bestByMonth.set(monthKey, row);
    } else if (row.postedDate === current.postedDate) {
      const rowLine = Number(row.lineNumber) || 0;
      const currentLine = Number(current.lineNumber) || 0;
      const rowWins = descending ? rowLine < currentLine : rowLine > currentLine;
      if (rowWins) bestByMonth.set(monthKey, row);
    }
  }

  const newestMonthKey = Array.from(bestByMonth.keys()).sort().at(-1);

  return Array.from(bestByMonth.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([monthKey, row]) => ({
      date: monthKey === newestMonthKey ? row.postedDate : lastDayOfMonth(monthKey),
      balance: row.balanceAfter,
    }));
};

/**
 * Merge several already-parsed files (each from its own `parseBankStatementCSV`
 * call — one format per file, no mixed-format parsing needed) into one
 * chronologically-ordered row set, then derive one balance per calendar
 * month from that UNION via a single `deriveMonthEndBalances` call.
 *
 * Why this matters: `deriveMonthEndBalances` only knows a month is still
 * open when it's the newest month in the array it's given. A single file's
 * own `parsed.balances` therefore reports ITS OWN last month as partial even
 * when a later file proves that month actually closed (e.g. an Abril-Mayo
 * export's last booking is 2026-05-29 → alone, `.balances` says May is
 * still 2026-05-29; once June-onward rows are unioned in here, May
 * correctly closes to 2026-05-31). Files are ordered by their own period's
 * newest date, each file's internal (newest-first) row order preserved;
 * `lineNumber` is renumbered sequentially across the union so a same-day
 * tie — within one file, or across overlapping files — resolves the same
 * way a single file's does (the more recent file's rows get the smaller,
 * more-recent-looking line numbers).
 *
 * @param {Array<{name?: string, rows: object[], period: {minDate:string,maxDate:string,count:number}|null}>} files
 * @returns {{ rows: object[], balances: Array<{date: string, balance: number}> }}
 */
export const mergeParsedFiles = (files) => {
  const withRows = (files || []).filter((file) => (file?.rows?.length || 0) > 0);
  const byRecency = [...withRows].sort(
    (a, b) => (b.period?.maxDate || '').localeCompare(a.period?.maxDate || ''),
  );
  const rows = [];
  let order = 0;
  for (const file of byRecency) {
    for (const row of file.rows) {
      order += 1;
      rows.push({ ...row, lineNumber: order, sourceFileName: file.name || '' });
    }
  }
  return { rows, balances: deriveMonthEndBalances(rows) };
};

/**
 * Build one kontobewegungen_export row. Returns null when the row is
 * unparsable (caller pushes it to `errors`).
 */
const buildKontobewegungenRow = (cols, columnIndex, balanceColumnIndex, lineNumber, sourceFormat) => {
  const postedDate = parseGermanDate(cols[columnIndex.postedDate]);
  const amountSigned = parseGermanAmount(cols[columnIndex.amount]);
  if (!postedDate || amountSigned === 0) return null;

  const direction = amountSigned >= 0 ? 'in' : 'out';
  const rawDescription = (cols[columnIndex.description] || '').trim();
  const sepa = parseSepaPurpose(rawDescription);
  const description = sepa.purpose || rawDescription;
  const balanceCell = balanceColumnIndex >= 0 ? cols[balanceColumnIndex] : null;
  const balanceAfter = balanceCell != null && String(balanceCell).trim() !== ''
    ? parseGermanAmount(balanceCell)
    : null;

  // raw.columns feeds buildBankRowIdentity \u2192 rowHash. It is reconstructed
  // in the canonical REQUIRED_COLUMNS order (NOT a positional slice of
  // `cols`) so a balance column added anywhere in the file \u2014 or absent
  // entirely \u2014 never changes the hash of an otherwise-identical movement.
  return {
    sourceFormat,
    lineNumber,
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
  const amountSigned = parseGermanAmount(cols[columnIndex.amount]);
  if (!postedDate || amountSigned === 0) return null;

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
  const balanceAfter = balanceCell != null && String(balanceCell).trim() !== ''
    ? parseGermanAmount(balanceCell)
    : null;

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
    currency: (cols[columnIndex.currency] || '').trim() || 'EUR',
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
 *   errors:    rows that couldn't be parsed (with line number + raw)
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

    Object.assign(row, buildBankRowIdentity(row));
    rows.push(row);
    if (row.postedDate < minDate) minDate = row.postedDate;
    if (row.postedDate > maxDate) maxDate = row.postedDate;
  }

  const period = rows.length > 0 ? { minDate, maxDate, count: rows.length } : null;
  return { rows, errors, header, period, balances: deriveMonthEndBalances(rows) };
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
 * party ONLY for matching a freshly-parsed row against an ALREADY-STORED
 * ledger movement (never used for the rowHash/rowFingerprint identity
 * itself, and never for intra-batch dedup — see classifyBankImportFiles).
 * Beyond an exact match after the same punctuation-insensitive
 * normalization `movementFingerprint` uses:
 *   - a blank name on either side also matches. The old kontobewegungen
 *     parser left fee/closing rows (Buchungstext "Entgelt/Auslagen" /
 *     "Abschluss") with an empty counterparty; this parser fills the same
 *     kind of row with the account's own bank name (buildUmsaetzeRow), so a
 *     blank vs. a real bank name for the exact same date+amount+direction
 *     is the same booking, not a different one.
 *   - a long shared prefix also matches. The old export truncates long
 *     counterparty names (observed in production: cut mid-word around 55
 *     characters, e.g. "Schomerus & Partner mbB Steuerberater Rechtsanwälte
 *     Wi" vs the untruncated "Schomerus + Partner mbB Steuerberater
 *     Rechtsanwälte Wirtschaftsprüfer"). Requiring at least 15 matching
 *     characters keeps this from ever matching two genuinely different
 *     (short) names that merely start alike.
 */
const counterpartiesMatchForDedup = (a, b) => {
  const na = normalizeFingerprintCounterparty(a);
  const nb = normalizeFingerprintCounterparty(b);
  if (na === nb) return true;
  if (!na || !nb) return true;
  const [shorter, longer] = na.length <= nb.length ? [na, nb] : [nb, na];
  return shorter.length >= 15 && longer.startsWith(shorter);
};

/**
 * Index of already-stored bankMovements for duplicate detection: exact
 * rowHash / legacy fingerprint Sets (fast path) plus a date|amount|direction
 * → candidates map (fallback path, see counterpartiesMatchForDedup).
 */
const buildExistingMovementIndex = (existingMovements) => {
  const hashes = new Set();
  const fingerprints = new Set();
  const byTriple = new Map();
  for (const movement of existingMovements || []) {
    if (movement?.rowHash) hashes.add(movement.rowHash);
    fingerprints.add(movementFingerprint(movement));
    const key = dedupTripleKey(movement?.postedDate, movement?.amount, movement?.direction);
    if (!byTriple.has(key)) byTriple.set(key, []);
    byTriple.get(key).push(movement);
  }
  return { hashes, fingerprints, byTriple };
};

const rowMatchesExistingMovement = (row, index) => {
  if (row?.rowHash && index.hashes.has(row.rowHash)) return true;
  if (index.fingerprints.has(bankRowFingerprint(row))) return true;
  const key = dedupTripleKey(row?.postedDate, row?.amount, row?.direction);
  const candidates = index.byTriple.get(key) || [];
  return candidates.some((movement) => counterpartiesMatchForDedup(row?.counterpartyName, movement?.counterpartyName));
};

/**
 * Diff a parsed bank statement file against existing bank movements.
 *   Returns { newRows, duplicateRows }.
 *   - newRows: not present in existing → candidates to insert
 *   - duplicateRows: found a match → skip
 */
export const diffAgainstExisting = (parsedRows, existingMovements) => {
  const index = buildExistingMovementIndex(existingMovements);
  const newRows = [];
  const duplicateRows = [];
  for (const row of parsedRows) {
    if (rowMatchesExistingMovement(row, index)) {
      duplicateRows.push(row);
    } else {
      newRows.push(row);
    }
  }
  return { newRows, duplicateRows };
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
  const existingIndex = buildExistingMovementIndex(existingMovements);
  const runHashes = new Set();
  const runFingerprints = new Set();
  let newRows = 0;
  let duplicates = 0;
  let errors = 0;
  let unsupportedFiles = 0;

  const files = (fileEntries || []).map((entry) => {
    const parsed = entry.parsed || { rows: [], errors: [] };
    const entryImportRunId = entry.importRunId || importRunId;
    const fileSeenHashes = new Set();
    const fileSeenFingerprints = new Set();
    const diff = { newRows: [], duplicateRows: [] };
    const isUnsupported = (parsed.errors || []).some((error) => error?.type === 'unsupported-format');
    if (isUnsupported) unsupportedFiles += 1;
    errors += (parsed.errors || []).length;

    for (const row of parsed.rows || []) {
      const rowWithMetadata = withImportMetadata(row, entryImportRunId, entry.file);
      const rowHash = rowWithMetadata.rowHash;
      const legacyFingerprint = bankRowFingerprint(rowWithMetadata);
      let duplicateReason = null;

      if (rowMatchesExistingMovement(rowWithMetadata, existingIndex)) {
        duplicateReason = 'existing';
      } else if (rowHash ? fileSeenHashes.has(rowHash) : fileSeenFingerprints.has(legacyFingerprint)) {
        duplicateReason = 'intra-file';
      } else if (rowHash ? runHashes.has(rowHash) : runFingerprints.has(legacyFingerprint)) {
        duplicateReason = 'run';
      }

      if (duplicateReason) {
        diff.duplicateRows.push(markDuplicate(rowWithMetadata, duplicateReason));
        duplicates += 1;
      } else {
        diff.newRows.push(rowWithMetadata);
        newRows += 1;
        if (rowHash) runHashes.add(rowHash);
        runFingerprints.add(legacyFingerprint);
      }

      if (rowHash) fileSeenHashes.add(rowHash);
      fileSeenFingerprints.add(legacyFingerprint);
    }

    return { ...entry, importRunId: entryImportRunId, parsed, diff, unsupported: isUnsupported };
  });

  return { files, summary: { newRows, duplicates, errors, unsupportedFiles } };
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
