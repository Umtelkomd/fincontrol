/**
 * switchInvoiceSide — archive flip + obligation twin + original delete must
 * land in ONE batch, so the invoice is never half on each side.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { installFirebaseMocks, TEST_USER } from '@/test/firebaseMock';

const store = installFirebaseMocks({ collections: { invoiceDocuments: [] } });

const firestore = await import('firebase/firestore');
const { useInvoiceDocuments } = await import('./useInvoiceDocuments.js');

const SHA = 'a'.repeat(64);

const mount = async () => {
  const { result } = renderHook(() => useInvoiceDocuments(TEST_USER));
  await waitFor(() => expect(result.current.loading).toBe(false));
  return result;
};

const lastBatch = () => firestore.writeBatch.mock.results.at(-1).value;

const archivePatch = { direction: 'incoming', family: 'payable', identity: '["invoice-v2","incoming","W","1"]' };

beforeEach(() => {
  store.collections.invoiceDocuments = [];
  firestore.writeBatch.mockClear();
});

describe('switchInvoiceSide', () => {
  it('creates the twin, deletes the original and re-points the archive in one commit', async () => {
    const result = await mount();
    const outcome = await result.current.switchInvoiceSide(SHA, {
      valid: true,
      fromFamily: 'receivable',
      toFamily: 'payable',
      archivePatch,
      obligation: {
        fromFamily: 'receivable',
        id: 'cxc-1',
        payload: { vendor: 'W', grossAmount: 119, auditTrail: [{ action: 'create', detail: 'x' }] },
      },
    });

    expect(outcome.success).toBe(true);
    expect(firestore.writeBatch).toHaveBeenCalledTimes(1);
    const batch = lastBatch();
    expect(batch.set).toHaveBeenCalledTimes(1);
    expect(batch.set.mock.calls[0][1]).toMatchObject({ vendor: 'W', grossAmount: 119 });
    expect(batch.delete).toHaveBeenCalledTimes(1);
    expect(batch.delete.mock.calls[0][0].path).toMatch(/receivables\/cxc-1$/);
    expect(batch.update).toHaveBeenCalledTimes(1);
    const [archiveRef, update] = batch.update.mock.calls[0];
    expect(archiveRef.path).toMatch(new RegExp(`invoiceDocuments/${SHA}$`));
    expect(update).toMatchObject({ ...archivePatch, links: [{ family: 'payable', recordId: outcome.newId }] });
    expect(batch.commit).toHaveBeenCalledTimes(1);
  });

  it('only flips the archive when there is no linked obligation', async () => {
    const result = await mount();
    await result.current.switchInvoiceSide(SHA, {
      valid: true, fromFamily: 'receivable', toFamily: 'payable', archivePatch, obligation: null,
    });
    const batch = lastBatch();
    expect(batch.set).not.toHaveBeenCalled();
    expect(batch.delete).not.toHaveBeenCalled();
    expect(batch.update.mock.calls[0][1].links).toBeUndefined();
  });

  it('writes nothing for an invalid plan', async () => {
    const result = await mount();
    const outcome = await result.current.switchInvoiceSide(SHA, { valid: false, error: 'bloqueada' });
    expect(outcome).toMatchObject({ success: false });
    expect(firestore.writeBatch).not.toHaveBeenCalled();
  });
});
