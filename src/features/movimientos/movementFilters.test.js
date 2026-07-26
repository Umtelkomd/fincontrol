import { describe, expect, it } from 'vitest';

import { DEFAULT_MOVEMENT_FILTERS, filterMovements } from './movementFilters.js';

const idsOf = (movements) => movements.map((movement) => movement.id);

const MOVEMENTS = [
  {
    id: 'in-classified',
    postedDate: '2026-03-10',
    direction: 'in',
    amount: 900,
    description: 'Abono Insyte',
    counterpartyName: 'Insyte Deutschland',
    categoryName: 'Ventas',
  },
  {
    id: 'out-overhead',
    postedDate: '2026-05-04',
    direction: 'out',
    amount: 259.01,
    description: 'Steuer',
    counterpartyName: 'Finanzkasse Stralsund',
    categoryName: 'Impuestos',
    costScope: 'overhead',
  },
  {
    id: 'out-cost-center-only',
    postedDate: '2026-05-06',
    direction: 'out',
    amount: 120,
    description: 'Diesel',
    counterpartyName: 'Union Tank Eckstein',
    costCenterId: 'CC-FLOTA',
  },
  {
    id: 'out-reconciled',
    postedDate: '2026-06-01',
    direction: 'out',
    amount: 500,
    description: 'Pago proveedor',
    counterpartyName: 'RCI Banque',
    categoryName: 'Leasing',
    costScope: 'overhead',
    payableId: 'pay-1',
  },
  {
    id: 'out-void',
    postedDate: '2026-06-02',
    direction: 'out',
    amount: 77,
    description: 'Duplicado',
    counterpartyName: 'AOK',
    status: 'void',
  },
];

describe('filterMovements — defaults', () => {
  it('returns every non-void movement sorted by date descending', () => {
    expect(idsOf(filterMovements(MOVEMENTS, DEFAULT_MOVEMENT_FILTERS))).toEqual([
      'out-reconciled',
      'out-cost-center-only',
      'out-overhead',
      'in-classified',
    ]);
  });

  it('tolerates missing input', () => {
    expect(filterMovements(null, DEFAULT_MOVEMENT_FILTERS)).toEqual([]);
    expect(idsOf(filterMovements(MOVEMENTS, null))).toHaveLength(4);
  });

  it('does not mutate the source array', () => {
    const source = [...MOVEMENTS];
    filterMovements(source, DEFAULT_MOVEMENT_FILTERS);
    expect(source).toEqual(MOVEMENTS);
  });
});

describe('filterMovements — period and direction', () => {
  it('filters by year', () => {
    expect(idsOf(filterMovements(MOVEMENTS, { ...DEFAULT_MOVEMENT_FILTERS, year: '2025' }))).toEqual([]);
  });

  it('filters by month, zero-padding single digits', () => {
    expect(idsOf(filterMovements(MOVEMENTS, { ...DEFAULT_MOVEMENT_FILTERS, month: '3' }))).toEqual([
      'in-classified',
    ]);
  });

  it('filters by direction', () => {
    expect(idsOf(filterMovements(MOVEMENTS, { ...DEFAULT_MOVEMENT_FILTERS, direction: 'in' }))).toEqual([
      'in-classified',
    ]);
  });
});

/**
 * The status filter is the reason the ledger looked healthier than it was: a
 * movement carrying only a cost center used to count as classified.
 */
describe('filterMovements — classification status', () => {
  it('treats a movement with only a cost center as unclassified', () => {
    expect(
      idsOf(filterMovements(MOVEMENTS, { ...DEFAULT_MOVEMENT_FILTERS, statusFilter: 'unclassified' })),
    ).toEqual(['out-cost-center-only']);
  });

  it('keeps only genuinely classified movements', () => {
    expect(
      idsOf(filterMovements(MOVEMENTS, { ...DEFAULT_MOVEMENT_FILTERS, statusFilter: 'classified' })),
    ).toEqual(['out-reconciled', 'out-overhead', 'in-classified']);
  });

  it('filters reconciled movements', () => {
    expect(
      idsOf(filterMovements(MOVEMENTS, { ...DEFAULT_MOVEMENT_FILTERS, statusFilter: 'reconciled' })),
    ).toEqual(['out-reconciled']);
  });

  it('shows void movements only under the void filter', () => {
    expect(idsOf(filterMovements(MOVEMENTS, { ...DEFAULT_MOVEMENT_FILTERS, statusFilter: 'void' }))).toEqual([
      'out-void',
    ]);
  });
});

describe('filterMovements — search', () => {
  it('matches the counterparty case-insensitively', () => {
    expect(
      idsOf(filterMovements(MOVEMENTS, { ...DEFAULT_MOVEMENT_FILTERS, searchQuery: 'finanzkasse' })),
    ).toEqual(['out-overhead']);
  });

  it('matches the category and the amount', () => {
    expect(idsOf(filterMovements(MOVEMENTS, { ...DEFAULT_MOVEMENT_FILTERS, searchQuery: 'leasing' }))).toEqual([
      'out-reconciled',
    ]);
    expect(idsOf(filterMovements(MOVEMENTS, { ...DEFAULT_MOVEMENT_FILTERS, searchQuery: '120' }))).toEqual([
      'out-cost-center-only',
    ]);
  });

  it('ignores surrounding whitespace', () => {
    expect(idsOf(filterMovements(MOVEMENTS, { ...DEFAULT_MOVEMENT_FILTERS, searchQuery: '  diesel  ' }))).toEqual(
      ['out-cost-center-only'],
    );
  });
});
