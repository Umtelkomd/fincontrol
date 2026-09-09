import { describe, expect, it } from 'vitest';

import {
  BANK_IMPORT_SOURCES,
  buildBankRowIdentity,
  classifyBankImportFiles,
  bankRowToMovementPayload,
  deriveMonthEndBalances,
  diffAgainstExisting,
  isBankImport,
  normalizeBankRowAmount,
  normalizeBankRowCounterparty,
  normalizeBankRowDate,
  normalizeBankRowDescription,
  normalizeBankRowIbanBic,
  normalizeBankRowRawColumns,
  parseBankStatementCSV,
  parseSepaPurpose,
} from './bankStatementParser.js';

const kontobewegungenHeader = [
  'Automat',
  'Sammlerauflösung',
  'Buchungsdatum',
  'Valutadatum',
  'Empfängername/Auftraggeber',
  'IBAN/Kontonummer',
  'BIC/BLZ',
  'Verwendungszweck',
  'Betrag in EUR',
  'Notiz',
  'Anzahl Belege',
  'Geprüft',
].join(';');

const kontobewegungenRow = ({
  postedDate = '08.05.2026',
  valueDate = '09.05.2026',
  counterparty = 'ACME GmbH',
  iban = 'de89 3704 0044 0532 0130 00',
  bic = 'coba de ff xxx',
  description = 'Rechnung 4711',
  amount = '1.234,56',
} = {}) => [
  'Nein',
  'Nein',
  postedDate,
  valueDate,
  counterparty,
  iban,
  bic,
  description,
  amount,
  '',
  '0',
  'Ja',
].join(';');

/** Insert a balance column header/value at an arbitrary position (0-12). */
const withBalanceColumn = (line, value, position) => {
  const cols = line.split(';');
  cols.splice(position, 0, value);
  return cols.join(';');
};

const balanceHeaderAt = (position, name = 'Saldo') =>
  withBalanceColumn(kontobewegungenHeader, name, position);

const balanceRowAt = (rowLine, balance, position) =>
  withBalanceColumn(rowLine, balance, position);

describe('bank statement parser identity normalization', () => {
  it('normalizes dates, amounts, counterparties, IBAN/BIC, descriptions, and raw columns for identity', () => {
    expect(normalizeBankRowDate('8.5.2026')).toBe('2026-05-08');
    expect(normalizeBankRowAmount('1.234,50')).toBe('1234.50');
    expect(normalizeBankRowAmount('-12,9')).toBe('-12.90');
    expect(normalizeBankRowAmount(1234.5)).toBe('1234.50');
    expect(normalizeBankRowCounterparty('  ACME   GmbH  ')).toBe('acme gmbh');
    expect(normalizeBankRowIbanBic(' de89 3704 0044 0532 0130 00 ')).toBe('DE89370400440532013000');
    expect(normalizeBankRowDescription(' Rechnung   4711\nFinal ')).toBe('rechnung 4711 final');
    expect(normalizeBankRowRawColumns([' A  ', 'B\nC', null])).toEqual(['A', 'B C', '']);
  });

  it('builds stable row identity independent of file order or import run metadata', () => {
    const baseRow = {
      sourceFormat: 'sparkasse-kontobewegungen',
      postedDate: '2026-05-08',
      valueDate: '2026-05-09',
      signedAmount: 1234.56,
      counterpartyName: 'ACME GmbH',
      counterpartyIban: 'de89 3704 0044 0532 0130 00',
      counterpartyBic: 'coba de ff xxx',
      rawDescription: 'Rechnung 4711',
      raw: { columns: ['ACME GmbH', '1.234,56'], line: 7 },
      importRunId: 'run-a',
    };

    const sameLogicalRow = {
      ...baseRow,
      counterpartyName: '  acme   gmbh ',
      counterpartyIban: 'DE89370400440532013000',
      counterpartyBic: 'COBADEFFXXX',
      importRunId: 'run-b',
      raw: { columns: [' ACME   GmbH ', ' 1.234,56 '], line: 42 },
    };

    expect(buildBankRowIdentity(baseRow)).toEqual(buildBankRowIdentity(sameLogicalRow));
  });

  it('keeps similar rows distinct when identity-relevant bank fields differ', () => {
    const base = {
      sourceFormat: 'sparkasse-kontobewegungen',
      postedDate: '2026-05-08',
      valueDate: '2026-05-09',
      signedAmount: -99.99,
      counterpartyName: 'ACME GmbH',
      counterpartyIban: 'DE89370400440532013000',
      counterpartyBic: 'COBADEFFXXX',
      rawDescription: 'Invoice A',
      raw: { columns: ['ACME GmbH', 'Invoice A'], line: 2 },
    };

    const changedReference = {
      ...base,
      rawDescription: 'Invoice B',
      raw: { columns: ['ACME GmbH', 'Invoice B'], line: 3 },
    };

    expect(buildBankRowIdentity(base).rowHash).not.toBe(buildBankRowIdentity(changedReference).rowHash);
    expect(buildBankRowIdentity(base).rowFingerprint).not.toBe(buildBankRowIdentity(changedReference).rowFingerprint);
  });
});

describe('bank statement parser row identity fields', () => {
  it('parses signed inbound rows while keeping compatible absolute amount and direction', () => {
    const parsed = parseBankStatementCSV(`${kontobewegungenHeader}\n${kontobewegungenRow()}`);

    expect(parsed.errors).toEqual([]);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]).toMatchObject({
      signedAmount: 1234.56,
      amount: 1234.56,
      direction: 'in',
      counterpartyIban: 'DE89370400440532013000',
      counterpartyBic: 'COBADEFFXXX',
      rawDescription: 'Rechnung 4711',
      lineNumber: 2,
      sourceFormat: 'sparkasse-kontobewegungen',
    });
    expect(parsed.rows[0].rowHash).toBe(buildBankRowIdentity(parsed.rows[0]).rowHash);
    expect(parsed.rows[0].raw).toEqual({
      columns: kontobewegungenRow().split(';'),
      line: 2,
    });
  });

  it('parses signed outbound rows while preserving absolute amount compatibility', () => {
    const parsed = parseBankStatementCSV(`${kontobewegungenHeader}\n${kontobewegungenRow({ amount: '-987,65', description: 'Miete Mai' })}`);

    expect(parsed.errors).toEqual([]);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]).toMatchObject({
      signedAmount: -987.65,
      amount: 987.65,
      direction: 'out',
      rawDescription: 'Miete Mai',
    });
  });
});

describe('bank statement row identity stability', () => {
  // rowHash is what stops a re-imported statement from creating duplicates, and
  // buildBankRowIdentity folds sourceFormat into the fingerprint. The label reads
  // "sparkasse-" for historical reasons — the format is the generic German
  // kontobewegungen_export, and this app is fed Volksbank files — but renaming
  // it would change every hash and make all 1576 stored movements look new on
  // the next import. If this test fails, the dedupe key moved: either revert,
  // or ship a migration that rewrites rowHash on the existing documents.
  it('keeps the stored dedupe key byte-stable', () => {
    const parsed = parseBankStatementCSV(`${kontobewegungenHeader}\n${kontobewegungenRow()}`);

    expect(parsed.rows[0].sourceFormat).toBe('sparkasse-kontobewegungen');
    expect(parsed.rows[0].rowHash).toBe('datev-155358786fd928');
  });
});

describe('bank statement parser unsupported format handling', () => {
  it('rejects DATEV classic headers with a file-level unsupported error and zero rows', () => {
    const classic = [
      'Umsatz (ohne Soll/Haben-Kz);Soll/Haben-Kennzeichen;WKZ Umsatz;Konto;Gegenkonto;Belegdatum;Buchungstext',
      '100,00;S;EUR;1200;8400;0805;DATEV classic',
    ].join('\n');

    const parsed = parseBankStatementCSV(classic);

    expect(parsed.rows).toEqual([]);
    expect(parsed.errors).toEqual([
      expect.objectContaining({
        type: 'unsupported-format',
        format: 'datev-classic',
        lineNumber: 1,
      }),
    ]);
    expect(parsed.period).toBeNull();
  });

  it('rejects unknown headers with a file-level unsupported error and zero rows', () => {
    const parsed = parseBankStatementCSV('Date;Amount;Name\n2026-05-08;12.34;ACME');

    expect(parsed.rows).toEqual([]);
    expect(parsed.errors).toEqual([
      expect.objectContaining({
        type: 'unsupported-format',
        format: 'unknown',
        lineNumber: 1,
      }),
    ]);
    expect(parsed.period).toBeNull();
  });
});

describe('bank movement payload mapping', () => {
  it('emits full identity metadata while preserving legacy amount and direction compatibility', () => {
    const row = {
      ...parseBankStatementCSV(`${kontobewegungenHeader}\n${kontobewegungenRow({ amount: '-42,13' })}`).rows[0],
      importRunId: 'datev-run-1',
      importFile: { name: 'may.csv', size: 1234, lastModified: 1778306400000 },
      importLineNumber: 7,
    };

    expect(bankRowToMovementPayload(row, 'fallback.csv')).toMatchObject({
      kind: 'payment',
      direction: 'out',
      amount: 42.13,
      signedAmount: -42.13,
      importSource: 'bank-csv',
      importRunId: 'datev-run-1',
      importFile: { name: 'may.csv', size: 1234, lastModified: 1778306400000 },
      importLineNumber: 7,
      rowHash: row.rowHash,
      rowFingerprint: row.rowFingerprint,
      counterpartyIban: 'DE89370400440532013000',
      counterpartyBic: 'COBADEFFXXX',
      sepa: row.sepa,
      rawDatev: row.raw,
    });
  });
});

describe('bank import source compatibility', () => {
  it('recognizes both the legacy and current importSource values as a bank import', () => {
    expect(BANK_IMPORT_SOURCES).toEqual(['datev', 'bank-csv']);
    expect(isBankImport({ importSource: 'datev' })).toBe(true);
    expect(isBankImport({ importSource: 'bank-csv' })).toBe(true);
    expect(isBankImport({ importSource: 'manual' })).toBe(false);
    expect(isBankImport({ importSource: null })).toBe(false);
    expect(isBankImport({})).toBe(false);
    expect(isBankImport(null)).toBe(false);
    expect(isBankImport(undefined)).toBe(false);
  });
});

describe('SEPA purpose parsing', () => {
  it('parses a compact structured Verwendungszweck with EREF/MREF/CRED/SVWZ', () => {
    const parsed = parseSepaPurpose('EREF+85744504MREF+175323001CRED+DE06UTA00000010046SVWZ+58654564-1');

    expect(parsed).toEqual({
      endToEndRef: '85744504',
      customerRef: '',
      mandateRef: '175323001',
      creditorId: 'DE06UTA00000010046',
      debtorId: '',
      purposeCode: '',
      purpose: '58654564-1',
      alternativeCounterparty: '',
    });
  });

  it('parses a longer structured Verwendungszweck with PURP and a trailing ABWA alternative counterparty', () => {
    const raw = 'EREF+2005849747 OB-83531045MREF+2811875354000002CRED+DE05ZZZ00000018503PURP+OTHRSVWZ+2005849747 OB-83531045 EUR 2.756,40. BEITRAG 0826 - 0826ABWA+AOK Rheinland/Hamburg - Die Gesundheitskasse';
    const parsed = parseSepaPurpose(raw);

    expect(parsed).toEqual({
      endToEndRef: '2005849747 OB-83531045',
      customerRef: '',
      mandateRef: '2811875354000002',
      creditorId: 'DE05ZZZ00000018503',
      debtorId: '',
      purposeCode: 'OTHR',
      purpose: '2005849747 OB-83531045 EUR 2.756,40. BEITRAG 0826 - 0826',
      alternativeCounterparty: 'AOK Rheinland/Hamburg - Die Gesundheitskasse',
    });
  });

  it('returns the whole text as purpose when no SEPA tags are present', () => {
    expect(parseSepaPurpose('Miete Mai 2026')).toEqual({
      endToEndRef: '',
      customerRef: '',
      mandateRef: '',
      creditorId: '',
      debtorId: '',
      purposeCode: '',
      purpose: 'Miete Mai 2026',
      alternativeCounterparty: '',
    });
  });

  it('returns all-empty fields for an empty string', () => {
    expect(parseSepaPurpose('')).toEqual({
      endToEndRef: '',
      customerRef: '',
      mandateRef: '',
      creditorId: '',
      debtorId: '',
      purposeCode: '',
      purpose: '',
      alternativeCounterparty: '',
    });
  });
});

describe('SEPA-aware description does not affect the frozen dedupe hash', () => {
  it('keeps rowHash identical whether or not description was rewritten from a structured SEPA purpose', () => {
    const structuredDescription = 'EREF+85744504MREF+175323001CRED+DE06UTA00000010046SVWZ+Miete Mai';
    const parsed = parseBankStatementCSV(`${kontobewegungenHeader}\n${kontobewegungenRow({ description: structuredDescription })}`);
    const row = parsed.rows[0];

    // description was rewritten to the extracted SVWZ purpose, but rawDescription
    // (which feeds the identity hash) is untouched.
    expect(row.description).toBe('Miete Mai');
    expect(row.rawDescription).toBe(structuredDescription);
    expect(row.rowHash).toBe(buildBankRowIdentity({ ...row, description: 'anything else entirely' }).rowHash);
  });
});

describe('bank statement import dedupe classification', () => {
  it('dedupes within one file by rowHash while attaching run and file metadata to importable rows', () => {
    const row = parseBankStatementCSV(`${kontobewegungenHeader}\n${kontobewegungenRow()}`).rows[0];
    const result = classifyBankImportFiles(
      [{ file: { name: 'may.csv', size: 128, lastModified: 1778306400000 }, parsed: { rows: [row, { ...row, lineNumber: 3 }], errors: [] } }],
      [],
      'datev-run-1',
    );

    expect(result.files[0].diff.newRows).toHaveLength(1);
    expect(result.files[0].diff.newRows[0]).toMatchObject({
      importRunId: 'datev-run-1',
      importFile: { name: 'may.csv', size: 128, lastModified: 1778306400000 },
      importLineNumber: 2,
      rowHash: row.rowHash,
    });
    expect(result.files[0].diff.duplicateRows).toEqual([
      expect.objectContaining({ rowHash: row.rowHash, duplicateReason: 'intra-file' }),
    ]);
    expect(result.summary).toMatchObject({ newRows: 1, duplicates: 1, unsupportedFiles: 0 });
  });

  it('dedupes across selected files before writes using a run-level rowHash set', () => {
    const first = parseBankStatementCSV(`${kontobewegungenHeader}\n${kontobewegungenRow({ counterparty: 'ACME GmbH' })}`).rows[0];
    const second = { ...first, lineNumber: 2 };
    const distinct = parseBankStatementCSV(`${kontobewegungenHeader}\n${kontobewegungenRow({ description: 'Rechnung 4712' })}`).rows[0];

    const result = classifyBankImportFiles(
      [
        { file: { name: 'a.csv', size: 1, lastModified: 1 }, parsed: { rows: [first], errors: [] } },
        { file: { name: 'b.csv', size: 1, lastModified: 2 }, parsed: { rows: [second, distinct], errors: [] } },
      ],
      [],
      'datev-run-2',
    );

    expect(result.files[0].diff.newRows).toHaveLength(1);
    expect(result.files[1].diff.newRows).toHaveLength(1);
    expect(result.files[1].diff.duplicateRows).toEqual([
      expect.objectContaining({ rowHash: first.rowHash, duplicateReason: 'run' }),
    ]);
    expect(result.summary).toMatchObject({ newRows: 2, duplicates: 1 });
  });

  it('dedupes retries against existing rowHash and falls back to legacy movement fingerprint', () => {
    const hashed = parseBankStatementCSV(`${kontobewegungenHeader}\n${kontobewegungenRow({ description: 'Hash hit' })}`).rows[0];
    const legacy = parseBankStatementCSV(`${kontobewegungenHeader}\n${kontobewegungenRow({ description: 'Legacy hit', amount: '-10,00' })}`).rows[0];
    const fresh = parseBankStatementCSV(`${kontobewegungenHeader}\n${kontobewegungenRow({ description: 'Fresh row', amount: '20,00' })}`).rows[0];

    expect(diffAgainstExisting([hashed, legacy, fresh], [
      { rowHash: hashed.rowHash, postedDate: 'nope', amount: 0, direction: 'out', counterpartyName: 'wrong' },
      { postedDate: legacy.postedDate, amount: legacy.amount, direction: legacy.direction, counterpartyName: legacy.counterpartyName },
    ])).toMatchObject({
      newRows: [fresh],
      duplicateRows: [hashed, legacy],
    });
  });
});

describe('optional running-balance column', () => {
  it('parses a balance column appended at the end, recognizing every candidate header name', () => {
    for (const name of ['Saldo', 'saldo nach buchung', 'KONTOSTAND', 'Saldo in EUR', 'Kontostand nach Buchung']) {
      const header = balanceHeaderAt(12, name);
      const csv = `${header}\n${balanceRowAt(kontobewegungenRow(), '2.500,00', 12)}`;
      const parsed = parseBankStatementCSV(csv);
      expect(parsed.errors).toEqual([]);
      expect(parsed.rows[0].balanceAfter).toBe(2500);
    }
  });

  it('resolves the balance column by name when inserted in the middle of the row', () => {
    // Insert right after "Betrag in EUR" (index 8), before "Notiz".
    const header = balanceHeaderAt(9, 'Saldo');
    const csv = `${header}\n${balanceRowAt(kontobewegungenRow(), '999,50', 9)}`;
    const parsed = parseBankStatementCSV(csv);

    expect(parsed.errors).toEqual([]);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]).toMatchObject({
      signedAmount: 1234.56,
      amount: 1234.56,
      direction: 'in',
      counterpartyIban: 'DE89370400440532013000',
      counterpartyBic: 'COBADEFFXXX',
      rawDescription: 'Rechnung 4711',
      balanceAfter: 999.5,
    });
  });

  it('sets balanceAfter to null and balances to [] when the file has no balance column', () => {
    const parsed = parseBankStatementCSV(`${kontobewegungenHeader}\n${kontobewegungenRow()}`);
    expect(parsed.rows[0].balanceAfter).toBeNull();
    expect(parsed.balances).toEqual([]);
  });

  it('sets balanceAfter to null for a blank balance cell', () => {
    const header = balanceHeaderAt(12, 'Saldo');
    const csv = `${header}\n${balanceRowAt(kontobewegungenRow(), '', 12)}`;
    const parsed = parseBankStatementCSV(csv);
    expect(parsed.rows[0].balanceAfter).toBeNull();
  });

  it('keeps rowHash byte-identical whether or not the file carries a balance column, at any position', () => {
    const withoutBalance = parseBankStatementCSV(`${kontobewegungenHeader}\n${kontobewegungenRow()}`).rows[0];

    const header = balanceHeaderAt(9, 'Saldo');
    const csv = `${header}\n${balanceRowAt(kontobewegungenRow(), '999,50', 9)}`;
    const withBalance = parseBankStatementCSV(csv).rows[0];

    expect(withBalance.rowHash).toBe(withoutBalance.rowHash);
    expect(withBalance.rowFingerprint).toBe(withoutBalance.rowFingerprint);
    expect(withBalance.raw.columns).toEqual(withoutBalance.raw.columns);
  });

  it('includes parsed.balances = deriveMonthEndBalances(rows) in the parse result', () => {
    const header = balanceHeaderAt(12, 'Saldo');
    const rows = [
      balanceRowAt(kontobewegungenRow({ postedDate: '31.05.2026', valueDate: '31.05.2026' }), '1.214,20', 12),
      balanceRowAt(kontobewegungenRow({ postedDate: '15.05.2026', valueDate: '15.05.2026' }), '900,00', 12),
    ].join('\n');
    const parsed = parseBankStatementCSV(`${header}\n${rows}`);

    expect(parsed.balances).toEqual(deriveMonthEndBalances(parsed.rows));
    expect(parsed.balances).toEqual([{ date: '2026-05-31', balance: 1214.20 }]);
  });
});

describe('deriveMonthEndBalances', () => {
  const row = (postedDate, lineNumber, balanceAfter) => ({ postedDate, lineNumber, balanceAfter });

  it('returns [] when no row has a balance', () => {
    expect(deriveMonthEndBalances([row('2026-05-08', 2, null), row('2026-05-09', 3, null)])).toEqual([]);
    expect(deriveMonthEndBalances([])).toEqual([]);
  });

  it('picks the latest booking per month in a descending (newest-first) file', () => {
    const rows = [
      row('2026-06-30', 2, 5000),
      row('2026-06-15', 3, 4000),
      row('2026-05-31', 4, 1214.20),
      row('2026-05-10', 5, 900),
    ];
    expect(deriveMonthEndBalances(rows)).toEqual([
      { date: '2026-05-31', balance: 1214.20 },
      { date: '2026-06-30', balance: 5000 },
    ]);
  });

  it('picks the latest booking per month in an ascending (oldest-first) file', () => {
    const rows = [
      row('2026-05-10', 2, 900),
      row('2026-05-31', 3, 1214.20),
      row('2026-06-15', 4, 4000),
      row('2026-06-30', 5, 5000),
    ];
    expect(deriveMonthEndBalances(rows)).toEqual([
      { date: '2026-05-31', balance: 1214.20 },
      { date: '2026-06-30', balance: 5000 },
    ]);
  });

  it('breaks a same-day tie by the SMALLEST lineNumber in a descending file', () => {
    const rows = [
      row('2026-05-31', 2, 100), // top of file = latest booking of the day
      row('2026-05-31', 3, 50),
      row('2026-05-01', 4, 10),
    ];
    expect(deriveMonthEndBalances(rows)).toEqual([{ date: '2026-05-31', balance: 100 }]);
  });

  it('breaks a same-day tie by the LARGEST lineNumber in an ascending file', () => {
    const rows = [
      row('2026-05-01', 2, 10),
      row('2026-05-31', 3, 50),
      row('2026-05-31', 4, 100), // bottom of file = latest booking of the day
    ];
    expect(deriveMonthEndBalances(rows)).toEqual([{ date: '2026-05-31', balance: 100 }]);
  });
});

