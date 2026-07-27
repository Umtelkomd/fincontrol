import { describe, expect, it } from 'vitest';

import {
  buildDatevIdentity,
  classifyDatevImportFiles,
  datevRowToBankMovementPayload,
  diffAgainstExisting,
  normalizeDatevAmount,
  normalizeDatevCounterparty,
  normalizeDatevDate,
  normalizeDatevDescription,
  normalizeDatevIbanBic,
  normalizeDatevRawColumns,
  parseDatevCSV,
} from './datevParser.js';

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

describe('DATEV parser identity normalization', () => {
  it('normalizes dates, amounts, counterparties, IBAN/BIC, descriptions, and raw columns for identity', () => {
    expect(normalizeDatevDate('8.5.2026')).toBe('2026-05-08');
    expect(normalizeDatevAmount('1.234,50')).toBe('1234.50');
    expect(normalizeDatevAmount('-12,9')).toBe('-12.90');
    expect(normalizeDatevAmount(1234.5)).toBe('1234.50');
    expect(normalizeDatevCounterparty('  ACME   GmbH  ')).toBe('acme gmbh');
    expect(normalizeDatevIbanBic(' de89 3704 0044 0532 0130 00 ')).toBe('DE89370400440532013000');
    expect(normalizeDatevDescription(' Rechnung   4711\nFinal ')).toBe('rechnung 4711 final');
    expect(normalizeDatevRawColumns([' A  ', 'B\nC', null])).toEqual(['A', 'B C', '']);
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

    expect(buildDatevIdentity(baseRow)).toEqual(buildDatevIdentity(sameLogicalRow));
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

    expect(buildDatevIdentity(base).rowHash).not.toBe(buildDatevIdentity(changedReference).rowHash);
    expect(buildDatevIdentity(base).rowFingerprint).not.toBe(buildDatevIdentity(changedReference).rowFingerprint);
  });
});

describe('DATEV parser row identity fields', () => {
  it('parses signed inbound rows while keeping compatible absolute amount and direction', () => {
    const parsed = parseDatevCSV(`${kontobewegungenHeader}\n${kontobewegungenRow()}`);

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
    expect(parsed.rows[0].rowHash).toBe(buildDatevIdentity(parsed.rows[0]).rowHash);
    expect(parsed.rows[0].raw).toEqual({
      columns: kontobewegungenRow().split(';'),
      line: 2,
    });
  });

  it('parses signed outbound rows while preserving absolute amount compatibility', () => {
    const parsed = parseDatevCSV(`${kontobewegungenHeader}\n${kontobewegungenRow({ amount: '-987,65', description: 'Miete Mai' })}`);

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

describe('DATEV row identity stability', () => {
  // rowHash is what stops a re-imported statement from creating duplicates, and
  // buildDatevIdentity folds sourceFormat into the fingerprint. The label reads
  // "sparkasse-" for historical reasons — the format is the generic German
  // kontobewegungen_export, and this app is fed Volksbank files — but renaming
  // it would change every hash and make all 1576 stored movements look new on
  // the next import. If this test fails, the dedupe key moved: either revert,
  // or ship a migration that rewrites rowHash on the existing documents.
  it('keeps the stored dedupe key byte-stable', () => {
    const parsed = parseDatevCSV(`${kontobewegungenHeader}\n${kontobewegungenRow()}`);

    expect(parsed.rows[0].sourceFormat).toBe('sparkasse-kontobewegungen');
    expect(parsed.rows[0].rowHash).toBe('datev-155358786fd928');
  });
});

describe('DATEV parser unsupported format handling', () => {
  it('rejects DATEV classic headers with a file-level unsupported error and zero rows', () => {
    const classic = [
      'Umsatz (ohne Soll/Haben-Kz);Soll/Haben-Kennzeichen;WKZ Umsatz;Konto;Gegenkonto;Belegdatum;Buchungstext',
      '100,00;S;EUR;1200;8400;0805;DATEV classic',
    ].join('\n');

    const parsed = parseDatevCSV(classic);

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
    const parsed = parseDatevCSV('Date;Amount;Name\n2026-05-08;12.34;ACME');

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

describe('DATEV bank movement payload mapping', () => {
  it('emits full identity metadata while preserving legacy amount and direction compatibility', () => {
    const row = {
      ...parseDatevCSV(`${kontobewegungenHeader}\n${kontobewegungenRow({ amount: '-42,13' })}`).rows[0],
      importRunId: 'datev-run-1',
      importFile: { name: 'may.csv', size: 1234, lastModified: 1778306400000 },
      importLineNumber: 7,
    };

    expect(datevRowToBankMovementPayload(row, 'fallback.csv')).toMatchObject({
      kind: 'payment',
      direction: 'out',
      amount: 42.13,
      signedAmount: -42.13,
      importSource: 'datev',
      importRunId: 'datev-run-1',
      importFile: { name: 'may.csv', size: 1234, lastModified: 1778306400000 },
      importLineNumber: 7,
      rowHash: row.rowHash,
      rowFingerprint: row.rowFingerprint,
      counterpartyIban: 'DE89370400440532013000',
      counterpartyBic: 'COBADEFFXXX',
      rawDatev: row.raw,
    });
  });
});

describe('DATEV import dedupe classification', () => {
  it('dedupes within one file by rowHash while attaching run and file metadata to importable rows', () => {
    const row = parseDatevCSV(`${kontobewegungenHeader}\n${kontobewegungenRow()}`).rows[0];
    const result = classifyDatevImportFiles(
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
    const first = parseDatevCSV(`${kontobewegungenHeader}\n${kontobewegungenRow({ counterparty: 'ACME GmbH' })}`).rows[0];
    const second = { ...first, lineNumber: 2 };
    const distinct = parseDatevCSV(`${kontobewegungenHeader}\n${kontobewegungenRow({ description: 'Rechnung 4712' })}`).rows[0];

    const result = classifyDatevImportFiles(
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
    const hashed = parseDatevCSV(`${kontobewegungenHeader}\n${kontobewegungenRow({ description: 'Hash hit' })}`).rows[0];
    const legacy = parseDatevCSV(`${kontobewegungenHeader}\n${kontobewegungenRow({ description: 'Legacy hit', amount: '-10,00' })}`).rows[0];
    const fresh = parseDatevCSV(`${kontobewegungenHeader}\n${kontobewegungenRow({ description: 'Fresh row', amount: '20,00' })}`).rows[0];

    expect(diffAgainstExisting([hashed, legacy, fresh], [
      { rowHash: hashed.rowHash, postedDate: 'nope', amount: 0, direction: 'out', counterpartyName: 'wrong' },
      { postedDate: legacy.postedDate, amount: legacy.amount, direction: legacy.direction, counterpartyName: legacy.counterpartyName },
    ])).toMatchObject({
      newRows: [fresh],
      duplicateRows: [hashed, legacy],
    });
  });
});

