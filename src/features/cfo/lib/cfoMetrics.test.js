import { describe, expect, it } from 'vitest';

import {
  getOpenAmount,
  isOverdue,
  summarizeBankMovements,
  summarizeCFOOrder,
  summarizeDataQuality,
  summarizePayables,
  summarizeReceivables,
  toNumber,
} from './cfoMetrics.js';

const receivable = (overrides = {}) => ({
  id: overrides.id || 'r1',
  counterpartyName: 'Cliente',
  documentNumber: 'R-1',
  grossAmount: 100,
  openAmount: 100,
  status: 'issued',
  dueDate: '2026-04-01',
  ...overrides,
});

const payable = (overrides = {}) => ({
  id: overrides.id || 'p1',
  counterpartyName: 'Proveedor',
  documentNumber: 'P-1',
  grossAmount: 100,
  openAmount: 100,
  status: 'issued',
  dueDate: '2026-04-01',
  ...overrides,
});

const movement = (postedDate, direction, amount, overrides = {}) => ({
  id: `${postedDate}-${direction}-${amount}`,
  postedDate,
  direction,
  amount,
  status: 'posted',
  categoryName: 'Ventas',
  ...overrides,
});

describe('toNumber', () => {
  it('parses numbers and localized numeric strings safely', () => {
    expect(toNumber(12.3)).toBe(12.3);
    expect(toNumber('1.234,56')).toBe(1234.56);
    expect(toNumber('1234.56')).toBe(1234.56);
    expect(toNumber('x')).toBe(0);
  });
});

describe('getOpenAmount', () => {
  it('uses openAmount first', () => {
    expect(getOpenAmount({ amount: 100, paidAmount: 90, openAmount: 25 })).toBe(25);
  });

  it('uses pendingAmount when openAmount is absent', () => {
    expect(getOpenAmount({ amount: 100, pendingAmount: 40 })).toBe(40);
  });

  it('uses amount minus paidAmount', () => {
    expect(getOpenAmount({ amount: 100, paidAmount: 35 })).toBe(65);
  });

  it('returns zero for closed records without explicit open amount', () => {
    expect(getOpenAmount({ amount: 100, status: 'settled' })).toBe(0);
  });
});

describe('isOverdue', () => {
  it('requires an open amount and due date before asOfDate', () => {
    expect(isOverdue(receivable({ dueDate: '2026-04-01' }), '2026-04-10')).toBe(true);
    expect(isOverdue(receivable({ dueDate: '2026-04-20' }), '2026-04-10')).toBe(false);
    expect(isOverdue(receivable({ status: 'settled', openAmount: 100 }), '2026-04-10')).toBe(false);
  });
});

describe('summarizeReceivables', () => {
  it('computes gross, open, overdue and top open rows', () => {
    const out = summarizeReceivables(
      [
        receivable({ id: 'r1', grossAmount: 100, openAmount: 50, dueDate: '2026-04-01' }),
        receivable({ id: 'r2', grossAmount: 200, openAmount: 0, status: 'settled' }),
        receivable({ id: 'r3', grossAmount: 300, pendingAmount: 30, openAmount: undefined, dueDate: '2026-05-01' }),
      ],
      '2026-04-15',
    );

    expect(out.count).toBe(3);
    expect(out.grossTotal).toBe(600);
    expect(out.openTotal).toBe(80);
    expect(out.overdueTotal).toBe(50);
    expect(out.overdueCount).toBe(1);
    expect(out.topOpen.map((row) => row.id)).toEqual(['r1', 'r3']);
    expect(out.byStatus.issued).toBe(2);
    expect(out.byStatus.settled).toBe(1);
  });
});

describe('summarizePayables', () => {
  it('sorts top urgent by overdue, due date, then amount', () => {
    const out = summarizePayables(
      [
        payable({ id: 'future-big', openAmount: 1000, dueDate: '2026-05-01' }),
        payable({ id: 'overdue-late', openAmount: 100, dueDate: '2026-04-05' }),
        payable({ id: 'overdue-early-small', openAmount: 10, dueDate: '2026-04-01' }),
        payable({ id: 'overdue-early-big', openAmount: 50, dueDate: '2026-04-01' }),
      ],
      '2026-04-10',
    );

    expect(out.openTotal).toBe(1160);
    expect(out.overdueTotal).toBe(160);
    expect(out.overdueCount).toBe(3);
    expect(out.topUrgent.map((row) => row.id)).toEqual([
      'overdue-early-big',
      'overdue-early-small',
      'overdue-late',
      'future-big',
    ]);
  });
});

describe('summarizeBankMovements', () => {
  it('computes 30d and 90d inflow, outflow, net and monthly net', () => {
    const out = summarizeBankMovements(
      [
        movement('2026-04-25', 'in', 1000),
        movement('2026-04-20', 'out', 200),
        movement('2026-03-01', 'out', 300),
        movement('2026-01-01', 'in', 999),
        movement('2026-04-10', 'out', 500, { status: 'void' }),
      ],
      '2026-04-30',
    );

    expect(out.totalIn30).toBe(1000);
    expect(out.totalOut30).toBe(200);
    expect(out.net30).toBe(800);
    expect(out.totalIn90).toBe(1000);
    expect(out.totalOut90).toBe(500);
    expect(out.net90).toBe(500);
    expect(out.monthlyNet).toEqual({
      '2026-01': 999,
      '2026-03': -300,
      '2026-04': 800,
    });
  });
});

describe('summarizeDataQuality', () => {
  it('warns for empty source collections and weak references', () => {
    const out = summarizeDataQuality({
      transactions: [],
      recurringCosts: [],
      projects: [{ id: 'p1', name: 'NE3' }],
      budgets: [],
      bankMovements: [
        movement('2026-04-25', 'in', 100, { categoryName: '', projectId: 'missing' }),
      ],
      receivables: [receivable({ projectId: 'p1' })],
      payables: [payable({ projectName: 'Unknown Project' })],
    });

    expect(out.warnings.map((warning) => warning.id)).toEqual([
      'transactions-empty',
      'recurring-costs-empty',
      'bank-movements-uncategorized',
      'unknown-project-refs',
      'budgets-insufficient',
    ]);
    expect(out.stats.uncategorizedBankMovements).toBe(1);
    expect(out.stats.unknownProjectRefs).toBe(2);
  });

  it('warns when bank movements share date, amount, direction, counterparty AND purpose', () => {
    const out = summarizeDataQuality({
      transactions: [{ id: 't1' }],
      recurringCosts: [{ id: 'rc1' }],
      projects: [],
      budgets: [{ id: 'b1' }],
      bankMovements: [
        movement('2026-04-25', 'in', 100, { id: 'm1', counterpartyName: 'ACME GmbH', purpose: 'SVWZ+Rechnung 42' }),
        movement('2026-04-25', 'in', 100, { id: 'm2', counterpartyName: 'acme gmbh ', purpose: 'svwz+rechnung 42' }),
        movement('2026-04-26', 'out', 50, { id: 'm3', counterpartyName: 'Otro', purpose: 'x' }),
      ],
      receivables: [],
      payables: [],
    });

    const warning = out.warnings.find((w) => w.id === 'bank-movements-duplicated');
    expect(warning).toBeDefined();
    expect(warning.variant).toBe('warn');
    expect(out.stats.duplicateBankMovements).toBe(1);
  });

  it('does NOT flag distinct same-day payments to the same counterparty (rent + loan case)', () => {
    const out = summarizeDataQuality({
      transactions: [{ id: 't1' }],
      recurringCosts: [{ id: 'rc1' }],
      projects: [],
      budgets: [{ id: 'b1' }],
      bankMovements: [
        movement('2026-06-05', 'out', 50, { id: 'm1', counterpartyName: 'Beatriz Sandoval', purpose: 'SVWZ+Bueromiete Juni' }),
        movement('2026-06-05', 'out', 50, { id: 'm2', counterpartyName: 'Beatriz Sandoval', purpose: 'SVWZ+Darlehn vom 12.06.2024' }),
      ],
      receivables: [],
      payables: [],
    });

    expect(out.warnings.find((w) => w.id === 'bank-movements-duplicated')).toBeUndefined();
    expect(out.stats.duplicateBankMovements).toBe(0);
  });

  it('does NOT flag installment series (same vendor+amount, no invoice, different dates)', () => {
    const out = summarizeDataQuality({
      transactions: [{ id: 't1' }],
      recurringCosts: [{ id: 'rc1' }],
      projects: [],
      budgets: [{ id: 'b1' }],
      bankMovements: [],
      receivables: [],
      payables: [
        payable({ id: 'p1', counterpartyName: 'Incerval', invoiceNumber: '', amount: 940, description: 'Sopladora', issueDate: '2026-04-30' }),
        payable({ id: 'p2', counterpartyName: 'Incerval', invoiceNumber: '', amount: 940, description: 'Sopladora', issueDate: '2026-05-29' }),
        payable({ id: 'p3', counterpartyName: 'Incerval', invoiceNumber: '', amount: 940, description: 'Sopladora', issueDate: '2026-06-29' }),
      ],
    });

    expect(out.warnings.find((w) => w.id === 'documents-duplicated')).toBeUndefined();
    expect(out.stats.duplicatePayables).toBe(0);
  });

  it('warns when CXC/CXP repeat vendor, invoice and amount', () => {
    const out = summarizeDataQuality({
      transactions: [{ id: 't1' }],
      recurringCosts: [{ id: 'rc1' }],
      projects: [],
      budgets: [{ id: 'b1' }],
      bankMovements: [],
      receivables: [
        receivable({ id: 'r1', counterpartyName: 'Cliente A', invoiceNumber: 'F-001', amount: 500 }),
        receivable({ id: 'r2', counterpartyName: 'Cliente A', invoiceNumber: 'F-001', amount: 500 }),
      ],
      payables: [
        payable({ id: 'p1', counterpartyName: 'Prov X', invoiceNumber: 'X-9', amount: 200 }),
        payable({ id: 'p2', counterpartyName: 'prov x', invoiceNumber: 'X-9', amount: 200 }),
        payable({ id: 'p3', counterpartyName: 'Prov Y', invoiceNumber: 'Y-1', amount: 300 }),
      ],
    });

    const warning = out.warnings.find((w) => w.id === 'documents-duplicated');
    expect(warning).toBeDefined();
    expect(out.stats.duplicateReceivables).toBe(1);
    expect(out.stats.duplicatePayables).toBe(1);
  });

  it('does not emit duplicate warnings on clean data', () => {
    const out = summarizeDataQuality({
      transactions: [{ id: 't1' }],
      recurringCosts: [{ id: 'rc1' }],
      projects: [],
      budgets: [{ id: 'b1' }],
      bankMovements: [
        movement('2026-04-25', 'in', 100, { id: 'm1', counterpartyName: 'A' }),
        movement('2026-04-26', 'in', 100, { id: 'm2', counterpartyName: 'A' }),
      ],
      receivables: [],
      payables: [],
    });

    expect(out.warnings.find((w) => w.id === 'bank-movements-duplicated')).toBeUndefined();
    expect(out.warnings.find((w) => w.id === 'documents-duplicated')).toBeUndefined();
    expect(out.stats.duplicateBankMovements).toBe(0);
  });
});

describe('summarizeCFOOrder', () => {
  it('returns the panel-ready CFO order shape', () => {
    const out = summarizeCFOOrder(
      {
        bankAccount: {
          bankName: 'Volksbank',
          balance: 1000,
          balanceDate: '2026-04-01',
          creditLineLimit: -40000,
        },
        bankMovements: [movement('2026-04-10', 'in', 500)],
        receivables: [receivable({ openAmount: 100 })],
        payables: [payable({ openAmount: 50 })],
        transactions: [],
        recurringCosts: [],
        projects: [],
        budgets: [],
      },
      { asOfDate: '2026-04-30' },
    );

    expect(out.asOfDate).toBe('2026-04-30');
    expect(out.cash.cashToday).toBe(1500);
    expect(out.cash.bankName).toBe('Volksbank');
    expect(out.receivables.openTotal).toBe(100);
    expect(out.payables.openTotal).toBe(50);
    expect(out.bankMovements.net30).toBe(500);
    expect(out.dataQuality.warnings.length).toBeGreaterThan(0);
  });
});
