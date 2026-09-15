import { describe, expect, it, vi } from 'vitest';
import {
  ARCHIVE_ERROR_MESSAGES,
  InvoiceArchiveError,
  fetchInvoicePdf,
  uploadInvoicePdf,
} from './invoiceArchiveApi';

const user = (overrides = {}) => ({
  getIdToken: vi.fn().mockResolvedValue('id-token-123'),
  ...overrides,
});

const jsonResponse = (status, payload) => ({
  status,
  ok: status >= 200 && status < 300,
  json: vi.fn().mockResolvedValue(payload),
});

const SHA = 'a'.repeat(64);

describe('ARCHIVE_ERROR_MESSAGES', () => {
  it('has a Spanish message for every backend error code plus network/hash-mismatch/invalid-digest', () => {
    const codes = [
      'invalid-body',
      'access-denied',
      'not-found',
      'method-not-allowed',
      'conflict',
      'too-large',
      'unsupported-media-type',
      'internal-error',
      'network',
      'hash-mismatch',
      'invalid-digest',
    ];
    codes.forEach((code) => {
      expect(typeof ARCHIVE_ERROR_MESSAGES[code]).toBe('string');
      expect(ARCHIVE_ERROR_MESSAGES[code].length).toBeGreaterThan(0);
    });
  });
});

describe('InvoiceArchiveError', () => {
  it('carries code and status and a user-facing message', () => {
    const error = new InvoiceArchiveError('access-denied', 403);
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe('access-denied');
    expect(error.status).toBe(403);
    expect(error.message).toBe(ARCHIVE_ERROR_MESSAGES['access-denied']);
  });
});

describe('uploadInvoicePdf', () => {
  it('uploads with the bearer token and application/pdf content type, returns the descriptor', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, { sha256: SHA, sizeBytes: 1024, mimeType: 'application/pdf' }),
    );
    const bytes = new Uint8Array([1, 2, 3]);
    const result = await uploadInvoicePdf({ user: user(), bytes }, { fetchImpl });

    expect(result).toEqual({ sha256: SHA, sizeBytes: 1024, mimeType: 'application/pdf' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('/api/invoice-pdfs');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer id-token-123');
    expect(init.headers['Content-Type']).toBe('application/pdf');
    expect(init.body).toBe(bytes);
  });

  it('is idempotent-friendly: succeeds without expectedSha256', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, { sha256: SHA, sizeBytes: 10, mimeType: 'application/pdf' }),
    );
    await expect(uploadInvoicePdf({ user: user(), bytes: new Uint8Array() }, { fetchImpl })).resolves.toEqual({
      sha256: SHA,
      sizeBytes: 10,
      mimeType: 'application/pdf',
    });
  });

  it('resolves when the returned sha256 matches expectedSha256', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, { sha256: SHA, sizeBytes: 10, mimeType: 'application/pdf' }),
    );
    await expect(
      uploadInvoicePdf({ user: user(), bytes: new Uint8Array(), expectedSha256: SHA }, { fetchImpl }),
    ).resolves.toMatchObject({ sha256: SHA });
  });

  it('throws hash-mismatch when the returned sha256 differs from expectedSha256', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, { sha256: 'b'.repeat(64), sizeBytes: 10, mimeType: 'application/pdf' }),
    );
    await expect(
      uploadInvoicePdf({ user: user(), bytes: new Uint8Array(), expectedSha256: SHA }, { fetchImpl }),
    ).rejects.toMatchObject({ code: 'hash-mismatch' });
  });

  it.each([
    [400, 'invalid-body'],
    [403, 'access-denied'],
    [404, 'not-found'],
    [405, 'method-not-allowed'],
    [409, 'conflict'],
    [413, 'too-large'],
    [415, 'unsupported-media-type'],
    [500, 'internal-error'],
  ])('maps HTTP %i to InvoiceArchiveError(%j)', async (status, code) => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(status, { error: code }));
    const error = await uploadInvoicePdf({ user: user(), bytes: new Uint8Array() }, { fetchImpl }).catch((e) => e);
    expect(error).toBeInstanceOf(InvoiceArchiveError);
    expect(error.code).toBe(code);
    expect(error.status).toBe(status);
  });

  it('falls back to internal-error when the error body is missing or malformed', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      status: 500,
      ok: false,
      json: vi.fn().mockRejectedValue(new Error('not json')),
    });
    const error = await uploadInvoicePdf({ user: user(), bytes: new Uint8Array() }, { fetchImpl }).catch((e) => e);
    expect(error.code).toBe('internal-error');
  });

  it('throws access-denied when the user cannot provide an ID token', async () => {
    const fetchImpl = vi.fn();
    await expect(uploadInvoicePdf({ user: {}, bytes: new Uint8Array() }, { fetchImpl })).rejects.toMatchObject({
      code: 'access-denied',
    });
    await expect(uploadInvoicePdf({ user: null, bytes: new Uint8Array() }, { fetchImpl })).rejects.toMatchObject({
      code: 'access-denied',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('throws access-denied when getIdToken itself rejects', async () => {
    const fetchImpl = vi.fn();
    const brokenUser = user({ getIdToken: vi.fn().mockRejectedValue(new Error('expired')) });
    await expect(uploadInvoicePdf({ user: brokenUser, bytes: new Uint8Array() }, { fetchImpl })).rejects.toMatchObject(
      { code: 'access-denied' },
    );
  });

  it('throws network when fetch itself rejects', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(uploadInvoicePdf({ user: user(), bytes: new Uint8Array() }, { fetchImpl })).rejects.toMatchObject({
      code: 'network',
    });
  });
});

describe('fetchInvoicePdf', () => {
  it('fetches with the bearer token and returns a PDF blob', async () => {
    const blob = new Blob(['%PDF-1.4'], { type: 'application/pdf' });
    const fetchImpl = vi.fn().mockResolvedValue({ status: 200, ok: true, blob: vi.fn().mockResolvedValue(blob) });
    const result = await fetchInvoicePdf({ user: user(), sha256: SHA }, { fetchImpl });

    expect(result).toBeInstanceOf(Blob);
    expect(result.type).toBe('application/pdf');
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(`/api/invoice-pdfs/${SHA}`);
    expect(init.headers.Authorization).toBe('Bearer id-token-123');
  });

  it('coerces the returned blob to application/pdf even if the mock omits the type', async () => {
    const blob = new Blob(['%PDF-1.4']);
    const fetchImpl = vi.fn().mockResolvedValue({ status: 200, ok: true, blob: vi.fn().mockResolvedValue(blob) });
    const result = await fetchInvoicePdf({ user: user(), sha256: SHA }, { fetchImpl });
    expect(result.type).toBe('application/pdf');
  });

  it.each([
    [400, 'invalid-body'],
    [403, 'access-denied'],
    [404, 'not-found'],
    [405, 'method-not-allowed'],
    [409, 'conflict'],
    [413, 'too-large'],
    [415, 'unsupported-media-type'],
    [500, 'internal-error'],
  ])('maps HTTP %i to InvoiceArchiveError(%j)', async (status, code) => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(status, { error: code }));
    const error = await fetchInvoicePdf({ user: user(), sha256: SHA }, { fetchImpl }).catch((e) => e);
    expect(error).toBeInstanceOf(InvoiceArchiveError);
    expect(error.code).toBe(code);
    expect(error.status).toBe(status);
  });

  it.each(['', 'ABC', 'a'.repeat(63), 'a'.repeat(65), `${'g'.repeat(64)}`, null, undefined])(
    'throws invalid-digest for a malformed sha256: %j',
    async (sha256) => {
      const fetchImpl = vi.fn();
      await expect(fetchInvoicePdf({ user: user(), sha256 }, { fetchImpl })).rejects.toMatchObject({
        code: 'invalid-digest',
      });
      expect(fetchImpl).not.toHaveBeenCalled();
    },
  );

  it('throws access-denied when the user cannot provide an ID token', async () => {
    const fetchImpl = vi.fn();
    await expect(fetchInvoicePdf({ user: {}, sha256: SHA }, { fetchImpl })).rejects.toMatchObject({
      code: 'access-denied',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('throws network when fetch itself rejects', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(fetchInvoicePdf({ user: user(), sha256: SHA }, { fetchImpl })).rejects.toMatchObject({
      code: 'network',
    });
  });
});
