import { describe, expect, it } from 'vitest';
import { collectionForFamily, sortByCreatedAtDesc } from './useInvoiceDocuments';

describe('collectionForFamily', () => {
  it('maps payable to the payables collection', () => {
    expect(collectionForFamily('payable')).toBe('payables');
  });

  it('maps receivable to the receivables collection', () => {
    expect(collectionForFamily('receivable')).toBe('receivables');
  });

  it('throws on an unknown family', () => {
    expect(() => collectionForFamily('other')).toThrow();
  });

  it('throws on a missing family', () => {
    expect(() => collectionForFamily(undefined)).toThrow();
  });
});

describe('sortByCreatedAtDesc', () => {
  it('sorts ISO string createdAt values newest first', () => {
    const docs = [
      { id: 'a', createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 'b', createdAt: '2026-03-01T00:00:00.000Z' },
      { id: 'c', createdAt: '2026-02-01T00:00:00.000Z' },
    ];
    expect(sortByCreatedAtDesc(docs).map((d) => d.id)).toEqual(['b', 'c', 'a']);
  });

  it('sorts Firestore Timestamp-like createdAt values (toDate()) newest first', () => {
    const ts = (iso) => ({ toDate: () => new Date(iso) });
    const docs = [
      { id: 'a', createdAt: ts('2026-01-01T00:00:00.000Z') },
      { id: 'b', createdAt: ts('2026-03-01T00:00:00.000Z') },
    ];
    expect(sortByCreatedAtDesc(docs).map((d) => d.id)).toEqual(['b', 'a']);
  });

  it('treats a missing createdAt as oldest', () => {
    const docs = [
      { id: 'a', createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 'b' },
    ];
    expect(sortByCreatedAtDesc(docs).map((d) => d.id)).toEqual(['a', 'b']);
  });

  it('does not mutate the input array', () => {
    const docs = [
      { id: 'a', createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 'b', createdAt: '2026-03-01T00:00:00.000Z' },
    ];
    const copy = [...docs];
    sortByCreatedAtDesc(docs);
    expect(docs).toEqual(copy);
  });

  it('returns an empty array for a non-array input', () => {
    expect(sortByCreatedAtDesc(null)).toEqual([]);
    expect(sortByCreatedAtDesc(undefined)).toEqual([]);
  });

  it('keeps a stable order between two documents with the same timestamp', () => {
    const docs = [
      { id: 'a', createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 'b', createdAt: '2026-01-01T00:00:00.000Z' },
    ];
    expect(sortByCreatedAtDesc(docs).map((d) => d.id)).toEqual(['a', 'b']);
  });
});
