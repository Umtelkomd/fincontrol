/**
 * Facturas — render + intake wizard smoke tests.
 *
 * Follows the Resumen.test.jsx recipe: Firestore is faked (installFirebaseMocks)
 * and the screen mounts over the REAL hooks (useFinanceLedger, useInvoiceDocuments,
 * usePayables/useReceivables). Only two leaf modules are replaced: PDF text
 * extraction (needs the pdfjs worker, unavailable in jsdom) and the invoice
 * archive HTTP client (needs a real network stack) — everything else, including
 * the real PDF header parser and the real accounting invariants in
 * src/finance/invoiceArchive.js, runs unmocked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { installFirebaseMocks, TEST_USER } from '@/test/firebaseMock';
import {
  invoiceDocumentFixture,
  ledgerFixtures,
  payableFixture,
  receivableFixture,
} from '@/test/fixtures';

const FILE_HASH = 'f'.repeat(64);

const INVOICE_TEXT = [
  'Kabel Service GmbH',
  'Musterstraße 1',
  '12345 Musterstadt',
  '',
  'Rechnungsnummer: RE-2026-777',
  'Rechnungsdatum: 15.01.2026',
  '',
  'Nettobetrag: 1.000,00 €',
  'MwSt 19%: 190,00 €',
  'Gesamtbetrag: 1.190,00 €',
].join('\n');

const payableCandidate = payableFixture({
  id: 'cxp-1',
  sourceSystem: 'ordinary',
  counterpartyName: 'Kabel Service GmbH',
});
const receivableCandidateA = receivableFixture({
  id: 'cxc-1',
  sourceSystem: 'insyte',
  numeroPresupuesto: '00123',
  counterpartyName: 'Insyte Deutschland',
});
const receivableCandidateB = receivableFixture({
  id: 'cxc-2',
  sourceSystem: 'insyte',
  numeroPresupuesto: '00124',
  counterpartyName: 'Insyte Deutschland',
});

const incomingDoc = invoiceDocumentFixture({
  direction: 'incoming',
  family: 'payable',
  sourceSystem: 'ordinary',
  counterpartyName: 'Kabel Service GmbH',
  invoiceNumber: 'RE-2026-050',
  grossAmount: 1190,
  netAmount: 1000,
  taxAmount: 190,
  links: [{ family: 'payable', recordId: 'cxp-1' }],
});
const outgoingDoc = invoiceDocumentFixture({
  direction: 'outgoing',
  family: 'receivable',
  sourceSystem: 'insyte',
  counterpartyName: 'Insyte Deutschland',
  invoiceNumber: '',
  grossAmount: 5000,
  netAmount: 4200,
  taxAmount: 800,
  links: [
    { family: 'receivable', recordId: 'cxc-1' },
    { family: 'receivable', recordId: 'cxc-2' },
  ],
});

const baseFixtures = () =>
  ledgerFixtures({
    collections: {
      invoiceDocuments: [incomingDoc, outgoingDoc],
      payables: [payableCandidate],
      receivables: [receivableCandidateA, receivableCandidateB],
    },
  });

const store = installFirebaseMocks(baseFixtures());

const extractPdfTextMock = vi.fn(async () => ({ text: INVOICE_TEXT, pageCount: 1, hash: FILE_HASH }));
vi.doMock('@/lib/pdf/extractPdfText', () => ({ extractPdfText: extractPdfTextMock }));

vi.doMock('./lib/invoiceArchiveApi', async () => {
  const actual = await vi.importActual('./lib/invoiceArchiveApi');
  return {
    ...actual,
    uploadInvoicePdf: vi.fn(async ({ expectedSha256 }) => ({
      sha256: expectedSha256,
      sizeBytes: 4,
      mimeType: 'application/pdf',
    })),
    fetchInvoicePdf: vi.fn(async () => new Blob(['%PDF'], { type: 'application/pdf' })),
  };
});

const { renderScreen } = await import('@/test/renderScreen.jsx');
const { default: Facturas } = await import('./Facturas.jsx');
const { addDoc, writeBatch } = await import('firebase/firestore');
const { uploadInvoicePdf, fetchInvoicePdf, InvoiceArchiveError } = await import('./lib/invoiceArchiveApi');

const mountFacturas = () =>
  renderScreen(<Facturas user={TEST_USER} />, { route: '/facturas', path: '/facturas' });

const pdfFile = (name = 'factura.pdf') =>
  new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], name, { type: 'application/pdf' });

beforeEach(() => {
  const pristine = baseFixtures();
  Object.assign(store.collections, pristine.collections);
  Object.assign(store.documents, pristine.documents);
  store.errors = {};

  addDoc.mockClear();
  writeBatch.mockClear();
  uploadInvoicePdf.mockClear();
  fetchInvoicePdf.mockClear();
  extractPdfTextMock.mockClear();

  URL.createObjectURL = vi.fn(() => 'blob:mock-url');
  URL.revokeObjectURL = vi.fn();
});

describe('Facturas — archive list', () => {
  it('renders the header and the chart caption', () => {
    mountFacturas();

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Facturas');
    expect(screen.getByText('Últimos 12 meses · facturado vs. cobrado vs. pagado')).toBeInTheDocument();
  });

  it('lists both archived documents with counterparty, number and formatted gross', () => {
    mountFacturas();

    expect(screen.getByText('Kabel Service GmbH')).toBeInTheDocument();
    expect(screen.getByText('RE-2026-050')).toBeInTheDocument();
    expect(screen.getByText('1.190,00')).toBeInTheDocument();
    expect(screen.getByText('Insyte Deutschland')).toBeInTheDocument();
    expect(screen.getByText('5.000,00')).toBeInTheDocument();
  });

  it('filters by the CXP chip and narrows further by search', () => {
    mountFacturas();

    fireEvent.click(screen.getByRole('button', { name: 'CXP' }));
    expect(screen.getByText('Kabel Service GmbH')).toBeInTheDocument();
    expect(screen.queryByText('Insyte Deutschland')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Todas' }));
    fireEvent.change(screen.getByLabelText('Buscar factura archivada'), {
      target: { value: 'RE-2026-050' },
    });
    expect(screen.getByText('Kabel Service GmbH')).toBeInTheDocument();
    expect(screen.queryByText('Insyte Deutschland')).not.toBeInTheDocument();
  });

  it('fetches and renders the selected invoice PDF, then revokes the object URL on close', async () => {
    mountFacturas();

    fireEvent.click(screen.getByText('Kabel Service GmbH'));

    await screen.findByTitle(`Factura ${incomingDoc.invoiceNumber}`);
    expect(fetchInvoicePdf).toHaveBeenCalledWith(expect.objectContaining({ sha256: incomingDoc.id }));
    expect(URL.createObjectURL).toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
  });
});

describe('Facturas — intake wizard', () => {
  it('opens the intake panel and prefills the confirm form from the extracted PDF text', async () => {
    mountFacturas();

    fireEvent.click(screen.getByRole('button', { name: 'Nueva factura' }));
    fireEvent.change(screen.getByLabelText('PDF de la factura'), { target: { files: [pdfFile()] } });

    expect(extractPdfTextMock).toHaveBeenCalled();

    const invoiceNumberInput = await screen.findByLabelText('Nº de factura');
    expect(invoiceNumberInput).toHaveValue('RE-2026-777');
    expect(screen.getByLabelText('Fecha')).toHaveValue('2026-01-15');
    expect(screen.getByLabelText('Bruto')).toHaveValue(1190);
  });

  it('archives with create-ordinary: uploads, creates the payable and writes one linked invoiceDocuments doc', async () => {
    mountFacturas();

    fireEvent.click(screen.getByRole('button', { name: 'Nueva factura' }));
    fireEvent.change(screen.getByLabelText('PDF de la factura'), { target: { files: [pdfFile()] } });
    await screen.findByLabelText('Nº de factura');

    fireEvent.click(screen.getByRole('button', { name: 'Archivar factura' }));
    await screen.findByText('Factura archivada correctamente.');

    expect(uploadInvoicePdf).toHaveBeenCalledWith(expect.objectContaining({ expectedSha256: FILE_HASH }));

    const payableCall = addDoc.mock.calls.find(([ref]) => String(ref?.path ?? '').endsWith('/payables'));
    expect(payableCall).toBeTruthy();
    expect(payableCall[1]).toMatchObject({ vendor: 'Kabel Service GmbH', invoiceNumber: 'RE-2026-777' });

    expect(writeBatch).toHaveBeenCalledTimes(1);
    const batch = writeBatch.mock.results.at(-1).value;

    expect(batch.set).toHaveBeenCalledTimes(1);
    const [documentRef, documentData] = batch.set.mock.calls[0];
    expect(documentRef.path).toContain(`invoiceDocuments/${FILE_HASH}`);
    expect(documentData).toMatchObject({ sha256: FILE_HASH, direction: 'incoming' });
    expect(documentData.links).toHaveLength(1);

    expect(batch.update).toHaveBeenCalledTimes(1);
    const [linkRef] = batch.update.mock.calls[0];
    expect(linkRef.path).toContain('/payables/');
  });

  it('shows the Spanish message and writes nothing when net + tax does not match gross', async () => {
    mountFacturas();

    fireEvent.click(screen.getByRole('button', { name: 'Nueva factura' }));
    fireEvent.change(screen.getByLabelText('PDF de la factura'), { target: { files: [pdfFile()] } });
    await screen.findByLabelText('Nº de factura');

    // Break the header invariant checked by validateConfirmedInvoice
    // (src/finance/invoiceArchive.js): net (1000) + tax (190) must equal
    // gross within one cent. This core throws in English; the panel must
    // translate it via translateValidationMessage before showing it.
    fireEvent.change(screen.getByLabelText('Bruto'), { target: { value: '500' } });

    fireEvent.click(screen.getByRole('button', { name: 'Archivar factura' }));
    await screen.findByText('Los totales de la factura no cuadran');

    expect(uploadInvoicePdf).not.toHaveBeenCalled();
    expect(writeBatch).not.toHaveBeenCalled();
  });

  it('shows the Spanish message and writes nothing when the upload is rejected with access-denied', async () => {
    uploadInvoicePdf.mockRejectedValueOnce(new InvoiceArchiveError('access-denied'));
    mountFacturas();

    fireEvent.click(screen.getByRole('button', { name: 'Nueva factura' }));
    fireEvent.change(screen.getByLabelText('PDF de la factura'), { target: { files: [pdfFile()] } });
    await screen.findByLabelText('Nº de factura');

    fireEvent.click(screen.getByRole('button', { name: 'Archivar factura' }));
    await screen.findByText('No tienes acceso al archivo de facturas.');

    expect(writeBatch).not.toHaveBeenCalled();
    const payableCall = addDoc.mock.calls.find(([ref]) => String(ref?.path ?? '').endsWith('/payables'));
    expect(payableCall).toBeUndefined();
  });
});
