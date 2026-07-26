import { describe, expect, it } from 'vitest';

import { buildInitialFormData } from './canonicalRecordForm.js';

/**
 * `categoryLabel` is a DISPLAY label (kind of record, e.g. "payment",
 * "Factura CXP", "Registro histórico"). Seeding the editable `categoryName`
 * field from it silently persisted those labels as real categories on save,
 * which marked uncategorized rows as classified and polluted budget actuals.
 */
describe('buildInitialFormData — category seed', () => {
  it('leaves the category empty for an uncategorized bank movement', () => {
    const record = {
      recordFamily: 'movement',
      // Movimientos seeds this from the movement `kind` family label.
      categoryLabel: 'payment',
      date: '2026-05-08',
      rawRecord: { direction: 'out', postedDate: '2026-05-08', categoryName: '' },
    };

    expect(buildInitialFormData(record).categoryName).toBe('');
  });

  it('keeps the stored category of a classified bank movement', () => {
    const record = {
      recordFamily: 'movement',
      categoryLabel: 'Material',
      rawRecord: { direction: 'out', categoryName: 'Material' },
    };

    expect(buildInitialFormData(record).categoryName).toBe('Material');
  });

  it('never seeds the category from an order display label', () => {
    const receivable = {
      recordFamily: 'receivable',
      categoryLabel: 'Factura CXC',
      rawRecord: { direction: 'in' },
    };
    const payable = {
      recordFamily: 'payable',
      categoryLabel: 'Factura CXP',
      rawRecord: { direction: 'out' },
    };

    expect(buildInitialFormData(receivable).categoryName).toBe('');
    expect(buildInitialFormData(payable).categoryName).toBe('');
  });

  it('reads the legacy `category` field when the record has no canonical categoryName', () => {
    const record = {
      recordFamily: 'legacy',
      categoryLabel: 'Alquiler',
      rawRecord: { category: 'Alquiler' },
    };

    expect(buildInitialFormData(record).categoryName).toBe('Alquiler');
  });

  it('leaves the category empty for a legacy record with no category at all', () => {
    const record = {
      recordFamily: 'legacy',
      categoryLabel: 'Registro histórico',
      rawRecord: {},
    };

    expect(buildInitialFormData(record).categoryName).toBe('');
  });

  it('keeps seeding every other field from the record', () => {
    const record = {
      recordFamily: 'movement',
      amount: 120.5,
      date: '2026-05-08',
      rawRecord: {
        direction: 'out',
        postedDate: '2026-05-08',
        description: 'Pago proveedor',
        counterpartyName: 'Supplier GmbH',
        documentNumber: 'RE-1',
        projectId: 'proj-1',
        costCenterId: 'CC1',
      },
    };

    expect(buildInitialFormData(record)).toMatchObject({
      direction: 'out',
      amount: '120.5',
      postedDate: '2026-05-08',
      description: 'Pago proveedor',
      counterpartyName: 'Supplier GmbH',
      documentNumber: 'RE-1',
      projectId: 'proj-1',
      costCenterId: 'CC1',
      forceStatus: '',
      correctionReason: '',
    });
  });
});
