/**
 * Bank statement CSV parser (RFC 4180-ish, quoted multiline tolerant)
 *
 * The bank statement, not DATEV, is the reconciliation source. This module
 * parses the generic German online-banking "kontobewegungen_export" layout,
 * not a bank-specific one — UMTELKOMD's files come from Volksbank. The
 * internal format id still reads "sparkasse-kontobewegungen" and every
 * dedupe hash still carries the "datev-" prefix; see detectBankStatementFormat
 * for why those strings must not be renamed — they are frozen identity
 * fields folded into rowHash, the key that stops a re-imported statement
 * from duplicating rows. Renaming either would make every already-stored
 * movement look new on the next import.
 *
 * Format observed:
 *   - Encoding: UTF-8
 *   - Separator: ;
 *   - Date: DD.MM.YYYY
 *   - Amount: 1.234,56 / -12,98 (German: dot=thousands, comma=decimal)
 *   - Sign: positive=inflow, negative=outflow
 *   - 12 columns: Automat, Sammlerauflösung, Buchungsdatum, Valutadatum,
 *     Empfängername/Auftraggeber, IBAN/Kontonummer, BIC/BLZ,
 *     Verwendungszweck, Betrag in EUR, Notiz, Anzahl Belege, Geprüft
 *
 * Optional running-balance column: some exports (e.g. a full-year pull) add
 * a 13th column — any of "Saldo", "Saldo nach Buchung", "Kontostand",
 * "Saldo in EUR", "Kontostand nach Buchung" — in ANY position. Every column,
 * required or optional, is resolved by header NAME (`resolveColumnIndex` /
 * `resolveBalanceColumnIndex`), never by a fixed index, so inserting that
 * column anywhere never shifts the other 12. When present, each row gets a
 * numeric `balanceAfter`; `deriveMonthEndBalances` turns those into one
 * balance per calendar month. The balance column is deliberately excluded
 * from `row.raw.columns` (reconstructed in canonical order, not a positional
 * slice of the file's columns) because `raw.columns` feeds `rowHash` via
 * buildBankRowIdentity — the invariant is: the same movement hashes the same
 * whether or not the file carries a balance column.
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

/** Map each REQUIRED_COLUMNS key to its column index in this file's header. */
const resolveColumnIndex = (header) => {
  const normalized = normalizeHeader(header);
  const index = {};
  for (const { key, name } of REQUIRED_COLUMNS) {
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
};

const SEPA_TAG_PATTERN = /(EREF|KREF|MREF|CRED|DEBT|PURP|SVWZ|ABWA|ABWE)\+/g;

const emptySepaPurpose = () => ({
  endToEndRef: '',
  customerRef: '',
  mandateRef: '',
  creditorId: '',
  debtorId: '',
  purposeCode: '',
  purpose: '',
  alternativeCounterparty: '',
});

/**
 * Parse a SEPA-structured Verwendungszweck (purpose) blob into its tagged
 * fields — EREF+/KREF+/MREF+/CRED+/DEBT+/PURP+/SVWZ+/ABWA+/ABWE+. Tags can
 * appear in any order; a tag's value runs from right after its `+` to the
 * start of the next recognized tag (or the end of the string), trimmed.
 * A field whose tag is absent comes back as ''. Plain text with no
 * recognized tags is returned whole as `purpose`.
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

/**
 * One entry per calendar month covered by `rows`: the balance right after
 * the LATEST booking of that month, taken from each row's `balanceAfter`.
 * Rows normally arrive newest-first (Volksbank exports descending by date),
 * but order is detected rather than assumed: when the file is descending
 * (first row's date > last row's date), a same-day tie is broken by the
 * SMALLEST `lineNumber` (closest to the top = the day's latest booking in a
 * newest-first file); when ascending, by the LARGEST `lineNumber`.
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

  return Array.from(bestByMonth.values())
    .sort((a, b) => a.postedDate.localeCompare(b.postedDate))
    .map((row) => ({ date: row.postedDate, balance: row.balanceAfter }));
};

/**
 * Parse a "Kontobewegungen" export CSV file content.
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
  if (sourceFormat !== 'sparkasse-kontobewegungen') {
    return {
      rows: [],
      errors: [unsupportedFormatError(sourceFormat, header)],
      header,
      period: null,
      balances: [],
    };
  }
  const columnIndex = resolveColumnIndex(header);
  const balanceColumnIndex = resolveBalanceColumnIndex(header);
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
    const postedDate = parseGermanDate(cols[columnIndex.postedDate]);
    const amountSigned = parseGermanAmount(cols[columnIndex.amount]);
    if (!postedDate || amountSigned === 0) {
      errors.push({ lineNumber: i + 1, raw: cols.join(';') });
      continue;
    }
    const direction = amountSigned >= 0 ? 'in' : 'out';
    const rawDescription = (cols[columnIndex.description] || '').trim();
    const sepa = parseSepaPurpose(rawDescription);
    const description = sepa.purpose || rawDescription;
    const signedAmount = amountSigned;
    const balanceCell = balanceColumnIndex >= 0 ? cols[balanceColumnIndex] : null;
    const balanceAfter = balanceCell != null && String(balanceCell).trim() !== ''
      ? parseGermanAmount(balanceCell)
      : null;
    // raw.columns feeds buildBankRowIdentity \u2192 rowHash. It is reconstructed
    // in the canonical REQUIRED_COLUMNS order (NOT a positional slice of
    // `cols`) so a balance column added anywhere in the file \u2014 or absent
    // entirely \u2014 never changes the hash of an otherwise-identical movement.
    const row = {
      sourceFormat,
      lineNumber: i + 1,
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
      signedAmount,
      direction,
      amount: Math.abs(amountSigned),
      notes: (cols[columnIndex.notes] || '').trim(),
      receiptCount: parseInt(cols[columnIndex.receiptCount] || '0', 10) || 0,
      verified: parseGermanBool(cols[columnIndex.verified]),
      raw: {
        columns: REQUIRED_COLUMNS.map(({ key }) => cols[columnIndex[key]]),
        line: i + 1,
      },
    };
    Object.assign(row, buildBankRowIdentity(row));
    rows.push(row);
    if (postedDate < minDate) minDate = postedDate;
    if (postedDate > maxDate) maxDate = postedDate;
  }

  const period = rows.length > 0 ? { minDate, maxDate, count: rows.length } : null;
  return { rows, errors, header, period, balances: deriveMonthEndBalances(rows) };
};

/**
 * Build a deterministic fingerprint for an existing bankMovement so we
 * can detect duplicates across import sessions.
 *
 * Used by the importer to skip rows that already exist with the same
 * postedDate + amount + direction + counterparty (case-insensitive).
 */
export const movementFingerprint = (m) => {
  const date = (m.postedDate || '').slice(0, 10);
  const amount = Math.abs(Number(m.amount) || 0).toFixed(2);
  const direction = m.direction || (Number(m.amount) >= 0 ? 'in' : 'out');
  const cp = String(m.counterpartyName || '').trim().toLowerCase();
  return `${date}|${amount}|${direction}|${cp}`;
};

/**
 * Build the same fingerprint for a parsed DATEV row.
 */
export const bankRowFingerprint = (row) => {
  const date = row.postedDate || '';
  const amount = Math.abs(Number(row.amount) || 0).toFixed(2);
  const direction = row.direction || 'in';
  const cp = String(row.counterpartyName || '').trim().toLowerCase();
  return `${date}|${amount}|${direction}|${cp}`;
};

/**
 * Diff a parsed DATEV file against existing bank movements.
 *   Returns { newRows, duplicateRows }.
 *   - newRows: not present in existing → candidates to insert
 *   - duplicateRows: found a match → skip
 */
export const movementIdentityKey = (movement) => movement?.rowHash || movementFingerprint(movement);

const rowMatchesExistingMovement = (row, existingHashes, existingFingerprints) => {
  if (row?.rowHash && existingHashes.has(row.rowHash)) return true;
  return existingFingerprints.has(bankRowFingerprint(row));
};

/**
 * Diff a parsed DATEV file against existing bank movements.
 *   Returns { newRows, duplicateRows }.
 *   - newRows: not present in existing → candidates to insert
 *   - duplicateRows: found a match → skip
 */
export const diffAgainstExisting = (parsedRows, existingMovements) => {
  const existingHashes = new Set(
    (existingMovements || []).map((m) => m?.rowHash).filter(Boolean),
  );
  const existingFingerprints = new Set(
    (existingMovements || []).map(movementFingerprint),
  );
  const newRows = [];
  const duplicateRows = [];
  for (const row of parsedRows) {
    if (rowMatchesExistingMovement(row, existingHashes, existingFingerprints)) {
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
  const existingHashes = new Set(
    (existingMovements || []).map((m) => m?.rowHash).filter(Boolean),
  );
  const existingFingerprints = new Set(
    (existingMovements || []).map(movementFingerprint),
  );
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

      if (rowMatchesExistingMovement(rowWithMetadata, existingHashes, existingFingerprints)) {
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
    rawDatev: row.rawDatev || row.raw || null,
  };
};
