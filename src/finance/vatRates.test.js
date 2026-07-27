/**
 * VAT rate resolution — the boundary between what the bank moved (gross) and
 * what a project actually cost (net).
 *
 * The rule this file guards: an unknown rate is 0, never 19%. A guessed 19%
 * once invented 317k € of VAT across the ledger, including on taxes, insurance
 * and salaries, which carry no German VAT at all.
 */
import { describe, expect, it } from 'vitest';
import { adaptBankMovementDoc, adaptPayableDoc } from './adapters';
import {
  DEFAULT_CATEGORY_VAT_RATES,
  VAT_RATE_SOURCE,
  categoriesMissingVatRate,
  createNetAmountResolver,
  isValidVatRate,
  netFromGross,
  resolveVatRate,
  vatFromGross,
} from './vatRates';

const ZERO_RATED = [
  'Impuestos',
  'Impuestos Vehiculos',
  'Intereses Bancos',
  'Intereses prestamos',
  'Salarios',
  'Seguros',
  'Financiero',
];

// Live categories (src/constants/categories.js) that German law does not settle
// on its own — Subcontratos in particular depends on §13b reverse charge.
const DELIBERATELY_UNCONFIGURED = [
  'Administrativo',
  'Alquiler vehiculo',
  'Combustible',
  'Cuotas vehiculos',
  'Equipos',
  'Equipos Alquileres',
  'Facturas Telefonos',
  'Materiales',
  'Miscelaneos Oficina',
  'Otros',
  'Reparaciones',
  'Subcontratos',
  'Transporte/Combustible',
  'Vehiculos',
  'Vivienda',
  'Consultoria',
  'Por Venta',
  'Servicios',
  'SP',
];

describe('DEFAULT_CATEGORY_VAT_RATES', () => {
  it('zero-rates only the categories German law does not debate', () => {
    expect(Object.keys(DEFAULT_CATEGORY_VAT_RATES).sort()).toEqual([...ZERO_RATED].sort());
    ZERO_RATED.forEach((name) => {
      expect(DEFAULT_CATEGORY_VAT_RATES[name]).toBe(0);
    });
  });

  it('leaves every debatable category unconfigured rather than guessing', () => {
    DELIBERATELY_UNCONFIGURED.forEach((name) => {
      expect(DEFAULT_CATEGORY_VAT_RATES).not.toHaveProperty(name);
    });
  });

  it('never ships a guessed 19% for any category', () => {
    expect(Object.values(DEFAULT_CATEGORY_VAT_RATES)).not.toContain(0.19);
  });
});

describe('isValidVatRate', () => {
  it('accepts finite numbers inside [0, 1]', () => {
    [0, 0.07, 0.19, 1].forEach((rate) => expect(isValidVatRate(rate)).toBe(true));
  });

  it('rejects percentages, out-of-range values and non-numbers', () => {
    [19, 7, -0.01, 1.01, NaN, Infinity, '0.19', '', null, undefined, true, {}].forEach((value) =>
      expect(isValidVatRate(value)).toBe(false),
    );
  });
});

describe('resolveVatRate', () => {
  const categoryRates = { ...DEFAULT_CATEGORY_VAT_RATES, Materiales: 0.19 };

  it('prefers an explicit rate stored on the movement', () => {
    const movement = adaptBankMovementDoc({
      id: 'mov-1',
      amount: 1190,
      direction: 'out',
      categoryName: 'Materiales',
      taxRate: 0.07,
    });

    expect(resolveVatRate({ movement, categoryRates })).toEqual({
      rate: 0.07,
      source: VAT_RATE_SOURCE.MOVEMENT,
    });
  });

  it('does not read the adapter default 0 as an explicit movement rate', () => {
    // adaptBankMovementDoc materializes taxRate: 0 for every imported row (the
    // Volksbank statement has no VAT column). Treating that as "explicitly 0"
    // would shadow the category rate on the entire ledger.
    const movement = adaptBankMovementDoc({
      id: 'mov-2',
      amount: 1190,
      direction: 'out',
      categoryName: 'Materiales',
    });

    expect(movement.taxRate).toBe(0);
    expect(resolveVatRate({ movement, categoryRates })).toEqual({
      rate: 0.19,
      source: VAT_RATE_SOURCE.CATEGORY,
    });
  });

  it('falls back to the linked CXP/CXC document rate', () => {
    const movement = adaptBankMovementDoc({
      id: 'mov-3',
      amount: 1190,
      direction: 'out',
      categoryName: 'Materiales',
    });
    const linkedDocument = adaptPayableDoc({ id: 'cxp-1', amount: 1190, taxRate: 0.07 });

    expect(resolveVatRate({ movement, linkedDocument, categoryRates })).toEqual({
      rate: 0.07,
      source: VAT_RATE_SOURCE.DOCUMENT,
    });
  });

  it('falls back to the category rate when neither carries one', () => {
    const movement = { categoryName: 'Salarios' };

    expect(resolveVatRate({ movement, categoryRates })).toEqual({
      rate: 0,
      source: VAT_RATE_SOURCE.CATEGORY,
    });
  });

  it('reports an unconfigured category as unset, distinct from a deliberate 0', () => {
    const configured = resolveVatRate({ movement: { categoryName: 'Seguros' }, categoryRates });
    const unconfigured = resolveVatRate({ movement: { categoryName: 'Subcontratos' }, categoryRates });

    expect(configured).toEqual({ rate: 0, source: VAT_RATE_SOURCE.CATEGORY });
    expect(unconfigured).toEqual({ rate: 0, source: VAT_RATE_SOURCE.UNSET });
  });

  it('resolves to unset for a movement with no category at all', () => {
    expect(resolveVatRate({ movement: { categoryName: '' }, categoryRates })).toEqual({
      rate: 0,
      source: VAT_RATE_SOURCE.UNSET,
    });
    expect(resolveVatRate({})).toEqual({ rate: 0, source: VAT_RATE_SOURCE.UNSET });
  });

  it('reads the legacy `category` key when `categoryName` is absent', () => {
    expect(resolveVatRate({ movement: { category: 'Impuestos' }, categoryRates })).toEqual({
      rate: 0,
      source: VAT_RATE_SOURCE.CATEGORY,
    });
  });

  it('ignores an out-of-range stored rate instead of trusting it', () => {
    const movement = { categoryName: 'Materiales', taxRate: 19 };

    expect(resolveVatRate({ movement, categoryRates })).toEqual({
      rate: 0.19,
      source: VAT_RATE_SOURCE.CATEGORY,
    });
  });
});

describe('netFromGross / vatFromGross', () => {
  it('splits a gross amount at the given rate', () => {
    expect(netFromGross(119, 0.19)).toBe(100);
    expect(vatFromGross(119, 0.19)).toBe(19);
  });

  it('returns the gross untouched at rate 0', () => {
    expect(netFromGross(1000, 0)).toBe(1000);
    expect(vatFromGross(1000, 0)).toBe(0);
  });

  it('treats a missing rate as 0, never as the 19% default of the formatters', () => {
    expect(netFromGross(1190, undefined)).toBe(1190);
    expect(netFromGross(1190, null)).toBe(1190);
    expect(vatFromGross(1190, undefined)).toBe(0);
  });

  it('rounds to cents so 119/1.19 does not leak 99.99999', () => {
    expect(netFromGross(119, 0.19)).not.toBeCloseTo(99.99999, 5);
    expect(netFromGross(100, 0.19)).toBe(84.03);
  });

  it('handles unusable gross amounts without producing NaN', () => {
    expect(netFromGross(undefined, 0.19)).toBe(0);
    expect(vatFromGross('abc', 0.19)).toBe(0);
  });
});

describe('createNetAmountResolver', () => {
  const categoryRates = { Materiales: 0.19, Salarios: 0 };

  it('nets a movement against its category rate', () => {
    const netOf = createNetAmountResolver({ categoryRates });

    expect(netOf(adaptBankMovementDoc({ id: 'm', amount: 1190, categoryName: 'Materiales' }))).toBe(1000);
  });

  it('prefers the rate on the CXP document the movement is reconciled against', () => {
    const payable = adaptPayableDoc({ id: 'cxp-9', amount: 1070, taxRate: 0.07 });
    const netOf = createNetAmountResolver({ categoryRates, documents: [payable] });
    const movement = adaptBankMovementDoc({
      id: 'm',
      amount: 1070,
      categoryName: 'Materiales',
      payableId: 'cxp-9',
    });

    expect(netOf(movement)).toBe(1000);
  });

  it('resolves a receivable link the same way', () => {
    const receivable = { id: 'cxc-3', taxRate: 0.07 };
    const netOf = createNetAmountResolver({ categoryRates, documents: [receivable] });

    expect(netOf({ amount: 1070, categoryName: 'Materiales', receivableId: 'cxc-3' })).toBe(1000);
  });

  it('leaves an unconfigured category at gross', () => {
    const netOf = createNetAmountResolver({ categoryRates });

    expect(netOf({ amount: 1190, categoryName: 'Subcontratos' })).toBe(1190);
  });

  it('survives missing arguments, documents without ids and absent movements', () => {
    const netOf = createNetAmountResolver();

    expect(netOf({ amount: 1190, categoryName: 'Materiales' })).toBe(1190);
    expect(netOf(null)).toBe(0);
    expect(createNetAmountResolver({ documents: [null, {}] })({ amount: 500 })).toBe(500);
  });
});

describe('categoriesMissingVatRate', () => {
  it('lists the categories the settings screen must nag about', () => {
    const categories = ['Salarios', 'Subcontratos', 'Materiales', 'Seguros'];

    expect(categoriesMissingVatRate(categories, DEFAULT_CATEGORY_VAT_RATES)).toEqual([
      'Subcontratos',
      'Materiales',
    ]);
  });

  it('treats an explicit 0 as configured', () => {
    expect(categoriesMissingVatRate(['Subcontratos'], { Subcontratos: 0 })).toEqual([]);
  });

  it('treats an invalid stored value as still missing', () => {
    expect(categoriesMissingVatRate(['Subcontratos'], { Subcontratos: 19 })).toEqual(['Subcontratos']);
    expect(categoriesMissingVatRate(['Subcontratos'], { Subcontratos: '0.19' })).toEqual(['Subcontratos']);
  });

  it('deduplicates names shared by the expense and income lists', () => {
    expect(categoriesMissingVatRate(['Otros', 'Otros'], {})).toEqual(['Otros']);
  });

  it('tolerates missing arguments and blank entries', () => {
    expect(categoriesMissingVatRate()).toEqual([]);
    expect(categoriesMissingVatRate(['', '  ', null], {})).toEqual([]);
  });
});
