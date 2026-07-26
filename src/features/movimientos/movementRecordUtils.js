/**
 * Adapts a bank movement into the canonical record shape consumed by
 * CanonicalRecordModal. Mirrors buildFinanceOrderRecord in
 * src/features/financeOrders/orderRecordUtils.js for the CXC/CXP families.
 */
export const buildMovementEditRecord = (movement) => {
  if (!movement) return null;
  return {
    ...movement,
    id: `movement:${movement.id}`,
    entityId: movement.id,
    rawRecord: movement,
    recordFamily: 'movement',
    recordFamilyLabel: 'Banco',
    date: movement.postedDate || movement.valueDate,
    amount: Number(movement.amount) || 0,
    // Display label only. `kind` ("payment" / "collection" / "adjustment") is an
    // internal movement family, not a category — it used to land here and then
    // got persisted as `categoryName`, marking uncategorized DATEV rows as
    // classified. The raw movement (kind included) stays in `rawRecord`.
    categoryLabel: movement.categoryName || 'Movimiento bancario',
    canEdit: movement.status !== 'void',
  };
};

export default buildMovementEditRecord;
