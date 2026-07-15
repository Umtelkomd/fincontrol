import { describe, expect, it } from 'vitest';
import { CRITICAL_CREDITOR_PATTERN, buildAlerts } from '../alerts.js';
import { agingBuckets } from '../aging.js';

const TODAY = '2026-07-09';

const emptyAging = agingBuckets({ docs: [], today: TODAY });

const healthy = {
  position: {
    balance: 50000,
    anchor: { date: '2026-06-20', balance: 48000, source: 'datev' },
    lastMovementDate: '2026-07-08',
    staleDays: 1,
  },
  forecast: [
    { weekStart: '2026-07-06', projectedBalance: 50000 },
    { weekStart: '2026-07-13', projectedBalance: 52000 },
  ],
  receivablesAging: emptyAging,
  payablesAging: emptyAging,
  importGap: { hasGap: false, lastMovementDate: '2026-07-08', quietBusinessDays: 1 },
  today: TODAY,
};

const idsOf = (alerts) => alerts.map((a) => a.id);

// ─── healthy baseline ──────────────────────────────────────────────────────────

describe('buildAlerts healthy baseline', () => {
  it('raises nothing when every signal is fine', () => {
    expect(buildAlerts(healthy)).toEqual([]);
  });
});

// ─── projected balance below buffer within the first weeks ────────────────────

describe('buildAlerts projected buffer breach', () => {
  it('flags a dip below the buffer inside the first 4 weeks as serious', () => {
    const alerts = buildAlerts({
      ...healthy,
      forecast: [
        { weekStart: '2026-07-06', projectedBalance: 15000 },
        { weekStart: '2026-07-13', projectedBalance: 8000 },
        { weekStart: '2026-07-20', projectedBalance: 12000 },
      ],
    });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      id: 'projected-balance-below-buffer',
      severity: 'serious',
      metric: { amount: 8000, weekStart: '2026-07-13' },
    });
  });

  it('escalates to critical when the projection goes negative', () => {
    const alerts = buildAlerts({
      ...healthy,
      forecast: [{ weekStart: '2026-07-06', projectedBalance: -2500 }],
    });
    expect(alerts[0]).toMatchObject({ id: 'projected-balance-below-buffer', severity: 'critical' });
  });

  it('ignores dips beyond the configured buffer window', () => {
    const forecast = [
      { weekStart: '2026-07-06', projectedBalance: 20000 },
      { weekStart: '2026-07-13', projectedBalance: 20000 },
      { weekStart: '2026-07-20', projectedBalance: 20000 },
      { weekStart: '2026-07-27', projectedBalance: 20000 },
      { weekStart: '2026-08-03', projectedBalance: 4000 }, // week 5
    ];
    expect(buildAlerts({ ...healthy, forecast })).toEqual([]);
  });

  it('honors a custom buffer', () => {
    const alerts = buildAlerts({
      ...healthy,
      forecast: [{ weekStart: '2026-07-06', projectedBalance: 15000 }],
      config: { bufferEur: 20000 },
    });
    expect(idsOf(alerts)).toContain('projected-balance-below-buffer');
  });
});

// ─── balance below the credit floor ────────────────────────────────────────────

describe('buildAlerts credit floor', () => {
  it('flags a balance below the configured credit floor as critical', () => {
    const alerts = buildAlerts({
      ...healthy,
      position: { ...healthy.position, balance: -41000 },
      config: { creditFloorEur: -40000 },
    });
    expect(alerts[0]).toMatchObject({ id: 'balance-below-credit-floor', severity: 'critical' });
  });

  it('stays quiet inside the credit line', () => {
    const alerts = buildAlerts({
      ...healthy,
      position: { ...healthy.position, balance: -20000 },
      config: { creditFloorEur: -40000 },
    });
    expect(idsOf(alerts)).not.toContain('balance-below-credit-floor');
  });

  it('defaults the floor to zero', () => {
    const alerts = buildAlerts({
      ...healthy,
      position: { ...healthy.position, balance: -1 },
    });
    expect(idsOf(alerts)).toContain('balance-below-credit-floor');
  });
});

// ─── receivables overdue beyond the tolerance ─────────────────────────────────

describe('buildAlerts receivables overdue', () => {
  it('warns when receivables are overdue for more than 14 days', () => {
    const receivablesAging = agingBuckets({
      docs: [{ dueDate: '2026-06-15', openAmount: 3000, counterpartyName: 'Client' }], // 24 days
      today: TODAY,
    });
    const alerts = buildAlerts({ ...healthy, receivablesAging });
    expect(alerts[0]).toMatchObject({
      id: 'receivables-overdue',
      severity: 'warning',
      metric: { amount: 3000, count: 1 },
    });
  });

  it('tolerates receivables inside the 14-day window', () => {
    const receivablesAging = agingBuckets({
      docs: [{ dueDate: '2026-07-01', openAmount: 3000 }], // 8 days
      today: TODAY,
    });
    expect(buildAlerts({ ...healthy, receivablesAging })).toEqual([]);
  });
});

// ─── payables overdue — general and critical creditors ────────────────────────

describe('buildAlerts payables overdue', () => {
  const payablesAging = agingBuckets({
    docs: [
      { dueDate: '2026-05-01', openAmount: 25000, counterpartyName: 'Finanzamt Rostock' },
      { dueDate: '2026-06-20', openAmount: 5000, counterpartyName: 'Musterlieferant GmbH' },
    ],
    today: TODAY,
  });

  it('raises a serious alert for the full overdue total', () => {
    const alerts = buildAlerts({ ...healthy, payablesAging });
    const general = alerts.find((a) => a.id === 'payables-overdue');
    expect(general).toMatchObject({ severity: 'serious', metric: { amount: 30000, count: 2 } });
  });

  it('escalates overdue debts to critical creditors (tax office, health insurers)', () => {
    const alerts = buildAlerts({ ...healthy, payablesAging });
    const critical = alerts.find((a) => a.id === 'payables-overdue-critical-creditors');
    expect(critical).toMatchObject({ severity: 'critical', metric: { amount: 25000, count: 1 } });
  });

  it('recognizes the spec creditor patterns', () => {
    for (const name of ['Finanzamt Rostock', 'AOK Nordost', 'Techniker Krankenkasse', 'Knappschaft Bahn-See', 'Minijob-Zentrale']) {
      expect(CRITICAL_CREDITOR_PATTERN.test(name)).toBe(true);
    }
    expect(CRITICAL_CREDITOR_PATTERN.test('Musterlieferant GmbH')).toBe(false);
  });
});

// ─── reconciliation staleness and import gap ──────────────────────────────────

describe('buildAlerts data-trust signals', () => {
  it('warns when the newest anchor is older than 45 days', () => {
    const alerts = buildAlerts({
      ...healthy,
      reconciliation: { lastAnchorDate: '2026-05-20' }, // 50 days
    });
    expect(alerts[0]).toMatchObject({ id: 'reconciliation-stale', severity: 'warning', metric: { days: 50 } });
  });

  it('accepts an anchor exactly at the threshold', () => {
    const alerts = buildAlerts({ ...healthy, reconciliation: { lastAnchorDate: '2026-05-25' } }); // 45 days
    expect(alerts).toEqual([]);
  });

  it('falls back to the position anchor and warns when there is none at all', () => {
    const alerts = buildAlerts({
      ...healthy,
      position: { ...healthy.position, anchor: null },
    });
    expect(idsOf(alerts)).toContain('reconciliation-stale');
  });

  it('surfaces an import gap as a warning', () => {
    const alerts = buildAlerts({
      ...healthy,
      importGap: { hasGap: true, lastMovementDate: '2026-06-26', quietBusinessDays: 9 },
    });
    expect(alerts[0]).toMatchObject({ id: 'import-gap', severity: 'warning', metric: { days: 9 } });
  });
});

// ─── deterministic ordering — severity first, then amount magnitude ───────────

describe('buildAlerts ordering', () => {
  it('sorts by severity rank, then |amount| descending', () => {
    const payablesAging = agingBuckets({
      docs: [
        { dueDate: '2026-05-01', openAmount: 25000, counterpartyName: 'Finanzamt Rostock' },
        { dueDate: '2026-06-20', openAmount: 5000, counterpartyName: 'Musterlieferant GmbH' },
      ],
      today: TODAY,
    });
    const receivablesAging = agingBuckets({
      docs: [{ dueDate: '2026-06-15', openAmount: 3000 }],
      today: TODAY,
    });
    const alerts = buildAlerts({
      ...healthy,
      position: { ...healthy.position, balance: -41000 },
      forecast: [{ weekStart: '2026-07-06', projectedBalance: 8000 }],
      receivablesAging,
      payablesAging,
      importGap: { hasGap: true, lastMovementDate: '2026-06-26', quietBusinessDays: 9 },
      config: { creditFloorEur: -40000 },
    });
    expect(idsOf(alerts)).toEqual([
      'balance-below-credit-floor', // critical, |−41000|
      'payables-overdue-critical-creditors', // critical, 25000
      'payables-overdue', // serious, 30000
      'projected-balance-below-buffer', // serious, 8000
      'receivables-overdue', // warning, 3000
      'import-gap', // warning, no amount
    ]);
  });
});
