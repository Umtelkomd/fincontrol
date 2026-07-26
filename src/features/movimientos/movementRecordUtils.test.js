import { describe, expect, it } from 'vitest';

import { buildMovementEditRecord } from './movementRecordUtils.js';

/**
 * The edit record feeds CanonicalRecordModal. `kind` is an internal movement
 * family ("payment" / "collection" / "adjustment"), never a category, so it
 * must not travel in a field the modal can persist as `categoryName`.
 */
describe('buildMovementEditRecord — category label', () => {
  it('does not expose the movement kind as a category label', () => {
    const record = buildMovementEditRecord({
      id: 'mov-1',
      kind: 'payment',
      direction: 'out',
      amount: 120,
      postedDate: '2026-05-08',
      categoryName: '',
    });

    expect(record.categoryLabel).not.toBe('payment');
    expect(record.categoryLabel).toBe('Movimiento bancario');
  });

  it('does not expose the collection kind either', () => {
    const record = buildMovementEditRecord({
      id: 'mov-2',
      kind: 'collection',
      direction: 'in',
      amount: 900,
      postedDate: '2026-05-09',
    });

    expect(record.categoryLabel).not.toBe('collection');
  });

  it('uses the real category when the movement is classified', () => {
    const record = buildMovementEditRecord({
      id: 'mov-3',
      kind: 'payment',
      direction: 'out',
      amount: 50,
      postedDate: '2026-05-10',
      categoryName: 'Material',
    });

    expect(record.categoryLabel).toBe('Material');
  });

  it('keeps the raw movement (with its kind) available for the modal', () => {
    const movement = { id: 'mov-4', kind: 'adjustment', direction: 'in', amount: 10, postedDate: '2026-05-11' };
    const record = buildMovementEditRecord(movement);

    expect(record.rawRecord).toBe(movement);
    expect(record.rawRecord.kind).toBe('adjustment');
  });

  it('keeps the canonical record envelope', () => {
    const record = buildMovementEditRecord({
      id: 'mov-5',
      direction: 'in',
      amount: '42.5',
      valueDate: '2026-05-12',
      status: 'void',
    });

    expect(record).toMatchObject({
      id: 'movement:mov-5',
      entityId: 'mov-5',
      recordFamily: 'movement',
      recordFamilyLabel: 'Banco',
      date: '2026-05-12',
      amount: 42.5,
      canEdit: false,
    });
  });

  it('returns null without a movement', () => {
    expect(buildMovementEditRecord(null)).toBeNull();
  });
});
