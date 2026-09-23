/**
 * Firestore collections captured by scripts/exportFirestoreBackup.mjs.
 *
 * Kept as its own side-effect-free constant so the export script's coverage
 * can be asserted on without ever importing the script itself — it talks to
 * Firestore at module load (service-account read, `await db.collection(...)
 * .get()`), so merely importing it in a test would make a real network call.
 *
 * `employees` is deliberately excluded: it carries personal/salary data and
 * has no place in an operational backup exported ahead of a schema migration.
 */
export const BACKUP_COLLECTIONS = Object.freeze([
  'transactions',
  'receivables',
  'payables',
  'bankMovements',
  'bankReconciliation',
  'budgets',
  'projects',
  'costCenters',
  'classificationRules',
  // Executed-not-invoiced work per obra: a project merge rewrites it, so a
  // rollback needs it in the same snapshot as the projects themselves.
  'workInProgress',
  // Singleton settings docs (categories, vatRates, reconciliation, treasury,
  // bankAccount, overhead, ...) all live as documents inside this one
  // collection, so listing it captures every one of them with no change to
  // how the export script reads a collection.
  'settings',
]);
