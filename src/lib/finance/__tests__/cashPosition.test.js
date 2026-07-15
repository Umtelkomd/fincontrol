import { describe, expect, it } from 'vitest';
import { dailyBalanceSeries, deriveBalance, detectImportGap } from '../cashPosition.js';

const anchor = (date, balance, extra = {}) => ({ date, balance, source: 'datev', ...extra });

const mv = (postedDate, direction, amount, extra = {}) => ({
  postedDate,
  direction,
  amount,
  status: 'posted',
  ...extra,
});

// ─── deriveBalance — anchor + movements strictly after it, up to today ────────

describe('deriveBalance', () => {
  it('returns the anchor balance when no movements apply', () => {
    const result = deriveBalance({
      anchors: [anchor('2026-05-31', 1214.2)],
      movements: [],
      today: '2026-07-09',
    });
    expect(result.balance).toBeCloseTo(1214.2, 2);
    expect(result.anchor.date).toBe('2026-05-31');
    expect(result.movementsApplied).toBe(0);
  });

  it('picks the latest anchor on or before today', () => {
    const result = deriveBalance({
      anchors: [anchor('2026-01-31', 500), anchor('2026-08-31', 9999), anchor('2026-05-31', 1214.2)],
      movements: [],
      today: '2026-07-09',
    });
    expect(result.anchor.date).toBe('2026-05-31');
    expect(result.balance).toBeCloseTo(1214.2, 2);
  });

  it('lets the later of two same-date anchors win', () => {
    const result = deriveBalance({
      anchors: [anchor('2026-05-31', 100), anchor('2026-05-31', 200)],
      movements: [],
      today: '2026-07-09',
    });
    expect(result.balance).toBe(200);
  });

  it('excludes movements ON the anchor date and includes the day after', () => {
    const result = deriveBalance({
      anchors: [anchor('2026-05-31', 1000)],
      movements: [
        mv('2026-05-31', 'in', 500), // already inside the anchor balance
        mv('2026-06-01', 'in', 300),
      ],
      today: '2026-07-09',
    });
    expect(result.balance).toBe(1300);
    expect(result.movementsApplied).toBe(1);
  });

  it('excludes movements after today and includes movements on today', () => {
    const result = deriveBalance({
      anchors: [anchor('2026-05-31', 1000)],
      movements: [
        mv('2026-07-09', 'out', 100),
        mv('2026-07-10', 'in', 99999),
      ],
      today: '2026-07-09',
    });
    expect(result.balance).toBe(900);
    expect(result.movementsApplied).toBe(1);
  });

  it('applies the signedAmount fallback for legacy movements', () => {
    const result = deriveBalance({
      anchors: [anchor('2026-05-31', 0)],
      movements: [
        mv('2026-06-02', 'in', 100, { signedAmount: 0 }), // legacy: unusable signedAmount
        mv('2026-06-03', 'out', 40), // legacy: missing signedAmount
        mv('2026-06-04', 'in', 10, { signedAmount: -10 }), // nonzero signedAmount wins
      ],
      today: '2026-07-09',
    });
    expect(result.balance).toBe(100 - 40 - 10);
  });

  it('reports data staleness against the newest movement not after today', () => {
    const result = deriveBalance({
      anchors: [anchor('2026-05-31', 0)],
      movements: [
        mv('2026-06-15', 'in', 10),
        mv('2026-07-03', 'in', 5),
        mv('2026-08-01', 'in', 1), // future-dated → ignored for staleness
      ],
      today: '2026-07-09',
    });
    expect(result.lastMovementDate).toBe('2026-07-03');
    expect(result.staleDays).toBe(6);
  });

  it('returns nulls when no anchor is eligible', () => {
    const result = deriveBalance({
      anchors: [anchor('2026-08-31', 9999)],
      movements: [mv('2026-07-01', 'in', 100)],
      today: '2026-07-09',
    });
    expect(result.balance).toBeNull();
    expect(result.anchor).toBeNull();
    expect(result.movementsApplied).toBe(0);
  });

  it('returns null staleness when there are no movements', () => {
    const result = deriveBalance({
      anchors: [anchor('2026-05-31', 1)],
      movements: [],
      today: '2026-07-09',
    });
    expect(result.lastMovementDate).toBeNull();
    expect(result.staleDays).toBeNull();
  });
});

// ─── dailyBalanceSeries — carry-forward, re-anchoring, null before coverage ───

describe('dailyBalanceSeries', () => {
  it('carries the balance forward on days without movements', () => {
    const series = dailyBalanceSeries({
      anchors: [anchor('2026-06-30', 1000)],
      movements: [mv('2026-07-02', 'in', 500)],
      from: '2026-07-01',
      to: '2026-07-04',
    });
    expect(series).toEqual([
      { date: '2026-07-01', balance: 1000 },
      { date: '2026-07-02', balance: 1500 },
      { date: '2026-07-03', balance: 1500 },
      { date: '2026-07-04', balance: 1500 },
    ]);
  });

  it('re-anchors when a newer anchor date falls inside the range', () => {
    const series = dailyBalanceSeries({
      anchors: [anchor('2026-06-30', 1000), anchor('2026-07-03', 2000)],
      movements: [
        mv('2026-07-02', 'in', 500),
        mv('2026-07-03', 'in', 100), // on the new anchor date → inside its balance
        mv('2026-07-04', 'out', 300),
      ],
      from: '2026-07-01',
      to: '2026-07-05',
    });
    expect(series).toEqual([
      { date: '2026-07-01', balance: 1000 },
      { date: '2026-07-02', balance: 1500 },
      { date: '2026-07-03', balance: 2000 },
      { date: '2026-07-04', balance: 1700 },
      { date: '2026-07-05', balance: 1700 },
    ]);
  });

  it('counts a movement on the range start when it is after the anchor', () => {
    const series = dailyBalanceSeries({
      anchors: [anchor('2026-06-30', 1000)],
      movements: [mv('2026-07-01', 'in', 50)],
      from: '2026-07-01',
      to: '2026-07-01',
    });
    expect(series).toEqual([{ date: '2026-07-01', balance: 1050 }]);
  });

  it('yields null balances for days before the first anchor', () => {
    const series = dailyBalanceSeries({
      anchors: [anchor('2026-07-03', 777)],
      movements: [mv('2026-07-02', 'in', 100)],
      from: '2026-07-01',
      to: '2026-07-04',
    });
    expect(series).toEqual([
      { date: '2026-07-01', balance: null },
      { date: '2026-07-02', balance: null },
      { date: '2026-07-03', balance: 777 },
      { date: '2026-07-04', balance: 777 },
    ]);
  });

  it('returns an empty series for an inverted range', () => {
    expect(
      dailyBalanceSeries({ anchors: [], movements: [], from: '2026-07-05', to: '2026-07-01' }),
    ).toEqual([]);
  });
});

// ─── detectImportGap — quiet bank business days since the last movement ───────

describe('detectImportGap', () => {
  const movements = [mv('2026-06-20', 'in', 10), mv('2026-07-03', 'out', 5)];

  it('does not flag a normal import cadence', () => {
    // Fri 2026-07-03 → Thu 2026-07-09: Mon 6, Tue 7, Wed 8, Thu 9 = 4 quiet days.
    const result = detectImportGap({ movements, today: '2026-07-09' });
    expect(result).toEqual({ hasGap: false, lastMovementDate: '2026-07-03', quietBusinessDays: 4 });
  });

  it('tolerates exactly maxQuietBusinessDays', () => {
    const result = detectImportGap({ movements, today: '2026-07-10' }); // 5 quiet days
    expect(result.hasGap).toBe(false);
    expect(result.quietBusinessDays).toBe(5);
  });

  it('flags one business day beyond the tolerance', () => {
    const result = detectImportGap({ movements, today: '2026-07-13' }); // Mon → 6 quiet days
    expect(result.hasGap).toBe(true);
    expect(result.quietBusinessDays).toBe(6);
  });

  it('ignores weekends entirely', () => {
    const result = detectImportGap({ movements, today: '2026-07-05' }); // Sunday after the Friday
    expect(result.hasGap).toBe(false);
    expect(result.quietBusinessDays).toBe(0);
  });

  it('skips public holidays when counting quiet days', () => {
    // Thu 2026-04-30 → Mon 2026-05-04 with May 1 (Fri) a holiday → 1 quiet day.
    const result = detectImportGap({
      movements: [mv('2026-04-30', 'in', 1)],
      today: '2026-05-04',
    });
    expect(result.quietBusinessDays).toBe(1);
  });

  it('honors a custom threshold', () => {
    const result = detectImportGap({ movements, today: '2026-07-10', maxQuietBusinessDays: 4 });
    expect(result.hasGap).toBe(true);
  });

  it('flags the gap when there are no usable movements at all', () => {
    expect(detectImportGap({ movements: [], today: '2026-07-09' })).toEqual({
      hasGap: true,
      lastMovementDate: null,
      quietBusinessDays: null,
    });
    // Future-dated movements cannot prove imports are current either.
    expect(detectImportGap({ movements: [mv('2026-08-01', 'in', 1)], today: '2026-07-09' }).hasGap).toBe(true);
  });
});
