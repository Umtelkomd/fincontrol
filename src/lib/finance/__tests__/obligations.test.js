import { describe, expect, it } from 'vitest';
import { buildObligationsCalendar } from '../obligations.js';

const payable = (dueDate, openAmount, extra = {}) => ({
  dueDate,
  openAmount,
  status: 'open',
  counterpartyName: 'Vendor X',
  ...extra,
});

const period = (month, extra = {}) => ({
  period: month,
  netWagesTotal: 21000,
  socialTotal: 13000,
  taxTotal: 3000,
  cashTotal: 37000,
  employerCostTotal: 39000,
  employeeCount: 12,
  status: 'pagada',
  ...extra,
});

const byKind = (calendar, kind) => calendar.filter((item) => item.kind === kind);

// ─── payables ──────────────────────────────────────────────────────────────────

describe('buildObligationsCalendar payables', () => {
  it('lists open payables inside the horizon and flags overdue ones', () => {
    const calendar = buildObligationsCalendar({
      payables: [
        payable('2026-03-01', 5000), // long overdue → still an obligation
        payable('2026-07-20', 1200),
        payable('2026-10-01', 800), // beyond the 60-day horizon
        payable('2026-07-20', 0.004), // dust
        payable('2026-07-20', 0), // settled
      ],
      payrollPeriods: [],
      vatEstimates: [],
      today: '2026-07-09',
    });
    const items = byKind(calendar, 'payable');
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      date: '2026-03-01',
      amount: 5000,
      overdue: true,
      estimated: false,
      source: 'payables',
      label: 'Vendor X',
    });
    expect(items[1]).toMatchObject({ date: '2026-07-20', amount: 1200, overdue: false });
  });

  it('treats a payable without a due date as due today', () => {
    const calendar = buildObligationsCalendar({
      payables: [payable(undefined, 300)],
      payrollPeriods: [],
      vatEstimates: [],
      today: '2026-07-09',
    });
    expect(byKind(calendar, 'payable')[0]).toMatchObject({ date: '2026-07-09', overdue: false });
  });
});

// ─── payroll-derived obligations (net wages, social security, wage tax) ───────

describe('buildObligationsCalendar payroll estimates', () => {
  const periods = [
    period('2026-04', { netWagesTotal: 21000, socialTotal: 13000, taxTotal: 3000 }),
    period('2026-05', { netWagesTotal: 23000, socialTotal: 15000, taxTotal: 4000 }),
  ];

  it('projects future due dates from the average of the latest periods', () => {
    const calendar = buildObligationsCalendar({
      payables: [],
      payrollPeriods: periods,
      vatEstimates: [],
      today: '2026-07-09',
      horizonDays: 60, // → horizon end 2026-09-07
    });

    expect(byKind(calendar, 'payroll-net').map((i) => [i.date, i.amount])).toEqual([
      ['2026-07-31', 22000],
      ['2026-08-31', 22000],
    ]);
    expect(byKind(calendar, 'social').map((i) => [i.date, i.amount])).toEqual([
      ['2026-07-29', 14000],
      ['2026-08-27', 14000],
    ]);
    // Wage tax for month M is due the 10th of M+1 → June's lands 2026-07-10.
    expect(byKind(calendar, 'wage-tax').map((i) => [i.date, i.month, i.amount])).toEqual([
      ['2026-07-10', '2026-06', 3500],
      ['2026-08-10', '2026-07', 3500],
    ]);
    for (const item of calendar) {
      expect(item.estimated).toBe(true);
      expect(item.source).toBe('payroll-average');
    }
  });

  it('skips net wages and social for a month whose payroll period is already paid', () => {
    const calendar = buildObligationsCalendar({
      payables: [],
      payrollPeriods: periods, // 2026-05 has status 'pagada'
      vatEstimates: [],
      today: '2026-05-20',
      horizonDays: 45, // → horizon end 2026-07-04
    });

    // May net wages (2026-05-29) and May SV (2026-05-27) are paid → skipped.
    expect(byKind(calendar, 'payroll-net').map((i) => i.date)).toEqual(['2026-06-30']);
    expect(byKind(calendar, 'social').map((i) => i.date)).toEqual(['2026-06-26']);
    // Wage tax is due the FOLLOWING month and stays: May's lands 2026-06-10.
    expect(byKind(calendar, 'wage-tax').map((i) => i.date)).toEqual(['2026-06-10']);
  });

  it('does not skip months whose period is only partially paid', () => {
    const calendar = buildObligationsCalendar({
      payables: [],
      payrollPeriods: [period('2026-05', { status: 'parcial' })],
      vatEstimates: [],
      today: '2026-05-20',
      horizonDays: 15,
    });
    expect(byKind(calendar, 'social').map((i) => i.date)).toEqual(['2026-05-27']);
    expect(byKind(calendar, 'payroll-net').map((i) => i.date)).toEqual(['2026-05-29']);
  });

  it('averages at most the latest three periods', () => {
    const calendar = buildObligationsCalendar({
      payables: [],
      payrollPeriods: [
        period('2026-01', { netWagesTotal: 999999 }), // outside the latest 3 → ignored
        period('2026-02', { netWagesTotal: 20000 }),
        period('2026-03', { netWagesTotal: 21000 }),
        period('2026-04', { netWagesTotal: 22000 }),
      ],
      vatEstimates: [],
      today: '2026-07-09',
      horizonDays: 30,
    });
    expect(byKind(calendar, 'payroll-net')[0].amount).toBe(21000);
  });

  it('falls back to zero-amount placeholders when no payroll history exists', () => {
    const calendar = buildObligationsCalendar({
      payables: [],
      payrollPeriods: [],
      vatEstimates: [],
      today: '2026-07-09',
      horizonDays: 30,
    });
    const net = byKind(calendar, 'payroll-net');
    expect(net.map((i) => i.date)).toEqual(['2026-07-31']);
    expect(net[0].amount).toBe(0);
    expect(net[0].estimated).toBe(false);
  });
});

// ─── VAT estimates (manual config input) ───────────────────────────────────────

describe('buildObligationsCalendar vat estimates', () => {
  it('places a VAT estimate on the 10th of M+2 with Dauerfristverlaengerung', () => {
    const calendar = buildObligationsCalendar({
      payables: [],
      payrollPeriods: [],
      vatEstimates: [{ month: '2026-05', amount: 13269.06 }],
      today: '2026-07-01',
      horizonDays: 30,
    });
    expect(byKind(calendar, 'vat')[0]).toMatchObject({
      date: '2026-07-10',
      month: '2026-05',
      amount: 13269.06,
      overdue: false,
      estimated: true,
      source: 'vat-estimates',
    });
  });

  it('keeps an unpaid VAT estimate visible as overdue after its due date', () => {
    const calendar = buildObligationsCalendar({
      payables: [],
      payrollPeriods: [],
      vatEstimates: [{ month: '2026-05', amount: 13269.06 }],
      today: '2026-07-15',
      horizonDays: 30,
    });
    expect(byKind(calendar, 'vat')[0].overdue).toBe(true);
  });

  it('drops VAT estimates due beyond the horizon and malformed months', () => {
    const calendar = buildObligationsCalendar({
      payables: [],
      payrollPeriods: [],
      vatEstimates: [
        { month: '2026-08', amount: 9000 }, // due 2026-10-12 → beyond horizon
        { month: 'garbage', amount: 1 },
      ],
      today: '2026-07-01',
      horizonDays: 60,
    });
    expect(byKind(calendar, 'vat')).toHaveLength(0);
  });
});

// ─── global ordering ───────────────────────────────────────────────────────────

describe('buildObligationsCalendar ordering', () => {
  it('sorts by date, then kind, then label', () => {
    const calendar = buildObligationsCalendar({
      payables: [payable('2026-07-10', 100, { counterpartyName: 'Zeta' })],
      payrollPeriods: [period('2026-05')],
      vatEstimates: [{ month: '2026-05', amount: 500 }],
      today: '2026-07-09',
      horizonDays: 10,
    });
    // 2026-07-10 hosts a payable, June's wage tax and the May VAT estimate.
    expect(calendar.map((i) => i.kind)).toEqual(['payable', 'vat', 'wage-tax']);
    expect(new Set(calendar.map((i) => i.date))).toEqual(new Set(['2026-07-10']));
  });
});
