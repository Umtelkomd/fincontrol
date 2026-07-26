/**
 * Seed values for the CanonicalRecordModal form.
 *
 * Kept out of the component file so it can be unit tested (and because a
 * component module may only export components — react-refresh).
 */
export const buildInitialFormData = (record) => ({
  direction: record?.rawRecord?.direction || 'in',
  amount: String(record?.amount ?? ''),
  postedDate: record?.rawRecord?.postedDate || record?.date || '',
  issueDate: record?.rawRecord?.issueDate || record?.date || '',
  dueDate: record?.rawRecord?.dueDate || '',
  description: record?.rawRecord?.description || record?.description || '',
  counterpartyName: record?.rawRecord?.counterpartyName || record?.counterpartyName || '',
  documentNumber: record?.rawRecord?.documentNumber || record?.documentNumber || '',
  projectId: record?.rawRecord?.projectId || '',
  costCenterId: record?.rawRecord?.costCenterId || '',
  // `categoryLabel` is a DISPLAY label for the record family ("payment",
  // "Factura CXP", "Registro histórico") — never a real category. Seeding this
  // editable field from it persisted those labels as `categoryName` on save,
  // marking uncategorized rows as classified. Only real category fields may
  // seed it: canonical rows carry `categoryName`, legacy 2025 rows `category`.
  categoryName: record?.rawRecord?.categoryName || record?.rawRecord?.category || '',
  forceStatus: '',
  correctionReason: '',
});

export default buildInitialFormData;
