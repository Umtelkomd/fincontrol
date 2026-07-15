import { describe, expect, it } from 'vitest';

import { sanitizeSnapshotDoc, sanitizeValue } from '../sanitizeFirestore.js';

// Minimal stand-in for a Firestore Timestamp: any object exposing toDate().
const timestampLike = (isoString) => ({
  toDate: () => new Date(isoString),
});

describe('sanitizeValue', () => {
  it('returns null and undefined unchanged', () => {
    expect(sanitizeValue(null)).toBeNull();
    expect(sanitizeValue(undefined)).toBeUndefined();
  });

  it('returns primitives unchanged, including falsy ones', () => {
    expect(sanitizeValue(0)).toBe(0);
    expect(sanitizeValue('')).toBe('');
    expect(sanitizeValue(false)).toBe(false);
    expect(sanitizeValue(true)).toBe(true);
    expect(sanitizeValue(42.5)).toBe(42.5);
    expect(sanitizeValue('hello')).toBe('hello');
  });

  it('converts Firestore Timestamp-like objects (toDate) to ISO strings', () => {
    expect(sanitizeValue(timestampLike('2026-01-15T10:30:00.000Z'))).toBe(
      '2026-01-15T10:30:00.000Z',
    );
  });

  it('converts Date instances to ISO strings', () => {
    expect(sanitizeValue(new Date('2026-03-01T00:00:00.000Z'))).toBe(
      '2026-03-01T00:00:00.000Z',
    );
  });

  it('treats objects whose toDate is not a function as plain objects', () => {
    expect(sanitizeValue({ toDate: 'not-a-function', a: 1 })).toEqual({
      toDate: 'not-a-function',
      a: 1,
    });
  });

  it('deep-sanitizes arrays, preserving order and nesting', () => {
    const input = [
      timestampLike('2026-01-01T00:00:00.000Z'),
      new Date('2026-02-01T00:00:00.000Z'),
      'text',
      7,
      [timestampLike('2026-03-01T00:00:00.000Z')],
    ];

    expect(sanitizeValue(input)).toEqual([
      '2026-01-01T00:00:00.000Z',
      '2026-02-01T00:00:00.000Z',
      'text',
      7,
      ['2026-03-01T00:00:00.000Z'],
    ]);
  });

  it('preserves null and undefined entries inside arrays', () => {
    expect(sanitizeValue([null, undefined, 1])).toEqual([null, undefined, 1]);
  });

  it('deep-sanitizes plain objects and keeps nested objects', () => {
    const input = {
      text: 'Payment received',
      date: timestampLike('2026-04-10T08:00:00.000Z'),
      amount: 40.13,
      meta: { by: 'jromero', at: timestampLike('2026-04-10T08:00:00.000Z') },
    };

    expect(sanitizeValue(input)).toEqual({
      text: 'Payment received',
      date: '2026-04-10T08:00:00.000Z',
      amount: 40.13,
      meta: { by: 'jromero', at: '2026-04-10T08:00:00.000Z' },
    });
  });

  it('drops object keys whose sanitized value is null or undefined', () => {
    expect(
      sanitizeValue({ keep: 0, alsoKeep: '', keepFalse: false, gone: null, alsoGone: undefined }),
    ).toEqual({ keep: 0, alsoKeep: '', keepFalse: false });
  });

  it('sanitizes objects nested inside arrays (note/payment items)', () => {
    const notes = [
      { text: 'note', createdAt: timestampLike('2026-05-01T12:00:00.000Z'), author: null },
    ];

    expect(sanitizeValue(notes)).toEqual([
      { text: 'note', createdAt: '2026-05-01T12:00:00.000Z' },
    ]);
  });
});

describe('sanitizeSnapshotDoc', () => {
  it('injects the document id', () => {
    expect(sanitizeSnapshotDoc('doc-1', {})).toMatchObject({ id: 'doc-1' });
  });

  it('converts top-level Timestamp-like fields to ISO strings', () => {
    const result = sanitizeSnapshotDoc('doc-2', {
      createdAt: timestampLike('2026-02-10T09:00:00.000Z'),
    });

    expect(result.createdAt).toBe('2026-02-10T09:00:00.000Z');
  });

  it('skips top-level plain objects such as viewedBy (React render guard)', () => {
    const result = sanitizeSnapshotDoc('doc-3', {
      description: 'Invoice',
      viewedBy: { 'user@example.com': true },
    });

    expect(result).not.toHaveProperty('viewedBy');
    expect(result.description).toBe('Invoice');
  });

  it('keeps top-level Date instances as-is', () => {
    const date = new Date('2026-06-01T00:00:00.000Z');
    const result = sanitizeSnapshotDoc('doc-4', { importedAt: date });

    expect(result.importedAt).toBe(date);
  });

  it('keeps top-level null and primitive fields as-is', () => {
    const result = sanitizeSnapshotDoc('doc-5', {
      amount: 0,
      category: null,
      paid: false,
      description: '',
    });

    expect(result).toEqual({
      id: 'doc-5',
      amount: 0,
      category: null,
      paid: false,
      description: '',
      notes: [],
      payments: [],
    });
  });

  it('deep-sanitizes top-level arrays, including notes and payments items', () => {
    const result = sanitizeSnapshotDoc('doc-6', {
      notes: [{ text: 'n1', at: timestampLike('2026-01-02T00:00:00.000Z'), removed: null }],
      payments: [{ amount: 10, date: timestampLike('2026-01-03T00:00:00.000Z') }],
      auditTrail: [{ action: 'create', at: timestampLike('2026-01-04T00:00:00.000Z') }],
    });

    expect(result.notes).toEqual([{ text: 'n1', at: '2026-01-02T00:00:00.000Z' }]);
    expect(result.payments).toEqual([{ amount: 10, date: '2026-01-03T00:00:00.000Z' }]);
    expect(result.auditTrail).toEqual([{ action: 'create', at: '2026-01-04T00:00:00.000Z' }]);
  });

  it('coerces missing or non-array notes and payments to empty arrays by default', () => {
    const result = sanitizeSnapshotDoc('doc-7', {
      notes: 'free text',
      payments: { nested: true },
    });

    expect(result.notes).toEqual([]);
    expect(result.payments).toEqual([]);
  });

  it('honors a custom arrayFields option', () => {
    const result = sanitizeSnapshotDoc(
      'doc-8',
      { history: { nested: true } },
      { arrayFields: ['history'] },
    );

    expect(result.history).toEqual([]);
    expect(result).not.toHaveProperty('notes');
    expect(result).not.toHaveProperty('payments');
  });
});
