# FinControl Invoice PDF Archive

A private, content-addressed PDF archive. It exposes one Cloud Function,
`invoicePdfArchive` (`onRequest`, region `europe-west3`), reached only through
the Hosting rewrites for `/api/invoice-pdfs` — it is never called from a
client with a direct Cloud Functions URL in production.

## HTTP contract

| Method | Path                        | Auth              | Body                                 | Success                                                              |
| ------ | --------------------------- | ----------------- | ------------------------------------- | --------------------------------------------------------------------- |
| POST   | `/api/invoice-pdfs`         | `Bearer <idToken>` | raw PDF bytes, `Content-Type: application/pdf`, ≤ 20 MiB | `200 { sha256, sizeBytes, mimeType }` (idempotent: re-uploading the identical bytes returns the same body) |
| GET    | `/api/invoice-pdfs/<sha256>` | `Bearer <idToken>` | —                                      | `200`, raw PDF bytes, `Content-Type: application/pdf`, `Content-Disposition: inline; filename="<sha256>.pdf"`, `Cache-Control: private, no-store` |

Errors are `{ "error": "<code>" }`:

| Status | Code                    | When                                                             |
| ------ | ----------------------- | ------------------------------------------------------------------ |
| 400    | `invalid-body`          | Empty body, or size mismatches a declared `Content-Length`         |
| 403    | `access-denied`         | Missing/invalid token, anonymous session, or no matching membership |
| 404    | `not-found`             | Any path other than the two above (including a trailing slash), or a GET for a well-formed digest with no archived object |
| 405    | `method-not-allowed`    | Any method besides `POST` on the root or `GET` on a digest path (`Allow: GET, POST`) |
| 409    | `conflict`              | Re-upload with the same digest but different stored bytes/metadata |
| 413    | `too-large`             | Body over 20 MiB                                                    |
| 415    | `unsupported-media-type`| `Content-Type` other than bare `application/pdf`, or bytes that don't start with the PDF signature |
| 500    | `internal-error`        | Any other backend failure (storage errors included)                 |

## Authorization model

Every request needs `Authorization: Bearer <Firebase ID token>`. The token is
verified with `verifyIdToken(token, checkRevoked=true)`; an anonymous
`sign_in_provider` is rejected outright. The verified `uid` is then looked up
in Firestore at `users/{uid}`, which must exist and carry `{ appId, role }`
where `appId` equals this deployment's tenant and `role` is `manager` or
`admin`. There is exactly one tenant per deployed function instance — the
tenant is fixed configuration, never taken from the request or the token.

## Runtime configuration

The platform provides `GCLOUD_PROJECT`. Two values are deployment-specific
and must be supplied alongside it:

- `ARCHIVE_TENANT_ID` — the Firebase app ID that `users/{uid}.appId` must match
- `ARCHIVE_BUCKET` — the GCS bucket backing the archive

Outside the emulator, `configuration()` in `src/invoiceArchive/runtime.mjs`
rejects a project id starting with `demo-` and rejects any of the emulator
host variables being set — this is a production/emulator split, not an
oversight.

Under the emulator (`FUNCTIONS_EMULATOR=true`, set by firebase-tools itself),
the same function requires an exact fixed set of values instead — enforced
by `configuration()`, not merely conventional:

- `GCLOUD_PROJECT=demo-fincontrol`
- `ARCHIVE_TENANT_ID=1:123456789:web:demo`
- `ARCHIVE_BUCKET=demo-fincontrol.appspot.com`
- `FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099`
- `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080`
- `FIREBASE_STORAGE_EMULATOR_HOST=127.0.0.1:9199`
- `STORAGE_EMULATOR_HOST=http://127.0.0.1:9199`

`firebase emulators:exec` sets the four emulator host variables on every
child process automatically; only `GCLOUD_PROJECT`, `ARCHIVE_TENANT_ID` and
`ARCHIVE_BUCKET` need to be exported onto its parent process. No `.env` file
is read anywhere in this flow.

## Storage layout

Each archived PDF is one immutable GCS object at
`invoice-pdfs/{tenantId}/{sha256}.pdf`, written once with
`ifGenerationMatch: 0`, `contentType: application/pdf`,
`cacheControl: private, no-store`, and frozen custom metadata
(`archiveVersion`, `tenantId`, `sha256`, `sizeBytes`, `mimeType`) that every
later read re-verifies against the pinned generation.

## Running the tests

Native unit tests (no network, no emulator):

```
npm run test:archive
```

End-to-end smoke test against the local emulators (auth, firestore, storage,
functions) — exercises the real HTTP handler over `fetch`, with synthetic
users created and seeded through the Auth/Firestore emulator REST APIs:

```
GCLOUD_PROJECT=demo-fincontrol \
ARCHIVE_TENANT_ID=1:123456789:web:demo \
ARCHIVE_BUCKET=demo-fincontrol.appspot.com \
npm run test:archive:runtime
```

## Prerequisites

- Node 22 (`functions/package.json` pins `engines.node`)
- A Java 21 runtime, required by the Firestore and Storage emulator jars
- Make sure both are first on `PATH` before running either command above if
  your global toolchain differs

## Production rollout

Everything below assumes the tests above are green and this branch is merged.

### Prerequisites

- Firebase project `umtelkomd-finance` is on the Blaze plan (required for
  the Storage bucket below and outbound Cloud Functions use).
- Firebase Storage is enabled (Console → Build → Storage → Get started)
  with the default bucket `umtelkomd-finance.firebasestorage.app`, location
  `europe-west3` — the project has no bucket at all until this runs once.
- `npm ci --prefix functions` has been run locally at least once.
- The Firebase CLI is logged in, and `.firebaserc`'s `default` alias already
  points at `umtelkomd-finance`.

### Configuration

Create `functions/.env.umtelkomd-finance` with exactly:

```
ARCHIVE_TENANT_ID=1:597712756560:web:ad12cd9794f11992641655
ARCHIVE_BUCKET=umtelkomd-finance.firebasestorage.app
```

This file is covered by `functions/.gitignore` (`.env*`) and never
committed. `firebase-tools` 15.29.0 loads `functions/.env.<projectId>` at
deploy time and applies its lines as function env vars for that project
only — `firebase emulators:exec` never reads it, so the test suites above
are unaffected either way. Functions `params` are deliberately not used
instead: an unresolved param blocks on interactive input, which a
non-interactive (CI) deploy must not do.

### IAM

2nd-gen functions run as the default compute service account,
`597712756560-compute@developer.gserviceaccount.com`. Skip this if the
project still grants it the broad `Editor` role; otherwise grant once —
`datastore.user` and `firebaseauth.viewer` project-wide, `storage.objectAdmin`
scoped to the bucket only:

```
gcloud projects add-iam-policy-binding umtelkomd-finance \
  --member="serviceAccount:597712756560-compute@developer.gserviceaccount.com" \
  --role="roles/datastore.user"
gcloud projects add-iam-policy-binding umtelkomd-finance \
  --member="serviceAccount:597712756560-compute@developer.gserviceaccount.com" \
  --role="roles/firebaseauth.viewer"
gsutil iam ch \
  serviceAccount:597712756560-compute@developer.gserviceaccount.com:roles/storage.objectAdmin \
  gs://umtelkomd-finance.firebasestorage.app
```

### Deploy order

Run every command with `npx -y firebase-tools` from the repo root.

1. `deploy --only storage` — publishes `storage.rules` (deny-all); the
   bucket must already exist from Prerequisites.
2. `deploy --only functions` — `predeploy` in `firebase.json` runs
   `npm run test:archive` (native, no network) and aborts on failure. The
   first deploy also enables the required Blaze APIs and can take minutes.
3. `deploy --only hosting` — rebuilds the app and publishes the
   `/api/invoice-pdfs**` rewrites alongside it.
4. `npm run verify:archive` — a pass prints five `PASS <probe-id>` lines and
   exits 0; anything else (including an SPA-HTML diagnosis) means the route
   is not live yet.
5. Manual check: sign in as a `manager` or `admin` user, archive a small
   text PDF from `/facturas`, and open it back up in the viewer.

### Rollback

```
npx -y firebase-tools functions:delete invoicePdfArchive --region europe-west3
```

Then redeploy Hosting from `main` (without the rewrites) so
`/api/invoice-pdfs**` falls back to the SPA. Already-archived GCS objects
and `invoiceDocuments` Firestore rows are left in place — content-addressed
and inert without the function, so this is harmless.

### Operations

- Logs: Cloud Logging, filtered to the `invoicePdfArchive` function
  (`europe-west3`).
- Cost bounds: `maxInstances: 2`, `512MiB`, `60s` timeout cap all traffic.
- `403` = missing/invalid/anonymous token or no matching membership; `404` =
  unknown route or an unarchived digest; `415` = wrong `Content-Type` or a
  bad PDF signature. None of these alone indicate a bug.
- The bucket is private; the archive never issues public tokens or signed
  URLs — every read goes through the authenticated function.

## Not covered here / before production

- Actually running the deploy (this document describes it; it has not been executed yet)
- Proving data residency for the `europe-west3` region
- OCR of archived PDFs
- Credit note handling
