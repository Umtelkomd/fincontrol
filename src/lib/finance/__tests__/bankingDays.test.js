import { describe, expect, it } from 'vitest';
import {
  bankBusinessDaysBetween,
  computeEasterSunday,
  germanBankHolidays,
  isBankBusinessDay,
  nextBankBusinessDay,
  nthLastBankBusinessDayOfMonth,
} from '../bankingDays.js';

// ─── computeEasterSunday (Gauss / anonymous Gregorian algorithm) ──────────────

describe('computeEasterSunday', () => {
  it('matches the real Ostersonntag dates 2025–2027', () => {
    expect(computeEasterSunday(2025)).toBe('2025-04-20');
    expect(computeEasterSunday(2026)).toBe('2026-04-05');
    expect(computeEasterSunday(2027)).toBe('2027-03-28');
  });
});

// ─── germanBankHolidays — nationwide + Mecklenburg-Vorpommern ─────────────────

describe('germanBankHolidays', () => {
  const holidays2026 = germanBankHolidays(2026);

  it('includes the fixed-date holidays', () => {
    expect(holidays2026.has('2026-01-01')).toBe(true); // New Year
    expect(holidays2026.has('2026-05-01')).toBe(true); // Labour Day
    expect(holidays2026.has('2026-10-03')).toBe(true); // German Unity Day
    expect(holidays2026.has('2026-10-31')).toBe(true); // Reformation Day (M-V)
    expect(holidays2026.has('2026-12-25')).toBe(true); // Christmas Day
    expect(holidays2026.has('2026-12-26')).toBe(true); // Boxing Day
  });

  it('includes the Easter-derived holidays for 2026', () => {
    expect(holidays2026.has('2026-04-03')).toBe(true); // Good Friday (Easter - 2)
    expect(holidays2026.has('2026-04-06')).toBe(true); // Easter Monday (Easter + 1)
    expect(holidays2026.has('2026-05-14')).toBe(true); // Ascension (Easter + 39)
    expect(holidays2026.has('2026-05-25')).toBe(true); // Whit Monday (Easter + 50)
  });

  it('includes International Womens Day for M-V from 2023 on', () => {
    // M-V public holiday since 2023 — the production banking calendar in
    // src/features/nominas/lib/bankingCalendar.js honors it; so does this one.
    expect(holidays2026.has('2026-03-08')).toBe(true);
    expect(germanBankHolidays(2022).has('2022-03-08')).toBe(false);
  });

  it('excludes holidays that do not apply in M-V', () => {
    expect(holidays2026.has('2026-06-04')).toBe(false); // Corpus Christi
    expect(holidays2026.has('2026-11-01')).toBe(false); // All Saints
  });
});

// ─── isBankBusinessDay ─────────────────────────────────────────────────────────

describe('isBankBusinessDay', () => {
  it('rejects weekends', () => {
    expect(isBankBusinessDay('2026-07-04')).toBe(false); // Saturday
    expect(isBankBusinessDay('2026-07-05')).toBe(false); // Sunday
  });

  it('rejects public holidays', () => {
    expect(isBankBusinessDay('2026-05-01')).toBe(false); // Labour Day (Friday)
    expect(isBankBusinessDay('2026-05-25')).toBe(false); // Whit Monday
  });

  it('rejects Christmas Eve and New Years Eve (banks closed for SV purposes)', () => {
    expect(isBankBusinessDay('2026-12-24')).toBe(false);
    expect(isBankBusinessDay('2026-12-31')).toBe(false);
  });

  it('accepts plain weekdays', () => {
    expect(isBankBusinessDay('2026-07-09')).toBe(true); // Thursday
    expect(isBankBusinessDay('2026-12-28')).toBe(true); // Monday between the closures
  });

  it('rejects invalid input', () => {
    expect(isBankBusinessDay(null)).toBe(false);
    expect(isBankBusinessDay('not-a-date')).toBe(false);
  });
});

// ─── nextBankBusinessDay — first business day ON or AFTER the date ────────────

describe('nextBankBusinessDay', () => {
  it('returns the same day when it already is a business day', () => {
    expect(nextBankBusinessDay('2026-07-09')).toBe('2026-07-09');
  });

  it('skips a weekend', () => {
    expect(nextBankBusinessDay('2026-05-10')).toBe('2026-05-11'); // Sunday → Monday
  });

  it('skips the full Easter block', () => {
    // Good Friday 2026-04-03 → Sat, Sun (Easter), Easter Monday → Tue 2026-04-07.
    expect(nextBankBusinessDay('2026-04-03')).toBe('2026-04-07');
  });
});

// ─── nthLastBankBusinessDayOfMonth ─────────────────────────────────────────────

describe('nthLastBankBusinessDayOfMonth', () => {
  it('finds the third-to-last bank business day (SV Faelligkeit)', () => {
    expect(nthLastBankBusinessDayOfMonth('2026-05', 3)).toBe('2026-05-27');
    expect(nthLastBankBusinessDayOfMonth('2026-06', 3)).toBe('2026-06-26');
    expect(nthLastBankBusinessDayOfMonth('2026-04', 3)).toBe('2026-04-28');
  });

  it('honors the Dec 24/31 closures in December', () => {
    expect(nthLastBankBusinessDayOfMonth('2026-12', 3)).toBe('2026-12-28');
  });

  it('finds the last bank business day (net wages date)', () => {
    expect(nthLastBankBusinessDayOfMonth('2026-04', 1)).toBe('2026-04-30');
    expect(nthLastBankBusinessDayOfMonth('2026-05', 1)).toBe('2026-05-29');
  });

  it('returns null for invalid month keys', () => {
    expect(nthLastBankBusinessDayOfMonth('2026-13', 3)).toBeNull();
    expect(nthLastBankBusinessDayOfMonth('', 3)).toBeNull();
  });
});

// ─── bankBusinessDaysBetween — count in (fromExclusive, toInclusive] ──────────

describe('bankBusinessDaysBetween', () => {
  it('counts business days strictly after from, up to and including to', () => {
    // Fri 2026-07-03 → Thu 2026-07-09: Mon 6, Tue 7, Wed 8, Thu 9.
    expect(bankBusinessDaysBetween('2026-07-03', '2026-07-09')).toBe(4);
    expect(bankBusinessDaysBetween('2026-07-03', '2026-07-06')).toBe(1);
  });

  it('returns 0 when only non-business days lie in between', () => {
    expect(bankBusinessDaysBetween('2026-07-03', '2026-07-05')).toBe(0); // Sat + Sun
  });

  it('returns 0 for same date or inverted ranges', () => {
    expect(bankBusinessDaysBetween('2026-07-09', '2026-07-09')).toBe(0);
    expect(bankBusinessDaysBetween('2026-07-09', '2026-07-03')).toBe(0);
  });
});
