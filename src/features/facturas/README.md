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

## Classification at intake
Loading an invoice proposes a category, project and cost center — one of the
three orthogonal axes (see `docs/classification-catalog.md`) — instead of
leaving the CXP/CXC with an empty `projectId`.

### The three axes
| Axis | Question | Where it comes from |
|---|---|---|
| Category | WHAT was bought (`src/finance/taxonomy.js`) | counterparty history → classification rule → (receivables only) "Facturación obra" |
| Project | WHICH contract earns/consumes it (`src/finance/projectCode.js`) | PDF text mention → counterparty history → classification rule |
| Cost center | WHO/which unit is responsible (`src/finance/costCenterCatalog.js`) | counterparty history → classification rule → derived from the resolved project's line → derived from the resolved category |

`costScope` ('project' | 'overhead') is never chosen directly — it is always
derived from the resolved cost center's kind (falling back to the category's
own default). A field with no evidence stays `''`; nothing is ever guessed.

### How a suggestion is ranked
`suggestInvoiceClassification` (`src/finance/invoiceClassification.js`) fills
each field from the first source that has evidence, then reports one overall
`confidence` (`high` | `medium` | `low` | `none`) and one `reason` per
resolved field so the intake wizard (`InvoiceIntakePanel.jsx`) can show WHY a
value was proposed, not just the value:

- `pdf-text` — the project was mentioned in the extracted PDF text (`findProjectMentions`).
- `history` — the most frequent value across this counterparty's past invoices (≥2 agreeing rows is `medium`, a single one is `low`).
- `rule` — the best matching classification rule (`findBestRule`).
- `project-line` — the cost center defaulted from the resolved project's line.
- `category-default` — the cost center defaulted from the resolved category, or (receivables with no other evidence) the category defaulted to "Facturación obra".

Counterparty history is built from the adapted payables/receivables
(`adaptPayableDoc`/`adaptReceivableDoc`, `src/finance/adapters.js`), which
surface `categoryName` and `costScope` for this reason — never from the
adapter's own `projectName: 'Sin proyecto'` display placeholder, since
history matching always keys on `projectId`.

### Validation before confirming
`validateInvoiceClassification` is the confirm-step gate:
- a category is required and must match the direction (expense for a payable, income for a receivable);
- a payable requires a cost center, and it must pass `validateCostCenterAssignment` (a direct center needs a project, an indirect one must not have one);
- a receivable filed as "Facturación obra" requires a project; any other receivable category needs neither a project nor a cost center.

### What gets persisted
`buildClassificationFields` produces the exact shape written on the CXP/CXC:
`categoryName, projectId, projectName, costCenterId, costScope`.

### Reconciliation inheritance
When a bank movement is reconciled to one or more of these documents,
`reconcileMovement.js` copies the classification onto the movement:
`categoryName`/`projectId`/`projectName`/`costCenterId` from the linked
documents (falling back to whatever the movement already had), and
`costScope` with precedence documents → movement → derived from the
inherited `costCenterId` → `''`. This is what lets an overhead invoice
reconciled to its payment resolve a scope even though nobody classified the
bank movement directly.

### The statement-only path (inbox)
Not every expense ever gets an invoice (payroll, VAT, bank fees…). Each
taxonomy category carries `evidence: 'invoice' | 'statement'`, and
`evidenceStatusOf` (`src/finance/costScope.js`) reports, per movement:
`'not-required'` (inflow, transfer, no category, or a statement-evidence
category), `'documented'` (invoice-expected outflow with a linked payable) or
`'missing-invoice'` (invoice-expected outflow with none). This is a SEPARATE
signal from `pendingReasonOf`/coverage — a statement-only expense is complete
once categorized and destined. The Clasificador inbox (`Classifier.jsx`)
surfaces `'missing-invoice'` outflows in their own "Sin factura" tab,
alongside — not instead of — "Sin categoría" / "Sin obra" / "Sin conciliar".

## Deploy
```bash
firebase deploy --only firestore:rules,hosting
```
