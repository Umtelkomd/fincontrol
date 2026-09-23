// @vitest-environment node
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { isPrePolicy, settledOn } = require('./settlementMatch.cjs');

describe('settledOn', () => {
  it('prefers the latest recorded payment date over updatedAt', () => {
    const doc = {
      updatedAt: '2026-09-23T10:00:00Z',
      payments: [{ date: '2026-03-27' }, { date: '2026-04-07' }],
    };

    expect(settledOn(doc)).toBe('2026-04-07');
  });

  it('keeps a legacy-tagged document on its due date, not the tag write', () => {
    const doc = {
      settlementEvidence: 'legacy-pre-policy',
      updatedAt: '2026-09-23T10:00:00Z',
      dueDate: '2026-04-01',
    };

    expect(settledOn(doc)).toBe('2026-04-01');
  });

  it('falls back to updatedAt, then dueDate', () => {
    expect(settledOn({ updatedAt: '2026-08-01T00:00:00Z', dueDate: '2026-07-01' })).toBe('2026-08-01');
    expect(settledOn({ dueDate: '2026-07-01' })).toBe('2026-07-01');
  });
});

describe('isPrePolicy', () => {
  it('stays legacy after the repair tag bumps updatedAt', () => {
    expect(isPrePolicy({ settlementEvidence: 'legacy-pre-policy', updatedAt: '2026-09-23T10:00:00Z' })).toBe(true);
  });

  it('dates an untagged document by its payments', () => {
    expect(isPrePolicy({ updatedAt: '2026-09-23T10:00:00Z', payments: [{ date: '2026-04-07' }] })).toBe(true);
    expect(isPrePolicy({ updatedAt: '2026-04-01T00:00:00Z', payments: [{ date: '2026-07-28' }] })).toBe(false);
  });
});
