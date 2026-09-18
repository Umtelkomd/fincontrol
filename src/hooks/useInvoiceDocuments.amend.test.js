/**
 * updateInvoiceDocument / deleteInvoiceDocument — the archive-doc side of
 * amending an archived invoice. Split from useInvoiceDocuments.test.js
 * for the same reason as commitArchive.test.js: needs the Firestore module
 * double (installFirebaseMocks).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { installFirebaseMocks, TEST_USER } from '@/test/firebaseMock';

const store = installFirebaseMocks({ collections: { invoiceDocuments: [] } });

const firestore = await import('firebase/firestore');
const { useInvoiceDocuments } = await import('./useInvoiceDocuments.js');

const mount = async () => {
  const { result } = renderHook(() => useInvoiceDocuments(TEST_USER));
  await waitFor(() => expect(result.current.loading).toBe(false));
  return result;
};

beforeEach(() => {
  store.collections.invoiceDocuments = [];
  store.documents = {};
  firestore.updateDoc.mockClear();
  firestore.deleteDoc.mockClear();
  firestore.getDoc.mockClear();
});

describe('updateInvoiceDocument', () => {
  it('patches the given fields and stamps updatedAt, never touching sha256/sizeBytes/chunkCount/storage', async () => {
    const result = await mount();

    const response = await result.current.updateInvoiceDocument('a'.repeat(64), {
      counterpartyName: 'Nuevo nombre',
      invoiceNumber: 'RE-2026-999',
    });

    expect(response).toEqual({ success: true });
    expect(firestore.updateDoc).toHaveBeenCalledTimes(1);
    const [ref, payload] = firestore.updateDoc.mock.calls[0];
    expect(ref.path).toContain(`invoiceDocuments/${'a'.repeat(64)}`);
    expect(payload).toMatchObject({ counterpartyName: 'Nuevo nombre', invoiceNumber: 'RE-2026-999' });
    expect(payload.updatedAt).toBe('SERVER_TIMESTAMP');
    ['sha256', 'sizeBytes', 'chunkCount', 'storage', 'links'].forEach((key) =>
      expect(payload).not.toHaveProperty(key),
    );
  });

  it('accepts every field planInvoiceEdit legitimately emits onto the archive doc', async () => {
    const result = await mount();

    const response = await result.current.updateInvoiceDocument('a'.repeat(64), {
      counterpartyName: 'Nuevo nombre',
      counterpartyId: 'nuevo-nombre',
      invoiceNumber: 'RE-2026-999',
      issueDate: '2026-06-11',
      netAmount: 1000,
      taxAmount: 190,
      grossAmount: 1190,
      identity: 'invoice-v2',
    });

    expect(response).toEqual({ success: true });
    expect(firestore.updateDoc).toHaveBeenCalledTimes(1);
  });

  it.each(['sha256', 'sizeBytes', 'chunkCount', 'chunkBytes', 'storage', 'links', 'family', 'direction', 'createdAt', 'createdBy', 'someUnknownField'])(
    'rejects a patch containing "%s" WITHOUT writing, instead of silently stripping it',
    async (forbiddenKey) => {
      const result = await mount();

      const response = await result.current.updateInvoiceDocument('a'.repeat(64), {
        counterpartyName: 'Nuevo nombre',
        [forbiddenKey]: 'intento de fuga',
      });

      expect(response).toEqual({ success: false, error: expect.any(Error) });
      expect(firestore.updateDoc).not.toHaveBeenCalled();
    },
  );
});

describe('findInvoiceDocument', () => {
  it('returns null when no document exists for that sha256', async () => {
    store.documents = {};
    const result = await mount();

    const found = await result.current.findInvoiceDocument('c'.repeat(64));

    expect(found).toBeNull();
  });

  it('returns the sanitized document (with its id) when it exists — an authoritative getDoc, not the possibly-stale onSnapshot list', async () => {
    store.documents = { [`${'b'.repeat(64)}`]: { invoiceNumber: 'RE-2026-777', counterpartyName: 'Otro proveedor' } };
    const result = await mount();

    const found = await result.current.findInvoiceDocument('b'.repeat(64));

    expect(found).toMatchObject({ id: 'b'.repeat(64), invoiceNumber: 'RE-2026-777' });
  });

  it('returns null for an empty/missing sha256 without calling Firestore', async () => {
    const result = await mount();

    expect(await result.current.findInvoiceDocument('')).toBeNull();
    expect(firestore.getDoc).not.toHaveBeenCalled();
  });
});

describe('deleteInvoiceDocument', () => {
  it('deletes the archive metadata document by sha256', async () => {
    const result = await mount();

    await result.current.deleteInvoiceDocument('b'.repeat(64));

    expect(firestore.deleteDoc).toHaveBeenCalledTimes(1);
    const [ref] = firestore.deleteDoc.mock.calls[0];
    expect(ref.path).toContain(`invoiceDocuments/${'b'.repeat(64)}`);
  });
});

describe('removeInvoiceLink', () => {
  it('strips the sha256 back-reference from a payable', async () => {
    const result = await mount();

    await result.current.removeInvoiceLink('payable', 'cxp-1', 'a'.repeat(64));

    expect(firestore.updateDoc).toHaveBeenCalledTimes(1);
    const [ref, payload] = firestore.updateDoc.mock.calls[0];
    expect(ref.path).toContain('payables/cxp-1');
    expect(firestore.arrayRemove).toHaveBeenCalledWith('a'.repeat(64));
    expect(payload.invoiceDocumentIds).toEqual(firestore.arrayRemove.mock.results.at(-1).value);
  });

  it('strips the sha256 back-reference from a receivable', async () => {
    const result = await mount();

    await result.current.removeInvoiceLink('receivable', 'cxc-1', 'a'.repeat(64));

    const [ref] = firestore.updateDoc.mock.calls[0];
    expect(ref.path).toContain('receivables/cxc-1');
  });

  it('rejects an unknown family', async () => {
    const result = await mount();
    await expect(result.current.removeInvoiceLink('bogus', 'x', 'a'.repeat(64))).rejects.toThrow();
  });
});

describe('swapInvoiceLink', () => {
  it('removes the old sha256 and adds the new one, in order', async () => {
    const result = await mount();

    await result.current.swapInvoiceLink('payable', 'cxp-1', {
      removeInvoiceDocumentId: 'a'.repeat(64),
      addInvoiceDocumentId: 'b'.repeat(64),
    });

    expect(firestore.updateDoc).toHaveBeenCalledTimes(2);
    expect(firestore.arrayRemove).toHaveBeenCalledWith('a'.repeat(64));
    expect(firestore.arrayUnion).toHaveBeenCalledWith('b'.repeat(64));
    const [firstRef] = firestore.updateDoc.mock.calls[0];
    const [secondRef] = firestore.updateDoc.mock.calls[1];
    expect(firstRef.path).toContain('payables/cxp-1');
    expect(secondRef.path).toContain('payables/cxp-1');
  });
});
