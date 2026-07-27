/**
 * Kontobewegungen CSV parser (RFC 4180-ish, quoted multiline tolerant)
 *
 * This is the generic German online-banking "kontobewegungen_export" layout,
 * not a bank-specific one — UMTELKOMD's files come from Volksbank. The internal
 * format id still reads "sparkasse-kontobewegungen"; see detectDatevFormat for
 * why that string must not be renamed.
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
 */

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

export const normalizeDatevAmount = (value) => parseGermanAmount(value).toFixed(2);

/** Convert German date "DD.MM.YYYY" → ISO "YYYY-MM-DD". */
export const parseGermanDate = (str) => {
  if (!str) return '';
  const m = String(str).trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!m) return '';
  return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
};

export const normalizeDatevDate = parseGermanDate;

const normalizeText = (value) => String(value || '').replace(/\s+/g, ' ').trim();

export const normalizeDatevCounterparty = (value) => normalizeText(value).toLowerCase();

export const normalizeDatevIbanBic = (value) => normalizeText(value).replace(/\s+/g, '').toUpperCase();

export const normalizeDatevDescription = (value) => normalizeText(value).toLowerCase();

export const normalizeDatevRawColumns = (columns) => (columns || []).map(normalizeText);

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

export const buildDatevIdentity = (row) => {
  const normalizedColumns = normalizeDatevRawColumns(row.raw?.columns);
  const parts = [
    row.sourceFormat || 'sparkasse-kontobewegungen',
    row.accountId || row.sourceAccountIban || '',
    normalizeDatevDate(row.postedDate) || row.postedDate || '',
    normalizeDatevDate(row.valueDate) || row.valueDate || row.postedDate || '',
    Number(row.signedAmount ?? row.amountSigned ?? row.amount ?? 0).toFixed(2),
    normalizeDatevCounterparty(row.counterpartyName),
    normalizeDatevIbanBic(row.counterpartyIban),
    normalizeDatevIbanBic(row.counterpartyBic),
    normalizeDatevDescription(row.rawDescription || row.description),
    normalizedColumns.join('|').toLowerCase(),
  ];
  const rowFingerprint = parts.join('||');
  return {
    rowFingerprint,
    rowHash: `datev-${stableHash(rowFingerprint)}`,
  };
};

const parseGermanBool = (str) => String(str || '').trim().toLowerCase() === 'ja';

const normalizeHeader = (header) => normalizeDatevRawColumns(header).map((col) => col.toLowerCase());

const detectDatevFormat = (header) => {
  const normalized = normalizeHeader(header);
  const headerSet = new Set(normalized);
  const hasKontobewegungenColumns = [
    'buchungsdatum',
    'valutadatum',
    'empfängername/auftraggeber',
    'iban/kontonummer',
    'bic/blz',
    'verwendungszweck',
    'betrag in eur',
  ].every((name) => headerSet.has(name));
  // These columns are the standard German kontobewegungen_export layout, shared
  // across banks — Volksbank files match it just as well as Sparkasse ones.
  //
  // The returned id is deliberately NOT renamed: buildDatevIdentity folds it
  // into rowFingerprint and therefore into rowHash, the key that stops a
  // re-imported statement from duplicating rows. Changing this string would
  // make every already-stored movement look new. See the stability test in
  // datevParser.test.js.
  if (hasKontobewegungenColumns) return 'sparkasse-kontobewegungen';

  const hasClassicColumns = normalized.some((name) => (
    name.includes('soll/haben-kennzeichen')
    || name.includes('umsatz (ohne soll/haben-kz)')
    || name === 'gegenkonto'
  ));
  return hasClassicColumns ? 'datev-classic' : 'unknown';
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
 * Parse a "Kontobewegungen" export CSV file content.
 * Returns { rows, errors, header, period }.
 *   rows:    array of normalized movement objects
 *   errors:  rows that couldn't be parsed (with line number + raw)
 *   header:  raw header line as array of column names
 *   period:  { minDate, maxDate, count }
 */
export const parseDatevCSV = (text) => {
  if (!text) return { rows: [], errors: [], header: [], period: null };

  // Strip BOM if present
  const cleaned = text.replace(/^\uFEFF/, '');
  const allRows = parseCSVText(cleaned, ';');
  if (allRows.length === 0) return { rows: [], errors: [], header: [], period: null };

  const header = allRows[0];
  const sourceFormat = detectDatevFormat(header);
  if (sourceFormat !== 'sparkasse-kontobewegungen') {
    return { rows: [], errors: [unsupportedFormatError(sourceFormat, header)], header, period: null };
  }
  const rows = [];
  const errors = [];

  let minDate = '9999-99-99';
  let maxDate = '0000-00-00';

  for (let i = 1; i < allRows.length; i++) {
    const cols = allRows[i];
    if (cols.length < 9) {
      errors.push({ lineNumber: i + 1, raw: cols.join(';') });
      continue;
    }
    const postedDate = parseGermanDate(cols[2]);
    const amountSigned = parseGermanAmount(cols[8]);
    if (!postedDate || amountSigned === 0) {
      errors.push({ lineNumber: i + 1, raw: cols.join(';') });
      continue;
    }
    const direction = amountSigned >= 0 ? 'in' : 'out';
    const rawDescription = (cols[7] || '').trim();
    const signedAmount = amountSigned;
    const row = {
      sourceFormat,
      lineNumber: i + 1,
      automat: parseGermanBool(cols[0]),
      sammler: parseGermanBool(cols[1]),
      postedDate,
      valueDate: parseGermanDate(cols[3]) || postedDate,
      counterpartyName: (cols[4] || '').trim(),
      counterpartyIban: normalizeDatevIbanBic(cols[5]),
      counterpartyBic: normalizeDatevIbanBic(cols[6]),
      description: rawDescription,
      rawDescription,
      amountSigned,
      signedAmount,
      direction,
      amount: Math.abs(amountSigned),
      notes: (cols[9] || '').trim(),
      receiptCount: parseInt(cols[10] || '0', 10) || 0,
      verified: parseGermanBool(cols[11]),
      raw: { columns: [...cols], line: i + 1 },
    };
    Object.assign(row, buildDatevIdentity(row));
    rows.push(row);
    if (postedDate < minDate) minDate = postedDate;
    if (postedDate > maxDate) maxDate = postedDate;
  }

  const period = rows.length > 0 ? { minDate, maxDate, count: rows.length } : null;
  return { rows, errors, header, period };
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
export const datevRowFingerprint = (row) => {
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
  return existingFingerprints.has(datevRowFingerprint(row));
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

export const classifyDatevImportFiles = (fileEntries, existingMovements = [], importRunId = '') => {
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
      const legacyFingerprint = datevRowFingerprint(rowWithMetadata);
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

/** Build the Firestore payload for a parsed DATEV row. */
export const datevRowToBankMovementPayload = (row, fileName = '') => {
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
    importSource: 'datev',
    importRunId: row.importRunId || '',
    importFile,
    importLineNumber,
    rowHash: row.rowHash || '',
    rowFingerprint: row.rowFingerprint || '',
    signedAmount,
    counterpartyIban: row.counterpartyIban || '',
    counterpartyBic: row.counterpartyBic || '',
    rawDatev: row.rawDatev || row.raw || null,
  };
};
