import { describe, expect, it } from 'vitest';
import * as finance from '../index.js';

// ─── public surface — everything the app layer is allowed to import ───────────

describe('finance engine public surface', () => {
  it('re-exports every engine function', () => {
    const api = [
      // money
      'roundEur',
      'isOpenAmount',
      'openAmountOf',
      // movements
      'signedAmountOf',
      'isInternalTransfer',
      // cash position
      'deriveBalance',
      'dailyBalanceSeries',
      'detectImportGap',
      // burn & runway
      'computeBurn',
      'computeRunway',
      // aging
      'agingBuckets',
      // obligations
      'buildObligationsCalendar',
      // forecast
      'forecastWeeks',
      // alerts
      'buildAlerts',
      // calendars
      'computeEasterSunday',
      'germanBankHolidays',
      'isBankBusinessDay',
      'nextBankBusinessDay',
      'nthLastBankBusinessDayOfMonth',
      'bankBusinessDaysBetween',
      'vatDueDate',
      'wageTaxDueDate',
      'socialSecurityDueDate',
      'netWagesDate',
    ];
    for (const name of api) {
      expect(typeof finance[name], `${name} should be exported as a function`).toBe('function');
    }
  });

  it('re-exports the shared constants', () => {
    expect(finance.OPEN_AMOUNT_EPSILON).toBe(0.005);
    expect(finance.CRITICAL_CREDITOR_PATTERN).toBeInstanceOf(RegExp);
  });
});
