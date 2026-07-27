import { describe, expect, it } from 'vitest';
import {
  MAX_COLLECTION_SLIP_DAYS,
  MIN_COLLECTION_SLIP_SAMPLE,
  OBSERVABLE_SLIP_WINDOW_DAYS,
  deriveCollectionSlip,
} from '../collectionSlip.js';
import { addDays } from '../dates.js';
import { COLLECTION_SLIP_DAYS } from '../forecast.js';

const DUE = '2026-04-02';

/**
 * A fully collected receivable whose single payment landed `delay` days after
 * the due date (negative = paid early).
 */
const collected = (delay, amount, extra = {}) => ({
  dueDate: DUE,
  openAmount: 0,
  status: 'settled',
  payments: [{ date: addDays(DUE, delay), amount }],
  ...extra,
});

const sample = (count, delay = 10, amount = 1000) =>
  Array.from({ length: count }, () => collected(delay, amount));

// ─── the fallback: too little history is not evidence ─────────────────────────

describe('deriveCollectionSlip fallback', () => {
  it('returns the documented default with no history at all', () => {
    expect(deriveCollectionSlip({ receivables: [] })).toEqual({
      slipDays: COLLECTION_SLIP_DAYS,
      sampleSize: 0,
      confidence: 'default',
    });
  });

  it('tolerates a missing or malformed receivables list', () => {
    for (const receivables of [undefined, null, 'nope']) {
      expect(deriveCollectionSlip({ receivables })).toEqual({
        slipDays: COLLECTION_SLIP_DAYS,
        sampleSize: 0,
        confidence: 'default',
      });
    }
    expect(deriveCollectionSlip()).toMatchObject({ confidence: 'default' });
  });

  it('falls back one invoice below the minimum sample size', () => {
    const result = deriveCollectionSlip({ receivables: sample(MIN_COLLECTION_SLIP_SAMPLE - 1, 30) });
    expect(result).toEqual({
      slipDays: COLLECTION_SLIP_DAYS,
      sampleSize: MIN_COLLECTION_SLIP_SAMPLE - 1,
      confidence: 'default',
    });
  });

  it('measures exactly at the minimum sample size', () => {
    const result = deriveCollectionSlip({ receivables: sample(MIN_COLLECTION_SLIP_SAMPLE, 30) });
    expect(result).toEqual({
      slipDays: 30,
      sampleSize: MIN_COLLECTION_SLIP_SAMPLE,
      confidence: 'measured',
    });
  });

  it('reports the sample it did see even while falling back', () => {
    expect(deriveCollectionSlip({ receivables: sample(3, 40) })).toMatchObject({
      slipDays: COLLECTION_SLIP_DAYS,
      sampleSize: 3,
    });
  });

  it('lets the caller pick a different fallback and threshold', () => {
    expect(
      deriveCollectionSlip({ receivables: sample(2, 30), fallbackSlipDays: 14, minSampleSize: 5 }),
    ).toEqual({ slipDays: 14, sampleSize: 2, confidence: 'default' });

    expect(deriveCollectionSlip({ receivables: sample(2, 30), minSampleSize: 2 })).toMatchObject({
      slipDays: 30,
      confidence: 'measured',
    });
  });

  it('clamps and rounds an out-of-range fallback so the contract always holds', () => {
    expect(deriveCollectionSlip({ receivables: [], fallbackSlipDays: -5 }).slipDays).toBe(0);
    expect(deriveCollectionSlip({ receivables: [], fallbackSlipDays: 400 }).slipDays).toBe(
      MAX_COLLECTION_SLIP_DAYS,
    );
    expect(deriveCollectionSlip({ receivables: [], fallbackSlipDays: 12.6 }).slipDays).toBe(13);
    expect(deriveCollectionSlip({ receivables: [], fallbackSlipDays: 'soon' }).slipDays).toBe(
      COLLECTION_SLIP_DAYS,
    );
  });
});

// ─── the measurement: amount-weighted, because cash is not counted in invoices ─

describe('deriveCollectionSlip measurement', () => {
  it('weights by amount, not by invoice count', () => {
    const receivables = [collected(30, 40000), collected(-10, 200)];
    // (30 * 40000 + -10 * 200) / 40200 = 29.80 → 30
    expect(deriveCollectionSlip({ receivables, minSampleSize: 2 })).toEqual({
      slipDays: 30,
      sampleSize: 2,
      confidence: 'measured',
    });

    // The same two invoices, unweighted, would have averaged 10 days.
    const unweighted = (30 + -10) / 2;
    expect(unweighted).toBe(10);
  });

  it('rounds the weighted mean to whole days', () => {
    // (10 * 1000 + 11 * 1000) / 2000 = 10.5 → 11
    expect(
      deriveCollectionSlip({
        receivables: [collected(10, 1000), collected(11, 1000)],
        minSampleSize: 2,
      }).slipDays,
    ).toBe(11);

    // (10 * 3000 + 11 * 1000) / 4000 = 10.25 → 10
    expect(
      deriveCollectionSlip({
        receivables: [collected(10, 3000), collected(11, 1000)],
        minSampleSize: 2,
      }).slipDays,
    ).toBe(10);
  });

  it('lets early payments pull the mean down but never below zero', () => {
    const receivables = [collected(-20, 5000), collected(-10, 5000)];
    expect(deriveCollectionSlip({ receivables, minSampleSize: 2 })).toEqual({
      slipDays: 0,
      sampleSize: 2,
      confidence: 'measured',
    });
  });

  it('clamps a pathologically slow payer to the ceiling', () => {
    const receivables = [collected(120, 5000), collected(150, 5000)];
    expect(deriveCollectionSlip({ receivables, minSampleSize: 2 }).slipDays).toBe(
      MAX_COLLECTION_SLIP_DAYS,
    );
  });

  it('measures from the LAST payment of a partially-then-fully collected invoice', () => {
    const receivable = {
      dueDate: DUE,
      openAmount: 0,
      status: 'settled',
      payments: [
        { date: addDays(DUE, 5), amount: 1000 },
        { date: addDays(DUE, 40), amount: 3000 },
        { date: addDays(DUE, 20), amount: 2000 },
      ],
    };
    expect(deriveCollectionSlip({ receivables: [receivable], minSampleSize: 1 })).toEqual({
      slipDays: 40,
      sampleSize: 1,
      confidence: 'measured',
    });
  });

  it('weights an invoice by everything that was actually collected on it', () => {
    // 6000 collected 40 days late outweighs 1000 collected on time.
    const slow = {
      dueDate: DUE,
      openAmount: 0,
      status: 'settled',
      payments: [
        { date: addDays(DUE, 40), amount: 3000 },
        { date: addDays(DUE, 40), amount: 3000 },
      ],
    };
    const result = deriveCollectionSlip({
      receivables: [slow, collected(0, 1000)],
      minSampleSize: 2,
    });
    // (40 * 6000 + 0 * 1000) / 7000 = 34.28 → 34
    expect(result.slipDays).toBe(34);
  });

  it('treats dust left on an invoice as fully collected', () => {
    const receivables = sample(MIN_COLLECTION_SLIP_SAMPLE, 20).map((doc) => ({
      ...doc,
      openAmount: 0.004,
    }));
    expect(deriveCollectionSlip({ receivables })).toMatchObject({
      slipDays: 20,
      sampleSize: MIN_COLLECTION_SLIP_SAMPLE,
    });
  });

  it('accepts a custom open-amount reader', () => {
    const receivables = sample(MIN_COLLECTION_SLIP_SAMPLE, 20).map((doc) => ({
      ...doc,
      openAmount: 999,
      remaining: 0,
    }));
    expect(deriveCollectionSlip({ receivables })).toMatchObject({ sampleSize: 0 });
    expect(
      deriveCollectionSlip({ receivables, openAmountOf: (doc) => doc.remaining }),
    ).toMatchObject({ sampleSize: MIN_COLLECTION_SLIP_SAMPLE, slipDays: 20 });
  });
});

// ─── what carries no signal must not become signal ────────────────────────────

describe('deriveCollectionSlip exclusions', () => {
  const noise = (extra) => [...sample(MIN_COLLECTION_SLIP_SAMPLE, 20), { ...collected(60, 90000), ...extra }];

  const measuredOn = (receivables) => deriveCollectionSlip({ receivables });

  it('ignores receivables with no due date', () => {
    expect(measuredOn(noise({ dueDate: undefined }))).toMatchObject({
      slipDays: 20,
      sampleSize: MIN_COLLECTION_SLIP_SAMPLE,
    });
    expect(measuredOn(noise({ dueDate: '02/04/2026' }))).toMatchObject({ slipDays: 20 });
  });

  it('ignores receivables with no payments at all', () => {
    expect(measuredOn(noise({ payments: [] }))).toMatchObject({ slipDays: 20 });
    expect(measuredOn(noise({ payments: undefined }))).toMatchObject({ slipDays: 20 });
    expect(measuredOn(noise({ payments: 'many' }))).toMatchObject({ slipDays: 20 });
  });

  it('ignores payments with no usable date', () => {
    expect(measuredOn(noise({ payments: [{ amount: 90000 }] }))).toMatchObject({ slipDays: 20 });
    expect(measuredOn(noise({ payments: [{ date: null, amount: 90000 }] }))).toMatchObject({
      slipDays: 20,
    });
  });

  it('ignores invoices that are still open — their collection date is not known yet', () => {
    expect(measuredOn(noise({ openAmount: 5000, status: 'partial' }))).toMatchObject({
      slipDays: 20,
      sampleSize: MIN_COLLECTION_SLIP_SAMPLE,
    });
  });

  it('ignores cancelled and void invoices even though they carry payments', () => {
    expect(measuredOn(noise({ status: 'cancelled' }))).toMatchObject({ slipDays: 20 });
    expect(measuredOn(noise({ status: 'void' }))).toMatchObject({ slipDays: 20 });
    expect(measuredOn(noise({ status: 'CANCELLED' }))).toMatchObject({ slipDays: 20 });
  });

  it('ignores invoices with no collected amount to weight by', () => {
    expect(measuredOn(noise({ payments: [{ date: addDays(DUE, 60), amount: 0 }] }))).toMatchObject({
      slipDays: 20,
    });
    expect(
      measuredOn(noise({ payments: [{ date: addDays(DUE, 60), amount: 'lots' }] })),
    ).toMatchObject({ slipDays: 20 });
  });

  it('drops mis-keyed dates outside the observable window instead of trusting them', () => {
    const typo = { ...collected(0, 90000), payments: [{ date: '3026-04-02', amount: 90000 }] };
    expect(measuredOn([...sample(MIN_COLLECTION_SLIP_SAMPLE, 20), typo])).toEqual({
      slipDays: 20,
      sampleSize: MIN_COLLECTION_SLIP_SAMPLE,
      confidence: 'measured',
    });

    const stillInside = collected(OBSERVABLE_SLIP_WINDOW_DAYS, 90000);
    expect(
      measuredOn([...sample(MIN_COLLECTION_SLIP_SAMPLE, 20), stillInside]).sampleSize,
    ).toBe(MIN_COLLECTION_SLIP_SAMPLE + 1);
  });

  it('never mutates or re-orders the caller\'s documents', () => {
    const receivables = [collected(5, 100), collected(1, 100)];
    const snapshot = JSON.parse(JSON.stringify(receivables));
    deriveCollectionSlip({ receivables, minSampleSize: 1 });
    expect(receivables).toEqual(snapshot);
  });
});

// ─── the company's real history (July 2026 production backup) ─────────────────

describe('deriveCollectionSlip against the real collection history', () => {
  // [days after due date, amount collected] for every fully collected receivable
  // in backups/firestore-backup-2026-07-27. 91.5% of the money is Insyte paid
  // through confirming, so this is one payer's behaviour, not an average of
  // unrelated customers. Median 25 days, unweighted mean 16 — the weighted
  // figure is the one that decides whether the cash lands in time.
  const HISTORY = [
    [-24, 79.99], [-7, 79.99], [-7, 79.99], [-6, 67.22],
    [-3, 71.40], [-3, 79.99], [-3, 79.99], [-3, 159.98],
    [-3, 159.98], [-2, 79.99], [0, 67.22], [0, 159.98],
    [3, 67.22], [3, 79.99], [3, 159.98], [7, 79.99],
    [9, 23376.00], [13, 67.22], [15, 134.44], [16, 34845.74],
    [17, 79.99], [23, 2024.00], [23, 9510.00], [24, 1705.00],
    [24, 3900.00], [24, 4230.00], [25, 230.00], [25, 354.00],
    [25, 460.00], [25, 819.00], [25, 819.00], [25, 867.00],
    [25, 933.00], [25, 1365.00], [25, 1375.80], [25, 1383.00],
    [25, 1675.80], [25, 1705.00], [25, 2150.40], [25, 2232.60],
    [25, 2484.00], [25, 2493.00], [25, 3900.00], [25, 4230.00],
    [25, 5821.20], [25, 6741.60], [26, 67.22], [29, 2184.00],
    [32, 14100.00], [37, 819.00], [37, 1724.40], [37, 2184.00],
    [44, 1110.00],
  ];

  it('measures 21 days, three weeks later than the hardcoded assumption', () => {
    const receivables = HISTORY.map(([delay, amount]) => collected(delay, amount));
    expect(deriveCollectionSlip({ receivables })).toEqual({
      slipDays: 21,
      sampleSize: 53,
      confidence: 'measured',
    });
    expect(COLLECTION_SLIP_DAYS).toBe(7); // what the forecast used to assume
  });

  it('still falls back on the first few invoices of that history', () => {
    const receivables = HISTORY.slice(0, 4).map(([delay, amount]) => collected(delay, amount));
    expect(deriveCollectionSlip({ receivables })).toMatchObject({
      slipDays: COLLECTION_SLIP_DAYS,
      confidence: 'default',
    });
  });
});
