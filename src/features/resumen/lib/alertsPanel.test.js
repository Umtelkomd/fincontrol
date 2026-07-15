import { describe, expect, it } from 'vitest';
import { agingBuckets } from '../../../lib/finance';
import { buildResumenAlerts } from './alertsPanel';

const TODAY = '2026-07-10';

const healthyBase = {
  position: { balance: 50000, anchor: { date: '2026-06-30', balance: 48000 } },
  forecast: [
    { weekStart: '2026-07-06', projectedBalance: 52000 },
    { weekStart: '2026-07-13', projectedBalance: 51000 },
  ],
  receivablesAging: agingBuckets({ docs: [], today: TODAY }),
  payablesAging: agingBuckets({ docs: [], today: TODAY }),
  importGap: { hasGap: false, lastMovementDate: '2026-07-09', quietBusinessDays: 1 },
  missingMonths: [],
  today: TODAY,
  config: { bufferEur: 10000, creditFloorEur: -40000 },
};

describe('buildResumenAlerts — quiet state', () => {
  it('returns no alerts when everything is healthy', () => {
    expect(buildResumenAlerts(healthyBase)).toEqual([]);
  });
});

describe('buildResumenAlerts — localized engine alerts', () => {
  it('localizes the projected-buffer alert and points it at /gastos', () => {
    const alerts = buildResumenAlerts({
      ...healthyBase,
      forecast: [
        { weekStart: '2026-07-06', projectedBalance: 12000 },
        { weekStart: '2026-07-13', projectedBalance: 3500 },
      ],
    });

    const alert = alerts.find((a) => a.id === 'projected-balance-below-buffer');
    expect(alert.severity).toBe('serious');
    expect(alert.title).toBe('Caja proyectada bajo el colchón');
    expect(alert.detail).toContain('3.500,00');
    expect(alert.detail).toContain('13.07'); // week of DD.MM
    expect(alert.href).toBe('/gastos');
  });

  it('escalates to critical when the projection goes negative', () => {
    const alerts = buildResumenAlerts({
      ...healthyBase,
      forecast: [{ weekStart: '2026-07-06', projectedBalance: -2000 }],
    });
    expect(alerts.find((a) => a.id === 'projected-balance-below-buffer').severity).toBe('critical');
  });

  it('flags overdue payables to critical creditors with accent severity', () => {
    const payablesAging = agingBuckets({
      docs: [
        { dueDate: '2026-06-01', openAmount: 4000, counterpartyName: 'AOK Nordost' },
        { dueDate: '2026-06-20', openAmount: 900, counterpartyName: 'Proveedor normal' },
      ],
      today: TODAY,
    });

    const alerts = buildResumenAlerts({ ...healthyBase, payablesAging });

    const critical = alerts.find((a) => a.id === 'payables-overdue-critical-creditors');
    expect(critical.severity).toBe('critical');
    expect(critical.detail).toContain('4.000,00');
    expect(critical.href).toBe('/gastos');

    const general = alerts.find((a) => a.id === 'payables-overdue');
    expect(general.severity).toBe('serious');
    expect(general.detail).toContain('4.900,00');

    // critical sorts before serious
    expect(alerts.indexOf(critical)).toBeLessThan(alerts.indexOf(general));
  });

  it('flags stale receivables toward /ingresos', () => {
    const receivablesAging = agingBuckets({
      docs: [{ dueDate: '2026-06-01', openAmount: 1500, counterpartyName: 'Cliente' }],
      today: TODAY,
    });
    const alerts = buildResumenAlerts({ ...healthyBase, receivablesAging });
    const alert = alerts.find((a) => a.id === 'receivables-overdue');
    expect(alert.severity).toBe('warning');
    expect(alert.href).toBe('/ingresos');
    expect(alert.detail).toContain('1.500,00');
  });

  it('warns about a missing reconciliation anchor toward /configuracion', () => {
    const alerts = buildResumenAlerts({
      ...healthyBase,
      position: { balance: 50000, anchor: null },
    });
    const alert = alerts.find((a) => a.id === 'reconciliation-stale');
    expect(alert.severity).toBe('warning');
    expect(alert.detail).toBe('No existe ningún ancla de conciliación.');
    expect(alert.href).toBe('/configuracion');
  });

  it('warns about an aged anchor with the day count', () => {
    const alerts = buildResumenAlerts({
      ...healthyBase,
      position: { balance: 50000, anchor: { date: '2026-04-01', balance: 1 } },
    });
    const alert = alerts.find((a) => a.id === 'reconciliation-stale');
    expect(alert.detail).toContain('100 días'); // 2026-04-01 → 2026-07-10
  });

  it('routes the import gap toward /datev', () => {
    const alerts = buildResumenAlerts({
      ...healthyBase,
      importGap: { hasGap: true, lastMovementDate: '2026-06-20', quietBusinessDays: 14 },
    });
    const alert = alerts.find((a) => a.id === 'import-gap');
    expect(alert.severity).toBe('warning');
    expect(alert.detail).toContain('14 días hábiles');
    expect(alert.href).toBe('/datev');
  });
});

describe('buildResumenAlerts — missing payroll months', () => {
  it('adds one warning per missing month pointing at /nominas', () => {
    const alerts = buildResumenAlerts({ ...healthyBase, missingMonths: ['2026-06'] });

    const alert = alerts.find((a) => a.id === 'payroll-month-missing:2026-06');
    expect(alert.severity).toBe('warning');
    expect(alert.title).toBe('Nómina de junio de 2026 sin importar');
    expect(alert.detail).toContain('junio de 2026');
    expect(alert.href).toBe('/nominas');
  });

  it('sorts payroll warnings after critical/serious alerts', () => {
    const alerts = buildResumenAlerts({
      ...healthyBase,
      forecast: [{ weekStart: '2026-07-06', projectedBalance: -1 }],
      missingMonths: ['2026-05', '2026-06'],
    });

    expect(alerts[0].id).toBe('projected-balance-below-buffer');
    const ids = alerts.map((a) => a.id);
    expect(ids).toContain('payroll-month-missing:2026-05');
    expect(ids).toContain('payroll-month-missing:2026-06');
  });
});
