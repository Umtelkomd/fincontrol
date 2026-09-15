/**
 * commitInvoiceArchive — the effects.commit side of archiveInvoice
 * (src/features/facturas/lib/intake.js). Split from useInvoiceDocuments.test.js
 * because it needs the Firestore module double (installFirebaseMocks), while
 * that file's collectionForFamily/sortByCreatedAtDesc tests must keep running
 * against the real, unmocked module.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { installFirebaseMocks, TEST_USER } from '@/test/firebaseMock';

const store = installFirebaseMocks({ collections: { invoiceDocuments: [] } });

const firestore = await import('firebase/firestore');
const { useInvoiceDocuments } = await import('./useInvoiceDocuments.js');
const { CHUNK_BYTES } = await import('../finance/invoiceChunks.js');

const mount = async () => {
  const { result } = renderHook(() => useInvoiceDocuments(TEST_USER));
  await waitFor(() => expect(result.current.loading).toBe(false));
  return result;
};

const lastBatch = () => firestore.writeBatch.mock.results.at(-1).value;

beforeEach(() => {
  store.collections.invoiceDocuments = [];
  firestore.writeBatch.mockClear();
});

describe('commitInvoiceArchive — storage metadata', () => {
  it('stamps storage, chunkBytes and a chunkCount derived from sizeBytes', async () => {
    const result = await mount();
    const sizeBytes = 900000; // > 1 chunk, < 2 chunks

    await result.current.commitInvoiceArchive({
      document: {
        id: 'a'.repeat(64),
        data: { sha256: 'a'.repeat(64), sizeBytes, direction: 'incoming' },
      },
      linkUpdates: [],
    });

    expect(lastBatch().set).toHaveBeenCalledTimes(1);
    const [, payload] = lastBatch().set.mock.calls[0];
    expect(payload).toMatchObject({
      storage: 'firestore-chunks-v1',
      chunkBytes: CHUNK_BYTES,
      chunkCount: Math.ceil(sizeBytes / CHUNK_BYTES),
    });
  });

  it('uses chunkCount 1 for a document smaller than one chunk', async () => {
    const result = await mount();

    await result.current.commitInvoiceArchive({
      document: {
        id: 'b'.repeat(64),
        data: { sha256: 'b'.repeat(64), sizeBytes: 100, direction: 'incoming' },
      },
      linkUpdates: [],
    });

    const [, payload] = lastBatch().set.mock.calls[0];
    expect(payload.chunkCount).toBe(1);
  });

  it('computes chunkCount 3 for a document at MAX_INVOICE_BYTES', async () => {
    const result = await mount();
    const sizeBytes = 2 * 1024 * 1024;

    await result.current.commitInvoiceArchive({
      document: {
        id: 'c'.repeat(64),
        data: { sha256: 'c'.repeat(64), sizeBytes, direction: 'incoming' },
      },
      linkUpdates: [],
    });

    const [, payload] = lastBatch().set.mock.calls[0];
    expect(payload.chunkCount).toBe(3);
  });
  it('accumulates links with arrayUnion instead of replacing them', async () => {
    const result = await mount();
    const links = [{ family: 'payable', recordId: 'p-1' }];

    await result.current.commitInvoiceArchive({
      document: {
        id: 'd'.repeat(64),
        data: { sha256: 'd'.repeat(64), sizeBytes: 100, direction: 'incoming', links },
      },
      linkUpdates: [],
    });

    const [, payload] = lastBatch().set.mock.calls[0];
    expect(firestore.arrayUnion).toHaveBeenCalledWith(...links);
    expect(payload.links).toEqual(firestore.arrayUnion.mock.results.at(-1).value);
  });
});
