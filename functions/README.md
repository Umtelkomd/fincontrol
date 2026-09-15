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

## Not covered here / before production

- Deploying the function and the Hosting rewrites
- Provisioning IAM and the production bucket for `ARCHIVE_BUCKET`
- Proving data residency for the `europe-west3` region
- Supplying `ARCHIVE_TENANT_ID` and `ARCHIVE_BUCKET` in production — via
  Cloud Functions parameters or Secret Manager, never an env file
- Deploying the Hosting `rewrites` that route `/api/invoice-pdfs**` to this
  function
