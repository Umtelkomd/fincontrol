import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { installFirebaseMocks, TEST_USER } from '@/test/firebaseMock';
import { payableFixture, receivableFixture } from '@/test/fixtures';

const RECEIVABLE = receivableFixture({
  id: 'cxc-category',
  categoryName: 'Services',
});
const PAYABLE = payableFixture({
  id: 'cxp-category',
  categoryName: 'Materials',
});

const store = installFirebaseMocks({
  collections: {
    receivables: [RECEIVABLE],
    payables: [PAYABLE],
  },
});

const firestore = await import('firebase/firestore');
const { buildInitialFormData } = await import('../components/finance/canonicalRecordForm.js');
const { buildFinanceOrderRecord } = await import('../features/financeOrders/orderRecordUtils.js');
const { usePayables } = await import('./usePayables.js');
const { useReceivables } = await import('./useReceivables.js');

const editableData = (document, overrides = {}) => ({
  amount: document.grossAmount ?? document.amount,
  issueDate: document.issueDate,
  dueDate: document.dueDate,
  description: document.description,
  counterpartyName: document.counterpartyName,
  documentNumber: document.documentNumber,
  projectId: document.projectId,
  projectName: document.projectName,
  costCenterId: document.costCenterId || '',
  ...overrides,
});

const updatePayload = (collectionName) =>
  firestore.updateDoc.mock.calls.find(([ref]) => ref.path.includes(`/${collectionName}/`))?.[1];

const mount = async (useDocuments, key) => {
  const { result } = renderHook(() => useDocuments(TEST_USER));
  await waitFor(() => expect(result.current.loading).toBe(false));
  return { result, document: result.current[key][0] };
};

beforeEach(() => {
  store.collections.receivables = [RECEIVABLE];
  store.collections.payables = [PAYABLE];
  firestore.updateDoc.mockClear();
});

describe.each([
  {
    family: 'receivable',
    collectionName: 'receivables',
    stored: RECEIVABLE,
    useDocuments: useReceivables,
    key: 'receivables',
    updateName: 'updateReceivable',
  },
  {
    family: 'payable',
    collectionName: 'payables',
    stored: PAYABLE,
    useDocuments: usePayables,
    key: 'payables',
    updateName: 'updatePayable',
  },
])('$family category updates', ({
  family,
  collectionName,
  stored,
  useDocuments,
  key,
  updateName,
}) => {
  it('loads the stored category into the ordinary edit form', async () => {
    const { document } = await mount(useDocuments, key);
    const form = buildInitialFormData(buildFinanceOrderRecord(document, family));

    expect(form.categoryName).toBe(stored.categoryName);
  });

  it('does not overwrite the stored category when categoryName is omitted', async () => {
    const { result, document } = await mount(useDocuments, key);

    await act(async () => {
      await result.current[updateName](document, editableData(document));
    });

    expect(updatePayload(collectionName)).not.toHaveProperty('categoryName');
  });

  it.each(['Other', ''])('writes an explicitly provided category value %j', async (categoryName) => {
    const { result, document } = await mount(useDocuments, key);

    await act(async () => {
      await result.current[updateName](
        document,
        editableData(document, { categoryName }),
      );
    });

    expect(updatePayload(collectionName)).toHaveProperty('categoryName', categoryName);
  });
});
