# Facturas — invoice PDF archive

## Why Firestore chunks
Firebase stays on the Spark plan: no Cloud Functions, no Storage bucket. PDF
bytes live in Firestore itself, split under its 1 MiB/doc limit, guarded by
`firestore.rules`.

## Storage layout
- Metadata: `artifacts/{appId}/public/data/invoiceDocuments/{sha256}` — fields
  from `buildInvoiceDocument` (`lib/intake.js`) plus `storage:
  'firestore-chunks-v1'`, `sizeBytes`, `chunkBytes`, `chunkCount`.
- Bytes: subcollection `invoiceDocuments/{sha256}/chunks/{index}`, doc id a
  zero-padded index (`'000'`, …), fields `{ index, bytes, sha256 }` — `bytes`
  is a Firestore `Bytes` value, never base64.

## Limits
`MAX_INVOICE_BYTES` = 2 MiB, `CHUNK_BYTES` = 768 KiB → at most 3 chunks
(`src/finance/invoiceChunks.js`), enforced client-side and again server-side.

## Integrity check
Upload hashes the bytes and requires a match with the caller's digest before
writing. Fetch reassembles chunks in index order, checks count/size against
the metadata doc, recomputes the digest and requires it to equal the doc id
— any mismatch fails closed as `corrupt`.

## Rules summary
A dedicated block (the generic tenant block excludes `invoiceDocuments`)
restricts read/write to manager/admin of the owning tenant and validates on
write: metadata `sizeBytes <= 2097152`, `chunkCount` in `[1,3]`, `storage ==
'firestore-chunks-v1'`; chunks `bytes.size() <= 786432`, `index` in `[0,3)`,
`sha256` equal to the parent doc id. See `firestore.rules.integration.test.js`.

## Deploy
```bash
firebase deploy --only firestore:rules,hosting
```
