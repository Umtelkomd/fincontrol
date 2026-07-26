import { describe, expect, it } from 'vitest';

import {
  coverageBarWidth,
  coverageTone,
  formatCoverageSummary,
} from './coverageSummary.js';

/**
 * Presentation layer on top of `classificationCoverage`. The ledger sits near
 * 7% classified and nobody notices, so these helpers must render the number
 * verbatim — no rounding up, no optimistic defaults.
 */
describe('formatCoverageSummary', () => {
  it('renders the classified / total ratio with a Spanish decimal separator', () => {
    expect(formatCoverageSummary({ total: 1576, classified: 112, pct: 7.1 })).toBe(
      '112 de 1576 movimientos clasificados (7,1%)',
    );
  });

  it('drops the decimal when the percentage is whole', () => {
    expect(formatCoverageSummary({ total: 4, classified: 2, pct: 50 })).toBe(
      '2 de 4 movimientos clasificados (50%)',
    );
  });

  it('reports an empty ledger instead of throwing', () => {
    expect(formatCoverageSummary(null)).toBe('0 de 0 movimientos clasificados (0%)');
    expect(formatCoverageSummary({})).toBe('0 de 0 movimientos clasificados (0%)');
  });
});

describe('coverageBarWidth', () => {
  it('returns a CSS width using a dot separator', () => {
    expect(coverageBarWidth({ pct: 7.1 })).toBe('7.1%');
  });

  it('clamps out-of-range percentages', () => {
    expect(coverageBarWidth({ pct: 120 })).toBe('100%');
    expect(coverageBarWidth({ pct: -4 })).toBe('0%');
  });

  it('falls back to zero for missing or non-numeric input', () => {
    expect(coverageBarWidth(null)).toBe('0%');
    expect(coverageBarWidth({ pct: 'abc' })).toBe('0%');
  });
});

describe('coverageTone', () => {
  it('flags a mostly unclassified ledger as an error', () => {
    expect(coverageTone({ pct: 7.1 })).toBe('err');
  });

  it('warns while coverage is incomplete', () => {
    expect(coverageTone({ pct: 50 })).toBe('warn');
    expect(coverageTone({ pct: 89.9 })).toBe('warn');
  });

  it('reports ok once nearly everything is classified', () => {
    expect(coverageTone({ pct: 90 })).toBe('ok');
    expect(coverageTone({ pct: 100 })).toBe('ok');
  });

  it('treats missing coverage as an error', () => {
    expect(coverageTone(null)).toBe('err');
  });
});
