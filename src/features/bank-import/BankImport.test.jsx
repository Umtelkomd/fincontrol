/**
 * BankImport — full-year statement import support.
 *
 * These tests protect the "Saldos de cierre detectados" panel: a CSV that
 * carries a running-balance column must surface one row per month, mark the
 * months that already have a reconciliation anchor on that exact date, and
 * let an admin register the missing ones with one click — without ever
 * writing anything before that click.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { installFirebaseMocks } from '@/test/firebaseMock';
import { reconciliationDoc } from '@/test/fixtures';

const KONTOBEWEGUNGEN_HEADER =
  'Automat;Sammlerauflösung;Buchungsdatum;Valutadatum;Empfängername/Auftraggeber;IBAN/Kontonummer;BIC/BLZ;Verwendungszweck;Betrag in EUR;Notiz;Anzahl Belege;Geprüft;Saldo';

const csvRow = (postedDate, amount, balance) =>
  `Nein;Nein;${postedDate};${postedDate};ACME GmbH;DE89370400440532013000;COBADEFFXXX;Rechnung;${amount};;0;Ja;${balance}`;

// Covers two months: May (already anchored on 2026-05-31) and June (missing).
const CSV_TEXT = [
  KONTOBEWEGUNGEN_HEADER,
  csvRow('31.05.2026', '1.234,56', '1.214,20'),
  csvRow('30.06.2026', '500,00', '5.000,00'),
].join('\n');

const store = installFirebaseMocks({
  documents: {
    reconciliation: reconciliationDoc([
      { date: '2026-05-31', balance: 1214.2, source: 'DATEV SuSa 1200' },
    ]),
  },
});

const firestore = await import('firebase/firestore');
const { renderScreen } = await import('@/test/renderScreen.jsx');
const { default: BankImport } = await import('./BankImport.jsx');

beforeEach(() => {
  firestore.setDoc.mockClear();
});

const uploadCsv = async (name = 'kontobewegungen_export.csv') => {
  const file = new File([CSV_TEXT], name, { type: 'text/csv' });
  const input = document.querySelector('input[type="file"]');
  fireEvent.change(input, { target: { files: [file] } });
  await screen.findByText('Saldos de cierre detectados');
};

describe('BankImport — detected month-end balances', () => {
  it('lists one row per month and marks the month that already has an anchor', async () => {
    renderScreen(<BankImport user={{ uid: 'u1', email: 'jromero@umtelkomd.com' }} />);
    await uploadCsv();

    expect(screen.getByText(/mayo de 2026/i)).toBeInTheDocument();
    expect(screen.getByText(/junio de 2026/i)).toBeInTheDocument();
    expect(screen.getByText('1.214,20')).toBeInTheDocument();
    expect(screen.getByText('5.000,00')).toBeInTheDocument();

    const rows = screen.getAllByRole('row');
    const mayRow = rows.find((r) => /mayo/i.test(r.textContent));
    const juneRow = rows.find((r) => /junio/i.test(r.textContent));
    expect(mayRow.textContent).toMatch(/Ya registrada/);
    expect(juneRow.textContent).toMatch(/Pendiente/);
  });

  it('only offers to register the missing month, and writes nothing before the click', async () => {
    renderScreen(<BankImport user={{ uid: 'u1', email: 'jromero@umtelkomd.com' }} />);
    await uploadCsv();

    const button = screen.getByRole('button', { name: /Registrar \/ corregir anclas \(1\)/i });
    expect(firestore.setDoc).not.toHaveBeenCalled();

    fireEvent.click(button);

    await waitFor(() => expect(firestore.setDoc).toHaveBeenCalledTimes(1));
    const [, payload] = firestore.setDoc.mock.calls[0];
    expect(payload.anchors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ date: '2026-05-31', balance: 1214.2 }),
        expect.objectContaining({
          date: '2026-06-30',
          balance: 5000,
          source: 'Extracto Volksbank (import kontobewegungen_export.csv)',
        }),
      ]),
    );
    expect(payload.anchors).toHaveLength(2);
  });
});

describe('BankImport — discrepant anchors', () => {
  it('flags an existing anchor whose balance disagrees with the detected one, and the button corrects it', async () => {
    // Seed a WRONG June anchor (real production shape: an anchor exists on
    // the exact closing date but with a stale/incorrect balance).
    store.documents.reconciliation = reconciliationDoc([
      { date: '2026-05-31', balance: 1214.2, source: 'DATEV SuSa 1200' },
      { date: '2026-06-30', balance: 4000, source: 'manual (wrong)' },
    ]);

    renderScreen(<BankImport user={{ uid: 'u1', email: 'jromero@umtelkomd.com' }} />);
    await uploadCsv();

    const rows = screen.getAllByRole('row');
    const juneRow = rows.find((r) => /junio/i.test(r.textContent));
    expect(juneRow.textContent).toMatch(/Discrepante/);
    expect(juneRow.textContent).toContain('4.000,00');
    expect(juneRow.textContent).toContain('5.000,00');

    const button = screen.getByRole('button', { name: /Registrar \/ corregir anclas \(1\)/i });
    fireEvent.click(button);

    await waitFor(() => expect(firestore.setDoc).toHaveBeenCalledTimes(1));
    const [, payload] = firestore.setDoc.mock.calls[0];
    expect(payload.anchors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ date: '2026-05-31', balance: 1214.2 }),
        expect.objectContaining({
          date: '2026-06-30',
          balance: 5000,
          source: 'Extracto Volksbank (import kontobewegungen_export.csv)',
          note: 'Corrige 5.000,00 € (antes 4.000,00 €)',
        }),
      ]),
    );
    expect(payload.anchors).toHaveLength(2);

    // Reset for any later test in this file.
    store.documents.reconciliation = reconciliationDoc([
      { date: '2026-05-31', balance: 1214.2, source: 'DATEV SuSa 1200' },
    ]);
  });

  it('never touches an anchor on a non-month-end date (e.g. 2026-07-27)', async () => {
    store.documents.reconciliation = reconciliationDoc([
      { date: '2026-05-31', balance: 1214.2, source: 'DATEV SuSa 1200' },
      { date: '2026-07-27', balance: -16395.13, source: 'bank statement' },
    ]);

    renderScreen(<BankImport user={{ uid: 'u1', email: 'jromero@umtelkomd.com' }} />);
    await uploadCsv();

    // Only May and June are detected month-end dates; 07-27 never appears.
    expect(screen.queryByText(/27\.07/)).not.toBeInTheDocument();
    const button = screen.getByRole('button', { name: /Registrar \/ corregir anclas \(1\)/i });
    fireEvent.click(button);

    await waitFor(() => expect(firestore.setDoc).toHaveBeenCalledTimes(1));
    const [, payload] = firestore.setDoc.mock.calls[0];
    // The 07-27 anchor survives untouched.
    expect(payload.anchors).toEqual(
      expect.arrayContaining([expect.objectContaining({ date: '2026-07-27', balance: -16395.13 })]),
    );

    store.documents.reconciliation = reconciliationDoc([
      { date: '2026-05-31', balance: 1214.2, source: 'DATEV SuSa 1200' },
    ]);
  });
});

describe('BankImport — no balance column', () => {
  it('never shows the balances panel for a plain 12-column file', async () => {
    renderScreen(<BankImport user={{ uid: 'u1', email: 'jromero@umtelkomd.com' }} />);
    const plainHeader =
      'Automat;Sammlerauflösung;Buchungsdatum;Valutadatum;Empfängername/Auftraggeber;IBAN/Kontonummer;BIC/BLZ;Verwendungszweck;Betrag in EUR;Notiz;Anzahl Belege;Geprüft';
    const plainCsv = [plainHeader, 'Nein;Nein;08.05.2026;08.05.2026;ACME;DE89;COBA;Rechnung;100,00;;0;Ja'].join('\n');
    const file = new File([plainCsv], 'sin-saldo.csv', { type: 'text/csv' });
    const input = document.querySelector('input[type="file"]');
    fireEvent.change(input, { target: { files: [file] } });

    await screen.findByText('sin-saldo.csv');
    expect(screen.queryByText('Saldos de cierre detectados')).not.toBeInTheDocument();
  });
});
