/**
 * Unit tests for runway.js — pure math, no mocks needed.
 *
 * Vitest API. See useCFOSnapshot.test.js for the runner setup note.
 */

import { describe, expect, it } from 'vitest';

import {
  computeCashToday,
  computeBurnRate,
  computeRunway,
  computeBalanceTimeseries,
  summarizeCashPosition,
  __internal,
} from './runway.js';

const mv = (postedDate, direction, amount, extra = {}) => ({
  id: extra.id || `${postedDate}-${direction}-${amount}`,
  postedDate,
  direction,
  amount,
  status: extra.status || 'posted',
  ...extra,
});

const bankAccount = (balance, balanceDate) => ({
  bankName: 'Test',
  balance,
  balanceDate,
  creditLineLimit: 0,
});

// ── computeCashToday ───────────────────────────────────────────────────────
describe('computeCashToday', () => {
  it('returns starting balance when no movements after balanceDate', () => {
    const result = computeCashToday(
      {
        bankAccount: bankAccount(10000, '2026-01-01'),
        bankMovements: [],
      },
      '2026-04-28',
    );
    expect(result.cashToday).toBe(10000);
    expect(result.netSinceBalanceDate).toBe(0);
  });

  it('adds net movements after balanceDate, ignoring those on/before it', () => {
    const result = computeCashToday(
      {
        bankAccount: bankAccount(10000, '2026-01-01'),
        bankMovements: [
          mv('2026-01-01', 'in', 500), // on balanceDate → ignored
          mv('2026-01-02', 'in', 1000),
          mv('2026-02-15', 'out', 300),
          mv('2026-04-20', 'in', 200),
        ],
      },
      '2026-04-28',
    );
    expect(result.cashToday).toBe(10000 + 1000 - 300 + 200);
    expect(result.netSinceBalanceDate).toBe(900);
  });

  it('ignores void movements', () => {
    const result = computeCashToday(
      {
        bankAccount: bankAccount(5000, '2026-01-01'),
        bankMovements: [
          mv('2026-02-01', 'in', 1000, { status: 'void' }),
          mv('2026-02-02', 'in', 200),
        ],
      },
      '2026-03-01',
    );
    expect(result.cashToday).toBe(5200);
  });

  it('ignores movements after asOfDate', () => {
    const result = computeCashToday(
      {
        bankAccount: bankAccount(1000, '2026-01-01'),
        bankMovements: [
          mv('2026-04-29', 'in', 999), // after asOfDate
        ],
      },
      '2026-04-28',
    );
    expect(result.cashToday).toBe(1000);
  });

  it('falls back to startingBalance when bankAccount is missing', () => {
    const result = computeCashToday(
      { bankAccount: null, bankMovements: [mv('2026-04-01', 'in', 500)] },
      '2026-04-28',
    );
    expect(result.cashToday).toBe(0);
  });
});

// ── computeBurnRate ────────────────────────────────────────────────────────
describe('computeBurnRate', () => {
  it('aggregates inflows / outflows over the window', () => {
    const today = '2026-04-28';
    const movements = [
      mv('2026-04-10', 'in', 5000),
      mv('2026-04-15', 'out', 1000),
      mv('2026-04-20', 'out', 2000),
      mv('2026-04-25', 'out', 500),
      mv('2026-03-01', 'out', 99999), // outside 30d window
    ];
    const burn = computeBurnRate({ bankMovements: movements }, 30, today);
    expect(burn.totalIn).toBe(5000);
    expect(burn.totalOut).toBe(3500);
    expect(burn.net).toBe(1500);
    expect(burn.perDay).toBeCloseTo(3500 / 30, 2);
    expect(burn.perMonth).toBeCloseTo((3500 / 30) * 30, 2);
  });

  it('handles zero movements gracefully', () => {
    const burn = computeBurnRate({ bankMovements: [] }, 30, '2026-04-28');
    expect(burn.totalOut).toBe(0);
    expect(burn.perMonth).toBe(0);
  });

  it('clamps days to a sensible minimum', () => {
    const burn = computeBurnRate({ bankMovements: [] }, 0, '2026-04-28');
    expect(burn.days).toBe(1);
  });
});

// ── computeRunway ──────────────────────────────────────────────────────────
describe('computeRunway', () => {
  it('returns infinite when burnPerMonth is zero', () => {
    const r = computeRunway(
      { cashToday: 50000, burnPerMonth: 0 },
      '2026-04-28',
    );
    expect(r.isInfinite).toBe(true);
    expect(r.months).toBe(Infinity);
    expect(r.projectedZeroDate).toBeNull();
  });

  it('flags critical when cash already below threshold', () => {
    const r = computeRunway(
      { cashToday: 5000, burnPerMonth: 1000, criticalThreshold: 10000 },
      '2026-04-28',
    );
    expect(r.isCritical).toBe(true);
    expect(r.projectedCriticalDate).toBe('2026-04-28');
  });

  it('computes months and projected zero date', () => {
    const r = computeRunway(
      { cashToday: 30000, burnPerMonth: 10000, criticalThreshold: 10000 },
      '2026-04-28',
    );
    expect(r.months).toBeCloseTo(3, 1);
    // 3 months * 30 days = 90 days from 2026-04-28
    expect(r.projectedZeroDate).toBe('2026-07-27');
    // (30000 - 10000) / 10000 * 30 = 60 days from today
    expect(r.projectedCriticalDate).toBe('2026-06-27');
    expect(r.isCritical).toBe(false);
  });
});

// ── computeBalanceTimeseries ───────────────────────────────────────────────
describe('computeBalanceTimeseries', () => {
  it('returns lookbackDays+1 daily points', () => {
    const series = computeBalanceTimeseries(
      {
        bankAccount: bankAccount(10000, '2026-01-01'),
        bankMovements: [],
      },
      90,
      '2026-04-28',
    );
    expect(series).toHaveLength(91);
    expect(series[0].date).toBe('2026-01-28');
    expect(series.at(-1).date).toBe('2026-04-28');
    // No movements → balance constant
    series.forEach((p) => expect(p.balance).toBe(10000));
  });

  it('reflects movements per day', () => {
    const series = computeBalanceTimeseries(
      {
        bankAccount: bankAccount(10000, '2026-04-20'),
        bankMovements: [
          mv('2026-04-22', 'in', 1000),
          mv('2026-04-25', 'out', 300),
        ],
      },
      8,
      '2026-04-28',
    );
    // Start: 2026-04-20. Day-by-day balance:
    const map = Object.fromEntries(series.map((p) => [p.date, p.balance]));
    expect(map['2026-04-20']).toBe(10000);
    expect(map['2026-04-21']).toBe(10000);
    expect(map['2026-04-22']).toBe(11000);
    expect(map['2026-04-24']).toBe(11000);
    expect(map['2026-04-25']).toBe(10700);
    expect(map['2026-04-28']).toBe(10700);
  });
});

// ── summarizeCashPosition (integration) ────────────────────────────────────
describe('summarizeCashPosition', () => {
  it('produces the panel-ready shape', () => {
    const snapshot = {
      bankAccount: bankAccount(20000, '2026-01-01'),
      bankMovements: [
        mv('2026-04-10', 'in', 5000),
        mv('2026-04-15', 'out', 2000),
        mv('2026-04-20', 'out', 3000),
      ],
    };
    const out = summarizeCashPosition(snapshot, { asOfDate: '2026-04-28' });
    expect(out.cash.cashToday).toBe(20000 + 5000 - 2000 - 3000);
    expect(out.burn30.totalOut).toBe(5000);
    expect(out.runway).toBeDefined();
    expect(out.cashCoverageMonths).toBeDefined();
    expect(out.netRunwayMonths).toBe(Infinity);
    expect(out.netRunway.projectedZeroDate).toBeNull();
    expect(out.sparkline.length).toBe(91);
  });

  it('uses net runway only when 30d net movement is negative', () => {
    const snapshot = {
      bankAccount: bankAccount(10000, '2026-04-01'),
      bankMovements: [
        mv('2026-04-10', 'out', 2500),
      ],
    };
    const out = summarizeCashPosition(snapshot, { asOfDate: '2026-04-28' });
    expect(out.net30PerMonth).toBe(-2500);
    expect(out.netRunwayMonths).toBe(3);
    expect(out.netRunway.projectedZeroDate).toBe('2026-07-27');
  });
});

// ── internal helpers ───────────────────────────────────────────────────────
describe('internal helpers', () => {
  it('addDaysIso handles month boundaries', () => {
    expect(__internal.addDaysIso('2026-01-31', 1)).toBe('2026-02-01');
    expect(__internal.addDaysIso('2026-03-01', -1)).toBe('2026-02-28');
    expect(__internal.addDaysIso('2026-04-28', -90)).toBe('2026-01-28');
  });

  it('sumNet ignores void movements and respects window', () => {
    const result = __internal.sumNet(
      [
        mv('2026-04-10', 'in', 100),
        mv('2026-04-15', 'out', 50, { status: 'void' }),
        mv('2026-04-20', 'out', 30),
      ],
      '2026-04-09',
      '2026-04-25',
    );
    expect(result).toBe(70); // 100 in - 30 out (void skipped)
  });
});

// ── reconciliation anchors — the canonical cash model ──────────────────────
// `/cfo` must derive cash exactly like Resumen: newest anchor <= today plus the
// signed movements posted after it. The bankAccount.balanceDate walk is only a
// fallback for the days before any anchor exists.

const anchor = (date, balance, extra = {}) => ({
  date,
  balance,
  source: 'datev',
  note: '',
  ...extra,
});

describe('computeCashToday with reconciliation anchors', () => {
  it('derives cash from the newest anchor on or before asOfDate', () => {
    const result = computeCashToday(
      {
        bankAccount: bankAccount(99999, '2026-01-01'), // stale, must be ignored
        bankMovements: [
          mv('2026-05-31', 'in', 5000), // on the anchor date → already inside it
          mv('2026-06-10', 'in', 2000),
          mv('2026-07-01', 'out', 500),
        ],
        anchors: [anchor('2026-05-31', 1214.2)],
      },
      '2026-07-26',
    );
    expect(result.cashToday).toBe(1214.2 + 2000 - 500);
    expect(result.source).toBe('anchors');
    expect(result.anchor.date).toBe('2026-05-31');
    expect(result.startingBalance).toBe(1214.2);
    expect(result.balanceDate).toBe('2026-05-31');
    expect(result.netSinceBalanceDate).toBe(1500);
  });

  it('picks the newest anchor and ignores anchors dated after asOfDate', () => {
    const result = computeCashToday(
      {
        bankAccount: bankAccount(0, '2026-01-01'),
        bankMovements: [],
        anchors: [
          anchor('2026-01-31', 100),
          anchor('2026-05-31', 1214.2),
          anchor('2026-12-31', 999999), // future → not usable today
        ],
      },
      '2026-07-26',
    );
    expect(result.cashToday).toBe(1214.2);
    expect(result.anchor.date).toBe('2026-05-31');
  });

  it('ignores void movements and movements after asOfDate on the anchor path', () => {
    const result = computeCashToday(
      {
        bankAccount: bankAccount(0, '2026-01-01'),
        bankMovements: [
          mv('2026-06-10', 'in', 3000, { status: 'void' }),
          mv('2026-06-11', 'in', 100),
          mv('2026-07-27', 'in', 7777), // after asOfDate
        ],
        anchors: [anchor('2026-05-31', 1214.2)],
      },
      '2026-07-26',
    );
    expect(result.cashToday).toBe(1314.2);
  });

  it('honours signedAmount when the import provides one', () => {
    const result = computeCashToday(
      {
        bankAccount: bankAccount(0, '2026-01-01'),
        bankMovements: [
          mv('2026-06-10', 'out', 400, { signedAmount: -400 }),
          mv('2026-06-11', 'in', 250, { signedAmount: 250 }),
        ],
        anchors: [anchor('2026-05-31', 1000)],
      },
      '2026-07-26',
    );
    expect(result.cashToday).toBe(850);
  });

  it('falls back to the legacy balanceDate walk when no anchor covers asOfDate', () => {
    const result = computeCashToday(
      {
        bankAccount: bankAccount(10000, '2026-01-01'),
        bankMovements: [mv('2026-02-01', 'in', 500)],
        anchors: [anchor('2026-12-31', 999999)],
      },
      '2026-04-28',
    );
    expect(result.cashToday).toBe(10500);
    expect(result.source).toBe('legacy');
    expect(result.anchor).toBeNull();
    expect(result.balanceDate).toBe('2026-01-01');
  });

  it('reports the legacy source when no anchors are supplied at all', () => {
    const result = computeCashToday(
      { bankAccount: bankAccount(10000, '2026-01-01'), bankMovements: [] },
      '2026-04-28',
    );
    expect(result.source).toBe('legacy');
    expect(result.anchor).toBeNull();
  });

  it('skips malformed anchors instead of trusting them', () => {
    const result = computeCashToday(
      {
        bankAccount: bankAccount(10000, '2026-01-01'),
        bankMovements: [],
        anchors: [{ date: 'not-a-date', balance: 5 }, { date: '2026-05-31', balance: null }],
      },
      '2026-07-26',
    );
    expect(result.source).toBe('legacy');
    expect(result.cashToday).toBe(10000);
  });

  it('exposes bank-import freshness so a stale feed is visible', () => {
    const result = computeCashToday(
      {
        bankAccount: bankAccount(0, '2026-01-01'),
        bankMovements: [mv('2026-07-20', 'in', 10)],
        anchors: [anchor('2026-05-31', 1000)],
      },
      '2026-07-26',
    );
    expect(result.lastMovementDate).toBe('2026-07-20');
    expect(result.staleDays).toBe(6);
  });
});

describe('computeBalanceTimeseries with reconciliation anchors', () => {
  it('rebuilds the series from the anchor so it ends on the anchor-derived cash', () => {
    const input = {
      bankAccount: bankAccount(99999, '2026-01-01'),
      bankMovements: [mv('2026-07-02', 'in', 800), mv('2026-07-04', 'out', 300)],
      anchors: [anchor('2026-06-30', 1000)],
    };
    const series = computeBalanceTimeseries(input, 7, '2026-07-05');
    const map = Object.fromEntries(series.map((p) => [p.date, p.balance]));
    expect(map['2026-07-01']).toBe(1000);
    expect(map['2026-07-02']).toBe(1800);
    expect(map['2026-07-04']).toBe(1500);
    expect(map['2026-07-05']).toBe(1500);
    expect(series.at(-1).balance).toBe(
      computeCashToday(input, '2026-07-05').cashToday,
    );
  });

  it('re-anchors mid-window and leaves pre-anchor days empty', () => {
    const series = computeBalanceTimeseries(
      {
        bankAccount: bankAccount(0, '2026-06-01'),
        bankMovements: [mv('2026-07-03', 'in', 200)],
        anchors: [anchor('2026-07-02', 500)],
      },
      4,
      '2026-07-04',
    );
    const map = Object.fromEntries(series.map((p) => [p.date, p.balance]));
    expect(map['2026-06-30']).toBeNull();
    expect(map['2026-07-02']).toBe(500);
    expect(map['2026-07-03']).toBe(700);
  });

  it('keeps the legacy walk when no anchor covers the window', () => {
    const series = computeBalanceTimeseries(
      {
        bankAccount: bankAccount(10000, '2026-04-20'),
        bankMovements: [mv('2026-04-22', 'in', 1000)],
        anchors: [],
      },
      8,
      '2026-04-28',
    );
    expect(series).toHaveLength(9);
    expect(series.at(-1).balance).toBe(11000);
  });
});

describe('summarizeCashPosition with reconciliation anchors', () => {
  const snapshot = {
    bankAccount: bankAccount(99999, '2026-01-01'),
    bankMovements: [mv('2026-06-10', 'in', 2000), mv('2026-07-01', 'out', 500)],
    anchors: [anchor('2026-05-31', 1214.2)],
  };

  it('reports the anchored cash, not the stale bankAccount balance', () => {
    const out = summarizeCashPosition(snapshot, { asOfDate: '2026-07-26' });
    expect(out.cash.cashToday).toBe(2714.2);
    expect(out.cash.source).toBe('anchors');
    expect(out.sparkline.at(-1).balance).toBe(2714.2);
  });

  it('flags the degraded state when nothing is reconciled', () => {
    const out = summarizeCashPosition(
      { ...snapshot, anchors: [] },
      { asOfDate: '2026-07-26' },
    );
    expect(out.cash.source).toBe('legacy');
    expect(out.cash.cashToday).toBe(99999 + 2000 - 500);
  });
});
