import { describe, expect, it } from 'vitest';
import {
  computeEaster,
  mvHolidays,
  isBankingDay,
  nextBankingDay,
  previousBankingDay,
  nthToLastBankingDayOfMonth,
  bankingDaysBetween,
} from './bankingCalendar.js';

// ─── computeEaster (Gauss / Anonymous algorithm) ──────────────────────────────
// Known Ostersonntag anchors validate the algorithm across years.

describe('computeEaster', () => {
  it('returns Ostersonntag 2026 as 2026-04-05', () => {
    expect(computeEaster(2026)).toBe('2026-04-05');
  });
  it('returns Ostersonntag 2027 as 2027-03-28', () => {
    expect(computeEaster(2027)).toBe('2027-03-28');
  });
  it('returns Ostersonntag 2024 as 2024-03-31', () => {
    expect(computeEaster(2024)).toBe('2024-03-31');
  });
  it('returns Ostersonntag 2025 as 2025-04-20', () => {
    expect(computeEaster(2025)).toBe('2025-04-20');
  });
});

// ─── mvHolidays (Mecklenburg-Vorpommern public holidays) ──────────────────────

describe('mvHolidays', () => {
  const holidays2026 = mvHolidays(2026);

  it('includes fixed M-V holidays', () => {
    expect(holidays2026.has('2026-01-01')).toBe(true); // Neujahr
    expect(holidays2026.has('2026-03-08')).toBe(true); // Internationaler Frauentag (M-V since 2023)
    expect(holidays2026.has('2026-05-01')).toBe(true); // Tag der Arbeit
    expect(holidays2026.has('2026-10-03')).toBe(true); // Tag der Deutschen Einheit
    expect(holidays2026.has('2026-10-31')).toBe(true); // Reformationstag (always in M-V)
    expect(holidays2026.has('2026-12-25')).toBe(true); // 1. Weihnachtsfeiertag
    expect(holidays2026.has('2026-12-26')).toBe(true); // 2. Weihnachtsfeiertag
  });

  it('includes Easter-derived holidays for 2026', () => {
    expect(holidays2026.has('2026-04-03')).toBe(true); // Karfreitag (Easter-2)
    expect(holidays2026.has('2026-04-06')).toBe(true); // Ostermontag (Easter+1)
    expect(holidays2026.has('2026-05-14')).toBe(true); // Christi Himmelfahrt (Easter+39)
    expect(holidays2026.has('2026-05-25')).toBe(true); // Pfingstmontag (Easter+50)
  });

  it('does NOT include non-M-V holidays like Fronleichnam or Allerheiligen', () => {
    // Fronleichnam 2026 = Easter+60 = 2026-06-04; Allerheiligen = 11-01
    expect(holidays2026.has('2026-06-04')).toBe(false);
    expect(holidays2026.has('2026-11-01')).toBe(false);
  });

  it('does not include Internationaler Frauentag before 2023', () => {
    const holidays2022 = mvHolidays(2022);
    expect(holidays2022.has('2022-03-08')).toBe(false);
  });
});

// ─── isBankingDay ─────────────────────────────────────────────────────────────

describe('isBankingDay', () => {
  it('returns false for Saturday', () => {
    expect(isBankingDay('2026-04-04')).toBe(false); // Saturday
  });
  it('returns false for Sunday', () => {
    expect(isBankingDay('2026-04-05')).toBe(false); // Sunday (also Easter)
  });
  it('returns false for a weekday holiday', () => {
    expect(isBankingDay('2026-05-01')).toBe(false); // Tag der Arbeit (Friday)
  });
  it('returns true for an ordinary Tuesday', () => {
    expect(isBankingDay('2026-04-07')).toBe(true); // Tuesday after Ostermontag
  });
});

// ─── nextBankingDay / previousBankingDay ──────────────────────────────────────

describe('nextBankingDay', () => {
  it('shifts a Saturday to the following Monday', () => {
    expect(nextBankingDay('2026-04-04')).toBe('2026-04-07'); // Sat → Mon (Mon=Ostermontag holiday, so Tue)
  });
  it('shifts a Sunday past a holiday Monday', () => {
    // 2026-05-24 Sunday → 05-25 Pfingstmontag (holiday) → 05-26 Tuesday
    expect(nextBankingDay('2026-05-24')).toBe('2026-05-26');
  });
  it('returns the same day when already a banking day', () => {
    expect(nextBankingDay('2026-04-07')).toBe('2026-04-07');
  });
});

describe('previousBankingDay', () => {
  it('shifts a Sunday back to Friday', () => {
    expect(previousBankingDay('2026-04-12')).toBe('2026-04-10'); // Sun → Fri
  });
  it('shifts across a holiday-adjacent weekend (Friday holiday)', () => {
    // 2026-05-03 Sunday → 05-02 Sat → 05-01 Fri (Tag der Arbeit) → 04-30 Thu
    expect(previousBankingDay('2026-05-03')).toBe('2026-04-30');
  });
});

// ─── nthToLastBankingDayOfMonth (drittletzter Bankarbeitstag) ──────────────────

describe('nthToLastBankingDayOfMonth', () => {
  it('returns the 3rd-to-last banking day of April 2026', () => {
    // April 2026 ends Thu 30. Last 3 banking days: 30 (Thu), 29 (Wed), 28 (Tue).
    // 3rd-to-last = 2026-04-28.
    expect(nthToLastBankingDayOfMonth(2026, 4, 3)).toBe('2026-04-28');
  });
  it('skips trailing weekend (month ends on a weekend)', () => {
    // May 2026 ends Sun 31. Banking days from end: Fri 29, Thu 28, Wed 27 …
    // 3rd-to-last = 2026-05-27.
    expect(nthToLastBankingDayOfMonth(2026, 5, 3)).toBe('2026-05-27');
  });
  it('skips Silvester, Weihnachten + weekend (December 2026)', () => {
    // Dec 2026: 31 Thu (Silvester — bank-closed), 30 Wed, 29 Tue, 28 Mon,
    // 27 Sun, 26 Sat (2.Weihn), 25 Fri (1.Weihn), 24 Thu (Heiligabend — closed).
    // Banking days from end: 30, 29, 28 → 3rd-to-last (drittletzter) = 2026-12-28.
    expect(nthToLastBankingDayOfMonth(2026, 12, 3)).toBe('2026-12-28');
  });
  it('1st-to-last is the last banking day of the month', () => {
    expect(nthToLastBankingDayOfMonth(2026, 4, 1)).toBe('2026-04-30');
  });
});

// ─── bankingDaysBetween ───────────────────────────────────────────────────────

describe('bankingDaysBetween', () => {
  it('counts banking days between two dates exclusive of weekends/holidays', () => {
    // Tue 2026-04-07 → Fri 2026-04-10: 07,08,09,10 are all banking days → 3 steps
    expect(bankingDaysBetween('2026-04-07', '2026-04-10')).toBe(3);
  });
  it('returns negative for a past target', () => {
    expect(bankingDaysBetween('2026-04-10', '2026-04-07')).toBe(-3);
  });
  it('returns 0 for the same day', () => {
    expect(bankingDaysBetween('2026-04-07', '2026-04-07')).toBe(0);
  });
  it('does not count a weekend gap as banking days', () => {
    // Fri 2026-04-10 → Mon 2026-04-13: Sat/Sun are not banking days → 1 step
    expect(bankingDaysBetween('2026-04-10', '2026-04-13')).toBe(1);
  });
});
