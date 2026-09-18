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

## Correcting an archived invoice
The archive was append-only at first: no edit, no delete, no way to fix a
mistake short of leaving a wrong row in place forever. `InvoiceViewer.jsx`
offers three admin/manager-only actions, every accounting decision for
which lives in `src/finance/invoiceAmendment.js` (planInvoiceEdit /
planInvoiceDelete / planInvoiceReplace) and is turned into effects by
`lib/amend.js` (applyInvoiceEdit / applyInvoiceDelete / applyInvoiceReplace).

### LOCK — when an obligation must not move
An obligation (the CXP/CXC this invoice created) is LOCKED when touching its
amount or cancelling it would disagree with money that already moved:
`paidAmount > 0`, a non-empty `payments[]`, status `partial`/`settled`, or a
non-void bank movement already references it (`payableId`/`payableIds`/
`payableAllocations`, or the `receivable*` equivalents). A LOCKED obligation's
amounts render disabled with a muted explanation; every other field (header,
classification) stays editable.

### Owned vs. foreign links
`invoiceDocument.linkMode` is a per-DOCUMENT field, not per-link — a PDF
re-archived and attached to further obligations can carry more links than the
original `create-ordinary` call produced, and nothing on a link records which
archive operation created it. So a link counts as OWNED only in the one
provable case: `linkMode === 'create-ordinary'` AND the document carries
EXACTLY ONE link. Every other shape (`attach-existing`, or more than one
link) is treated as FOREIGN — this feature never cancels or rewrites an
obligation it cannot prove it created.

### Editar
Always editable: counterparty, invoice number, issue date (shifting the
obligation's `dueDate` by the same delta, but only while it still equals the
intake default of issue date + 30 days — an operator-adjusted due date is
never silently moved), category, project, cost center. Amounts (net/tax/
gross) are editable only when the owned obligation is not LOCKED, and the
usual invariants (net + tax ≈ gross, cent precision) are re-checked. A
classification change propagates to bank movements linked ONLY to this one
obligation (never a movement shared by several documents — those are listed
to the user instead). `attach-existing` links: only the archive metadata is
edited, the foreign obligation is untouched. **Direction is never editable**
— it decides which collection (`payables` vs `receivables`) and which
accounting rules apply; changing it would mean creating a different kind of
document, not editing this one, so the correction is delete-and-re-archive.

### Reemplazar PDF
Picking a file only hashes it and opens a mandatory-reason dialog (mirrors
DELETE's own) — nothing is sent until it is confirmed. Once confirmed, the
file is validated exactly like intake (PDF signature, ≤ 2 MiB, not the same
sha256 as the current file) AND checked against an authoritative
`findInvoiceDocument(sha256)` lookup: if the new file's sha256 already
belongs to a DIFFERENT archived invoice, the replace fails closed with a
Spanish error and NOTHING is uploaded — `commitInvoiceArchive`'s intake-time
`merge:true` + `arrayUnion(links)` must never run for a replace, or it would
silently pool both invoices' links and overwrite one's metadata with the
other's. Only once both checks pass does it create a new
`invoiceDocuments/{newSha}` carrying the same metadata and links, re-point
every linked obligation's `invoiceDocumentIds` from the old sha to the new
one, and only then delete the old document's chunks and the old document
itself.

### Eliminar
Removes the back-reference from every linked obligation (owned or foreign —
this is cleanup of a now-dangling pointer, never an accounting change), then
the PDF chunks, then the archive document. An optional "Anular también la
CXP/CXC" checkbox additionally cancels the obligation through the existing
soft `cancelPayable`/`cancelReceivable` path (never a hard delete) — offered,
and enabled, ONLY for an OWNED, unlocked obligation; a LOCKED or FOREIGN one
disables the checkbox with the reason shown next to it, and the PDF is still
removed. That cancellation carries the DELETE reason into the obligation's
OWN `auditTrail` (`cancelPayable`/`cancelReceivable` accept an optional
`{ reason, source }` — with no options every other caller keeps the exact
same generic detail as before), e.g. "Anulada al eliminar la factura
archivada Nº RE-2026-050. Motivo: factura duplicada" instead of the generic
"cancelada desde la mesa maestra". Mandatory reason, type-to-confirm with the
invoice number, one `auditLog` entry with the full `before` snapshot. DELETE
and REPLACE both reject an empty/whitespace reason inside the PURE planner
(`planInvoiceDelete`/`planInvoiceReplace`), not only in the UI — mirrors
`planInvoiceEdit`'s own requirement — so a future or programmatic caller
cannot skip the dialog to bypass it.

### Ordering and partial failure
EDIT attempts the owned obligation patch, then linked bank movements, then
the archive metadata — independently, so one stage failing does not skip the
next, and the outcome reports exactly which stage(s) failed. DELETE is
strictly gated: back-references and any requested cancellation must succeed
before the chunks are deleted, and the chunks before the archive document
itself — a failure anywhere leaves a still-visible, retryable row instead of
an invisible orphan. REPLACE uploads and commits the new document and swaps
every back-reference BEFORE touching the old file, so a failure there leaves
the old PDF fully intact.

### Audit write failures never masquerade as success
The `writeAudit` effect is REQUIRED — a caller wired without it is a
programming error and `applyInvoiceEdit`/`Delete`/`Replace` throw before
touching a single obligation, movement, archive doc or PDF. Once the data
mutation itself has committed, though, a failed (or thrown) audit write must
never be reported as if nothing happened: the result carries
`auditFailed: true` (plus `auditError`) alongside `success: true`, and
`InvoiceViewer.jsx` shows a distinct warning toast — "La corrección se
guardó, pero no se pudo registrar en la auditoría. Anota el motivo y avisa al
administrador." — instead of the ordinary success toast. The data mutation's
own outcome is never flipped or rolled back because of this.

### Archive metadata allowlist
`updateInvoiceDocument(sha256, patch)` only accepts the exact fields
`planInvoiceEdit`'s `archivePatch` legitimately emits — `counterpartyName`,
`counterpartyId`, `invoiceNumber`, `issueDate`, `netAmount`, `taxAmount`,
`grossAmount`, `identity`. A patch carrying `sha256`, `sizeBytes`,
`chunkCount`, `chunkBytes`, `storage`, `links`, `family`, `direction`,
`createdAt`, `createdBy`, or any other unknown key is REJECTED with
`{ success: false, error }` and writes nothing — never silently stripped —
mirroring `validInvoiceMetadata()` in `firestore.rules`.

### No undo of a reconciliation
There is no working undo of a modern bank reconciliation in this app
(`unreconcileMovement` only clears legacy fields) — that is exactly why the
LOCK rule exists: once a bank movement references an obligation, this feature
refuses to change its amount or cancel it, rather than silently drifting from
money that already left or arrived.

## Deploy
```bash
firebase deploy --only firestore:rules,hosting
```
