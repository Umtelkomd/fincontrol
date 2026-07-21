import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonthKey,
  addMonthsToDate,
  diffDays,
  isIsoDate,
  isoWeekday,
  lastDayOfMonth,
  mondayOfWeek,
  monthKeyOf,
} from '../dates.js';

// ─── isIsoDate — strict 'YYYY-MM-DD' guard ─────────────────────────────────────

describe('isIsoDate', () => {
  it('accepts strict ISO calendar dates only', () => {
    expect(isIsoDate('2026-07-09')).toBe(true);
    expect(isIsoDate('2026-7-9')).toBe(false);
    expect(isIsoDate('2026-07-09T10:00:00Z')).toBe(false);
    expect(isIsoDate('')).toBe(false);
    expect(isIsoDate(null)).toBe(false);
    expect(isIsoDate(20260709)).toBe(false);
  });
});

// ─── addDays / diffDays — UTC math, immune to DST ─────────────────────────────

describe('addDays', () => {
  it('crosses month and year boundaries', () => {
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDays('2026-07-06', 7)).toBe('2026-07-13');
  });

  it('honors leap years', () => {
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2024-02-29', 1)).toBe('2024-03-01');
  });
});

describe('diffDays', () => {
  it('returns signed day distance from → to', () => {
    expect(diffDays('2026-07-01', '2026-07-10')).toBe(9);
    expect(diffDays('2026-07-10', '2026-07-01')).toBe(-9);
    expect(diffDays('2026-07-09', '2026-07-09')).toBe(0);
  });

  it('is stable across the European DST switch (pure UTC)', () => {
    expect(diffDays('2026-03-28', '2026-03-30')).toBe(2);
    expect(diffDays('2026-10-24', '2026-10-26')).toBe(2);
  });
});

// ─── isoWeekday / mondayOfWeek — Monday-start weeks ───────────────────────────

describe('isoWeekday', () => {
  it('returns 0=Sunday … 6=Saturday', () => {
    expect(isoWeekday('2026-07-06')).toBe(1); // Monday
    expect(isoWeekday('2026-07-04')).toBe(6); // Saturday
    expect(isoWeekday('2026-07-12')).toBe(0); // Sunday
  });
});

describe('mondayOfWeek', () => {
  it('snaps any day back to the Monday of its week', () => {
    expect(mondayOfWeek('2026-07-09')).toBe('2026-07-06'); // Thursday
    expect(mondayOfWeek('2026-07-06')).toBe('2026-07-06'); // Monday itself
    expect(mondayOfWeek('2026-07-12')).toBe('2026-07-06'); // Sunday belongs to the same week
  });
});

// ─── month-key helpers ─────────────────────────────────────────────────────────

describe('monthKeyOf', () => {
  it('extracts the YYYY-MM month key', () => {
    expect(monthKeyOf('2026-07-09')).toBe('2026-07');
  });
});

describe('addMonthKey', () => {
  it('adds months across year boundaries', () => {
    expect(addMonthKey('2026-11', 3)).toBe('2027-02');
    expect(addMonthKey('2026-01', -2)).toBe('2025-11');
    expect(addMonthKey('2026-05', 0)).toBe('2026-05');
  });
});

describe('lastDayOfMonth', () => {
  it('returns the last calendar day of a month key', () => {
    expect(lastDayOfMonth('2026-02')).toBe('2026-02-28');
    expect(lastDayOfMonth('2024-02')).toBe('2024-02-29');
    expect(lastDayOfMonth('2026-04')).toBe('2026-04-30');
    expect(lastDayOfMonth('2026-12')).toBe('2026-12-31');
  });
});

describe('addMonthsToDate', () => {
  it('moves whole months keeping the day of month', () => {
    expect(addMonthsToDate('2026-07-09', -3)).toBe('2026-04-09');
    expect(addMonthsToDate('2026-04-10', 2)).toBe('2026-06-10');
  });

  it('clamps to the last day of shorter target months', () => {
    expect(addMonthsToDate('2026-05-31', -3)).toBe('2026-02-28');
    expect(addMonthsToDate('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonthsToDate('2024-11-30', 3)).toBe('2025-02-28');
  });
});
