import { describe, expect, it } from 'vitest';

import {
  CRITICAL_RUNWAY_MONTHS,
  CRITICAL_RUNWAY_WEEKS,
  UNRECONCILED_CASH_META,
  describeCashMeta,
  describeRunway,
} from './liquidityCopy.js';

describe('describeRunway', () => {
  it('says the cash is below zero instead of printing negative months', () => {
    const negative = describeRunway({ currentCash: -1200, weeksToNegative: null, runwayMonths: -0.3 });

    expect(negative.value).toBe('Bajo cero');
    expect(negative.meta).toBe('La caja ya está en negativo');
    expect(negative.critical).toBe(true);
    expect(describeRunway({ currentCash: 0, runwayMonths: 0 }).value).toBe('Bajo cero');
  });

  it('prefers the committed-outflow wall from the forecast', () => {
    const runway = describeRunway({ currentCash: 5000, weeksToNegative: 4, runwayMonths: 2.5 });

    expect(runway.value).toBe('4 sem.');
    expect(runway.meta).toMatch(/Hasta caja en 0/);
    expect(runway.critical).toBe(true);
    expect(describeRunway({ currentCash: 5000, weeksToNegative: CRITICAL_RUNWAY_WEEKS }).critical).toBe(false);
  });

  it('falls back to the average-burn estimate in months', () => {
    const runway = describeRunway({ currentCash: 5000, weeksToNegative: null, runwayMonths: 4.26 });

    expect(runway.value).toBe('4,3 meses');
    expect(runway.meta).toBe('Al ritmo de gasto promedio');
    expect(runway.critical).toBe(false);
    expect(
      describeRunway({ currentCash: 5000, runwayMonths: CRITICAL_RUNWAY_MONTHS - 0.1 }).critical,
    ).toBe(true);
  });

  it('never prints a negative number of months even if the engine hands one over', () => {
    expect(describeRunway({ currentCash: 10, runwayMonths: -2 }).value).toBe('0 meses');
  });

  it('explains the absence of a burn rate', () => {
    const runway = describeRunway({ currentCash: 5000, weeksToNegative: null, runwayMonths: null });

    expect(runway.value).toBe('Sin gasto');
    expect(runway.meta).toBe('No hay salidas para proyectar');
  });
});

describe('describeCashMeta', () => {
  it('names the anchor and the last movement when the cash is anchor-derived', () => {
    const meta = describeCashMeta({
      cashSource: 'anchors',
      cashMeta: { anchor: { date: '2026-05-31' }, lastMovementDate: '2026-08-28' },
    });

    expect(meta).toBe('Conciliado al 31/05/2026 · últ. mov. 28/08/2026');
  });

  it('tolerates a missing last movement', () => {
    expect(
      describeCashMeta({ cashSource: 'anchors', cashMeta: { anchor: { date: '2026-05-31' } } }),
    ).toBe('Conciliado al 31/05/2026 · últ. mov. —');
  });

  it('warns when the balance is not reconciled', () => {
    expect(describeCashMeta({ cashSource: 'legacy', cashMeta: { anchor: null } })).toBe(UNRECONCILED_CASH_META);
    expect(describeCashMeta({})).toBe(UNRECONCILED_CASH_META);
    expect(UNRECONCILED_CASH_META).toMatch(/^Sin conciliar/);
  });
});
