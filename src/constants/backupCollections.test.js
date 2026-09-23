import { describe, expect, it } from 'vitest';

import { BACKUP_COLLECTIONS } from './backupCollections.js';

describe('BACKUP_COLLECTIONS', () => {
  it('keeps every original ledger collection scripts/exportFirestoreBackup.mjs already captured', () => {
    expect(BACKUP_COLLECTIONS).toEqual(
      expect.arrayContaining(['transactions', 'receivables', 'payables', 'bankMovements', 'bankReconciliation', 'budgets']),
    );
  });

  it('adds the classification catalogue collections a migration needs to roll back from', () => {
    expect(BACKUP_COLLECTIONS).toEqual(
      expect.arrayContaining(['projects', 'costCenters', 'classificationRules', 'settings']),
    );
  });

  it('captures work in progress, which a project merge rewrites', () => {
    expect(BACKUP_COLLECTIONS).toContain('workInProgress');
  });

  it('never includes employees, which carries personal/salary data', () => {
    expect(BACKUP_COLLECTIONS).not.toContain('employees');
  });

  it('is frozen so no caller can mutate the shared list', () => {
    expect(Object.isFrozen(BACKUP_COLLECTIONS)).toBe(true);
  });
});
