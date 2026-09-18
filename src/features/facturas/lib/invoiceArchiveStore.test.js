/**
 * invoiceArchiveStore — Firestore-chunk-backed replacement for the retired
 * HTTP invoice archive client. Every Firestore call goes through injected
 * `deps` so this stays testable without a network stack or the emulator
 * (see src/test/firestore.rules.integration.test.js for the rules-level
 * coverage of the same collection).
 */
import { describe, expect, it } from 'vitest';
import { CHUNK_BYTES, MAX_INVOICE_BYTES, chunkIdOf, sha256Hex } from '../../../finance/invoiceChunks';
import {
  ARCHIVE_ERROR_MESSAGES,
  InvoiceArchiveError,
  deleteInvoicePdf,
  fetchInvoicePdf,
  uploadInvoicePdf,
} from './invoiceArchiveStore';

const APP_ID = 'test-app';
const DB = { __fakeDb: true };

const pdfBytes = (length, fill = 0x41) => {
  const array = new Uint8Array(length);
  array.fill(fill);
  const signature = [0x25, 0x50, 0x44, 0x46, 0x2d]; // '%PDF-'
  array.set(signature.slice(0, length), 0);
  return array;
};

const makeError = (code) => Object.assign(new Error(code), { code });

/** Minimal in-memory Firestore double, just enough to exercise the store. */
const createFakeFirestore = () => {
  const docs = new Map(); // path -> data
  let nextError = null; // { op, code }

  const pathOf = (segments) => segments.join('/');
  const doc = (_db, ...segments) => ({ __type: 'doc', path: pathOf(segments) });
  const collection = (_db, ...segments) => ({ __type: 'collection', path: pathOf(segments) });
  const orderBy = (field) => ({ __constraint: 'orderBy', field });
  const query = (ref, ...constraints) => ({ ...ref, __constraints: constraints });

  const maybeThrow = (op) => {
    if (nextError?.op === op) {
      const error = makeError(nextError.code);
      nextError = null;
      throw error;
    }
  };

  const getDoc = async (ref) => {
    maybeThrow('getDoc');
    const data = docs.get(ref.path);
    return { exists: () => data !== undefined, data: () => data };
  };

  const getDocs = async (ref) => {
    maybeThrow('getDocs');
    const prefix = `${ref.path}/`;
    let entries = [...docs.entries()].filter(
      ([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'),
    );
    const orderConstraint = (ref.__constraints || []).find((c) => c.__constraint === 'orderBy');
    if (orderConstraint) {
      entries = entries.sort((a, b) => a[1][orderConstraint.field] - b[1][orderConstraint.field]);
    }
    return { docs: entries.map(([, data]) => ({ data: () => data })) };
  };

  const writeBatch = () => {
    const pending = [];
    return {
      set: (ref, data) => pending.push({ ref, data }),
      delete: (ref) => pending.push({ ref, data: undefined, op: 'delete' }),
      commit: async () => {
        maybeThrow('commit');
        pending.forEach(({ ref, data, op }) => (op === 'delete' ? docs.delete(ref.path) : docs.set(ref.path, data)));
      },
    };
  };

  const Bytes = {
    fromUint8Array: (u8) => ({ __bytes: true, toUint8Array: () => u8 }),
  };

  return {
    deps: { collection, doc, getDoc, getDocs, orderBy, query, writeBatch, Bytes },
    docs,
    setNextError: (op, code) => {
      nextError = { op, code };
    },
  };
};

/** Writes the metadata doc a fetch would need, alongside its chunk docs. */
const seedArchivedInvoice = async (fake, bytes) => {
  const sha256 = await sha256Hex(bytes);
  const result = await uploadInvoicePdf({ db: DB, appId: APP_ID, bytes, expectedSha256: sha256 }, fake.deps);
  fake.docs.set(`artifacts/${APP_ID}/public/data/invoiceDocuments/${sha256}`, {
    sha256,
    sizeBytes: bytes.byteLength,
    chunkBytes: CHUNK_BYTES,
    chunkCount: Math.ceil(bytes.byteLength / CHUNK_BYTES),
    storage: 'firestore-chunks-v1',
  });
  return { sha256, result };
};

describe('ARCHIVE_ERROR_MESSAGES', () => {
  it('has a Spanish message for every documented error code', () => {
    const codes = [
      'too-large',
      'invalid-pdf',
      'not-found',
      'corrupt',
      'access-denied',
      'network',
      'hash-mismatch',
      'internal-error',
    ];
    codes.forEach((code) => {
      expect(typeof ARCHIVE_ERROR_MESSAGES[code]).toBe('string');
      expect(ARCHIVE_ERROR_MESSAGES[code].length).toBeGreaterThan(0);
    });
  });
});

describe('InvoiceArchiveError', () => {
  it('carries a code and a user-facing message from ARCHIVE_ERROR_MESSAGES', () => {
    const error = new InvoiceArchiveError('access-denied');
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe('access-denied');
    expect(error.message).toBe(ARCHIVE_ERROR_MESSAGES['access-denied']);
  });

  it('carries an optional cause', () => {
    const cause = new Error('boom');
    const error = new InvoiceArchiveError('internal-error', cause);
    expect(error.cause).toBe(cause);
  });
});

describe('uploadInvoicePdf', () => {
  it('uploads a small PDF: writes chunk docs and resolves the descriptor', async () => {
    const fake = createFakeFirestore();
    const bytes = pdfBytes(10);
    const sha256 = await sha256Hex(bytes);

    const result = await uploadInvoicePdf({ db: DB, appId: APP_ID, bytes, expectedSha256: sha256 }, fake.deps);

    expect(result).toEqual({ sha256, sizeBytes: 10, mimeType: 'application/pdf' });
    const chunkPath = `artifacts/${APP_ID}/public/data/invoiceDocuments/${sha256}/chunks/${chunkIdOf(0)}`;
    const written = fake.docs.get(chunkPath);
    expect(written).toBeTruthy();
    expect(written.index).toBe(0);
    expect(written.sha256).toBe(sha256);
    expect(Array.from(written.bytes.toUint8Array())).toEqual(Array.from(bytes));
  });

  it('splits a multi-chunk PDF into ordered chunk documents', async () => {
    const fake = createFakeFirestore();
    const bytes = pdfBytes(MAX_INVOICE_BYTES);
    const sha256 = await sha256Hex(bytes);

    await uploadInvoicePdf({ db: DB, appId: APP_ID, bytes, expectedSha256: sha256 }, fake.deps);

    [0, 1, 2].forEach((index) => {
      const path = `artifacts/${APP_ID}/public/data/invoiceDocuments/${sha256}/chunks/${chunkIdOf(index)}`;
      expect(fake.docs.get(path)).toBeTruthy();
      expect(fake.docs.get(path).index).toBe(index);
    });
  });

  it('rejects with invalid-pdf when the bytes lack the %PDF- signature', async () => {
    const fake = createFakeFirestore();
    const bytes = new Uint8Array(10);
    const sha256 = await sha256Hex(bytes);

    await expect(
      uploadInvoicePdf({ db: DB, appId: APP_ID, bytes, expectedSha256: sha256 }, fake.deps),
    ).rejects.toMatchObject({ code: 'invalid-pdf' });
    expect(fake.docs.size).toBe(0);
  });

  it('rejects with too-large when the bytes exceed MAX_INVOICE_BYTES', async () => {
    const fake = createFakeFirestore();
    const bytes = pdfBytes(MAX_INVOICE_BYTES + 1);
    const sha256 = await sha256Hex(bytes);

    await expect(
      uploadInvoicePdf({ db: DB, appId: APP_ID, bytes, expectedSha256: sha256 }, fake.deps),
    ).rejects.toMatchObject({ code: 'too-large' });
    expect(fake.docs.size).toBe(0);
  });

  it('rejects with hash-mismatch when expectedSha256 does not match the computed digest', async () => {
    const fake = createFakeFirestore();
    const bytes = pdfBytes(10);

    await expect(
      uploadInvoicePdf({ db: DB, appId: APP_ID, bytes, expectedSha256: 'a'.repeat(64) }, fake.deps),
    ).rejects.toMatchObject({ code: 'hash-mismatch' });
    expect(fake.docs.size).toBe(0);
  });

  it('is idempotent: re-uploading identical bytes writes the same chunk ids and content', async () => {
    const fake = createFakeFirestore();
    const bytes = pdfBytes(10);
    const sha256 = await sha256Hex(bytes);

    await uploadInvoicePdf({ db: DB, appId: APP_ID, bytes, expectedSha256: sha256 }, fake.deps);
    const afterFirst = new Map(fake.docs);

    await uploadInvoicePdf({ db: DB, appId: APP_ID, bytes, expectedSha256: sha256 }, fake.deps);

    expect(fake.docs.size).toBe(afterFirst.size);
    for (const [path, data] of afterFirst) {
      expect(Array.from(fake.docs.get(path).bytes.toUint8Array())).toEqual(Array.from(data.bytes.toUint8Array()));
    }
  });

  it('maps a Firestore permission-denied commit failure to access-denied', async () => {
    const fake = createFakeFirestore();
    fake.setNextError('commit', 'permission-denied');
    const bytes = pdfBytes(10);
    const sha256 = await sha256Hex(bytes);

    await expect(
      uploadInvoicePdf({ db: DB, appId: APP_ID, bytes, expectedSha256: sha256 }, fake.deps),
    ).rejects.toMatchObject({ code: 'access-denied' });
  });

  it('maps an unavailable commit failure to network', async () => {
    const fake = createFakeFirestore();
    fake.setNextError('commit', 'unavailable');
    const bytes = pdfBytes(10);
    const sha256 = await sha256Hex(bytes);

    await expect(
      uploadInvoicePdf({ db: DB, appId: APP_ID, bytes, expectedSha256: sha256 }, fake.deps),
    ).rejects.toMatchObject({ code: 'network' });
  });

  it('maps any other commit failure to internal-error', async () => {
    const fake = createFakeFirestore();
    fake.setNextError('commit', 'resource-exhausted');
    const bytes = pdfBytes(10);
    const sha256 = await sha256Hex(bytes);

    await expect(
      uploadInvoicePdf({ db: DB, appId: APP_ID, bytes, expectedSha256: sha256 }, fake.deps),
    ).rejects.toMatchObject({ code: 'internal-error' });
  });
});

describe('deleteInvoicePdf', () => {
  it('deletes every chunk doc for a known chunkCount', async () => {
    const fake = createFakeFirestore();
    const bytes = pdfBytes(CHUNK_BYTES + 10); // 2 chunks
    const { sha256 } = await seedArchivedInvoice(fake, bytes);
    const chunk0 = `artifacts/${APP_ID}/public/data/invoiceDocuments/${sha256}/chunks/${chunkIdOf(0)}`;
    const chunk1 = `artifacts/${APP_ID}/public/data/invoiceDocuments/${sha256}/chunks/${chunkIdOf(1)}`;
    expect(fake.docs.has(chunk0)).toBe(true);
    expect(fake.docs.has(chunk1)).toBe(true);

    await deleteInvoicePdf({ db: DB, appId: APP_ID, sha256, chunkCount: 2 }, fake.deps);

    expect(fake.docs.has(chunk0)).toBe(false);
    expect(fake.docs.has(chunk1)).toBe(false);
  });

  it('tolerates a chunk that was already missing', async () => {
    const fake = createFakeFirestore();
    const bytes = pdfBytes(10);
    const { sha256 } = await seedArchivedInvoice(fake, bytes);
    const chunk0 = `artifacts/${APP_ID}/public/data/invoiceDocuments/${sha256}/chunks/${chunkIdOf(0)}`;
    fake.docs.delete(chunk0); // already gone (partial prior failure)

    await expect(
      deleteInvoicePdf({ db: DB, appId: APP_ID, sha256, chunkCount: 1 }, fake.deps),
    ).resolves.toBeUndefined();
  });

  it('rejects with not-found when the digest is not 64 lowercase hex characters', async () => {
    const fake = createFakeFirestore();
    await expect(
      deleteInvoicePdf({ db: DB, appId: APP_ID, sha256: 'not-a-digest', chunkCount: 1 }, fake.deps),
    ).rejects.toMatchObject({ code: 'not-found' });
  });

  it('maps a permission-denied commit failure to access-denied', async () => {
    const fake = createFakeFirestore();
    const bytes = pdfBytes(10);
    const { sha256 } = await seedArchivedInvoice(fake, bytes);
    fake.setNextError('commit', 'permission-denied');

    await expect(
      deleteInvoicePdf({ db: DB, appId: APP_ID, sha256, chunkCount: 1 }, fake.deps),
    ).rejects.toMatchObject({ code: 'access-denied' });
  });
});

describe('fetchInvoicePdf', () => {
  it('rejects with not-found when the digest is not 64 lowercase hex characters', async () => {
    const fake = createFakeFirestore();
    await expect(
      fetchInvoicePdf({ db: DB, appId: APP_ID, sha256: 'not-a-digest' }, fake.deps),
    ).rejects.toMatchObject({ code: 'not-found' });
  });

  it('rejects with not-found when no metadata document exists', async () => {
    const fake = createFakeFirestore();
    await expect(
      fetchInvoicePdf({ db: DB, appId: APP_ID, sha256: 'a'.repeat(64) }, fake.deps),
    ).rejects.toMatchObject({ code: 'not-found' });
  });

  it('reassembles a previously uploaded PDF into a matching Blob', async () => {
    const fake = createFakeFirestore();
    const bytes = pdfBytes(CHUNK_BYTES + 10);
    const { sha256 } = await seedArchivedInvoice(fake, bytes);

    const blob = await fetchInvoicePdf({ db: DB, appId: APP_ID, sha256 }, fake.deps);

    expect(blob.type).toBe('application/pdf');
    const buffer = await blob.arrayBuffer();
    expect(Array.from(new Uint8Array(buffer))).toEqual(Array.from(bytes));
  });

  it('rejects with corrupt when a chunk was tampered with', async () => {
    const fake = createFakeFirestore();
    const bytes = pdfBytes(10);
    const { sha256 } = await seedArchivedInvoice(fake, bytes);
    const chunkPath = `artifacts/${APP_ID}/public/data/invoiceDocuments/${sha256}/chunks/${chunkIdOf(0)}`;
    const tampered = new Uint8Array(bytes);
    tampered[9] = tampered[9] ^ 0xff;
    fake.docs.set(chunkPath, { index: 0, sha256, bytes: fake.deps.Bytes.fromUint8Array(tampered) });

    await expect(fetchInvoicePdf({ db: DB, appId: APP_ID, sha256 }, fake.deps)).rejects.toMatchObject({
      code: 'corrupt',
    });
  });

  it('rejects with corrupt when a chunk is missing', async () => {
    const fake = createFakeFirestore();
    const bytes = pdfBytes(CHUNK_BYTES + 10);
    const { sha256 } = await seedArchivedInvoice(fake, bytes);
    const secondChunkPath = `artifacts/${APP_ID}/public/data/invoiceDocuments/${sha256}/chunks/${chunkIdOf(1)}`;
    fake.docs.delete(secondChunkPath);

    await expect(fetchInvoicePdf({ db: DB, appId: APP_ID, sha256 }, fake.deps)).rejects.toMatchObject({
      code: 'corrupt',
    });
  });

  it('maps a permission-denied metadata read to access-denied', async () => {
    const fake = createFakeFirestore();
    const bytes = pdfBytes(10);
    const { sha256 } = await seedArchivedInvoice(fake, bytes);
    fake.setNextError('getDoc', 'permission-denied');

    await expect(fetchInvoicePdf({ db: DB, appId: APP_ID, sha256 }, fake.deps)).rejects.toMatchObject({
      code: 'access-denied',
    });
  });

  it('maps an unavailable chunk read to network', async () => {
    const fake = createFakeFirestore();
    const bytes = pdfBytes(10);
    const { sha256 } = await seedArchivedInvoice(fake, bytes);
    fake.setNextError('getDocs', 'unavailable');

    await expect(fetchInvoicePdf({ db: DB, appId: APP_ID, sha256 }, fake.deps)).rejects.toMatchObject({
      code: 'network',
    });
  });
});
