/**
 * Pure chunking/integrity primitives for storing invoice PDF bytes as
 * Firestore document chunks (Spark plan has no Storage bucket — see
 * src/features/facturas/lib/invoiceArchiveStore.js for the Firestore wiring
 * that uses these). No Firebase here: everything is bytes in, bytes out.
 */
import { describe, expect, it } from 'vitest';
import {
  CHUNK_BYTES,
  MAX_CHUNK_COUNT,
  MAX_INVOICE_BYTES,
  chunkIdOf,
  hasPdfSignature,
  joinChunks,
  sha256Hex,
  splitIntoChunks,
} from './invoiceChunks';

const bytesOf = (length, fill = 1) => {
  const array = new Uint8Array(length);
  array.fill(fill);
  return array;
};

const pdfBytes = (length) => {
  const array = bytesOf(length, 0x41);
  const signature = [0x25, 0x50, 0x44, 0x46, 0x2d]; // '%PDF-'
  array.set(signature.slice(0, length), 0);
  return array;
};

describe('constants', () => {
  it('MAX_INVOICE_BYTES is 2 MiB', () => {
    expect(MAX_INVOICE_BYTES).toBe(2 * 1024 * 1024);
  });

  it('CHUNK_BYTES is 768 KiB', () => {
    expect(CHUNK_BYTES).toBe(768 * 1024);
  });

  it('MAX_CHUNK_COUNT is derived from MAX_INVOICE_BYTES / CHUNK_BYTES, rounded up', () => {
    expect(MAX_CHUNK_COUNT).toBe(Math.ceil(MAX_INVOICE_BYTES / CHUNK_BYTES));
    expect(MAX_CHUNK_COUNT).toBe(3);
  });
});

describe('chunkIdOf', () => {
  it('zero-pads to a 3-digit string', () => {
    expect(chunkIdOf(0)).toBe('000');
    expect(chunkIdOf(1)).toBe('001');
    expect(chunkIdOf(12)).toBe('012');
  });
});

describe('hasPdfSignature', () => {
  it('is true for bytes starting with %PDF-', () => {
    expect(hasPdfSignature(pdfBytes(16))).toBe(true);
  });

  it('is false for bytes without the signature', () => {
    expect(hasPdfSignature(bytesOf(16, 0))).toBe(false);
  });

  it('is false for input shorter than the signature', () => {
    expect(hasPdfSignature(new Uint8Array([0x25, 0x50]))).toBe(false);
  });
});

describe('splitIntoChunks', () => {
  it('throws on empty input', () => {
    expect(() => splitIntoChunks(new Uint8Array(0))).toThrow();
  });

  it('splits exactly 1 byte into a single 1-byte chunk', () => {
    const chunks = splitIntoChunks(bytesOf(1));
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ index: 0 });
    expect(chunks[0].bytes).toHaveLength(1);
  });

  it('splits exactly CHUNK_BYTES into a single full chunk', () => {
    const chunks = splitIntoChunks(bytesOf(CHUNK_BYTES));
    expect(chunks).toHaveLength(1);
    expect(chunks[0].bytes).toHaveLength(CHUNK_BYTES);
  });

  it('splits CHUNK_BYTES + 1 into two chunks (full, then 1 byte)', () => {
    const chunks = splitIntoChunks(bytesOf(CHUNK_BYTES + 1));
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toMatchObject({ index: 0 });
    expect(chunks[0].bytes).toHaveLength(CHUNK_BYTES);
    expect(chunks[1]).toMatchObject({ index: 1 });
    expect(chunks[1].bytes).toHaveLength(1);
  });

  it('splits exactly MAX_INVOICE_BYTES into 3 chunks with a smaller trailing chunk', () => {
    const chunks = splitIntoChunks(bytesOf(MAX_INVOICE_BYTES));
    expect(chunks).toHaveLength(3);
    expect(chunks[0].bytes).toHaveLength(CHUNK_BYTES);
    expect(chunks[1].bytes).toHaveLength(CHUNK_BYTES);
    expect(chunks[2].bytes).toHaveLength(MAX_INVOICE_BYTES - 2 * CHUNK_BYTES);
    expect(chunks.map((c) => c.index)).toEqual([0, 1, 2]);
  });

  it('throws on input larger than MAX_INVOICE_BYTES', () => {
    expect(() => splitIntoChunks(bytesOf(MAX_INVOICE_BYTES + 1))).toThrow();
  });

  it('accepts an ArrayBuffer as well as a Uint8Array', () => {
    const buffer = bytesOf(10).buffer;
    const chunks = splitIntoChunks(buffer);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].bytes).toHaveLength(10);
  });
});

describe('splitIntoChunks -> joinChunks round trip', () => {
  it.each([1, CHUNK_BYTES, CHUNK_BYTES + 1, MAX_INVOICE_BYTES])(
    'reassembles the original bytes exactly for a %i-byte input',
    (length) => {
      const original = pdfBytes(length);
      const chunks = splitIntoChunks(original);
      const joined = joinChunks(chunks, { expectedSize: length, expectedCount: chunks.length });
      expect(Array.from(joined)).toEqual(Array.from(original));
    },
  );
});

describe('joinChunks failure modes', () => {
  const validChunks = () => splitIntoChunks(pdfBytes(CHUNK_BYTES + 10));

  it('throws on a chunk count mismatch', () => {
    const chunks = validChunks();
    expect(() => joinChunks(chunks, { expectedSize: CHUNK_BYTES + 10, expectedCount: 3 })).toThrow();
  });

  it('throws when an index is missing (gap)', () => {
    const chunks = validChunks();
    chunks[1] = { ...chunks[1], index: 2 };
    expect(() => joinChunks(chunks, { expectedSize: CHUNK_BYTES + 10, expectedCount: 2 })).toThrow();
  });

  it('throws on a duplicate index', () => {
    const chunks = validChunks();
    chunks[1] = { ...chunks[1], index: 0 };
    expect(() => joinChunks(chunks, { expectedSize: CHUNK_BYTES + 10, expectedCount: 2 })).toThrow();
  });

  it('throws when chunks arrive out of order', () => {
    const chunks = validChunks();
    const reversed = [chunks[1], chunks[0]];
    expect(() => joinChunks(reversed, { expectedSize: CHUNK_BYTES + 10, expectedCount: 2 })).toThrow();
  });

  it('throws on a total size mismatch', () => {
    const chunks = validChunks();
    expect(() => joinChunks(chunks, { expectedSize: CHUNK_BYTES + 999, expectedCount: 2 })).toThrow();
  });

  it('throws when chunks is not an array', () => {
    expect(() => joinChunks(null, { expectedSize: 1, expectedCount: 1 })).toThrow();
  });
});

describe('sha256Hex', () => {
  it('matches the known SHA-256 test vector for "abc"', async () => {
    const bytes = new TextEncoder().encode('abc');
    const hex = await sha256Hex(bytes);
    expect(hex).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('is deterministic for the same bytes', async () => {
    const bytes = bytesOf(1024, 7);
    const first = await sha256Hex(bytes);
    const second = await sha256Hex(bytes);
    expect(first).toBe(second);
  });

  it('returns lowercase hex', async () => {
    const bytes = new TextEncoder().encode('abc');
    const hex = await sha256Hex(bytes);
    expect(hex).toBe(hex.toLowerCase());
    expect(hex).toMatch(/^[a-f0-9]{64}$/);
  });
});
