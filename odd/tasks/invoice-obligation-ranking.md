# Feature: invoice-obligation-ranking

Locator: `odd/tasks/invoice-obligation-ranking.md` · Engram topic: `odd/invoice-obligation-ranking/tasks`
Branch: `feat/invoice-obligation-ranking` (isolated worktree from `17c8c85`) · Delivery strategy: `ask-on-risk`
TDD: **strict, enabled** (source: existing project ODD convention) · Client runner: `npx vitest run <file>` · Worker runner: `npm test --prefix worker`
RDD: off (global) → ordinary verification only.

## Objective
Make invoice causation faster: when an operator links an uploaded invoice to an existing CXP/CXC service, show the five closest obligations first and keep an explicit `Ver todas` escape hatch.

## Problem
`InvoiceIntakePanel` currently renders every obligation in the selected family/source and only offers literal text filtering. The invoice PDF already provides counterparty, invoice number, dates, and amounts, but those signals are not used to rank likely links.

## Design
- Use an authenticated Cloudflare Worker on the free tier instead of Firebase Cloud Functions/Blaze. The Worker verifies the Firebase ID token, resolves the protected user registry through Firestore REST, reads authoritative obligations with the same token/rules, applies a deterministic shortlist, and asks a structured-decision provider to score each invoice/candidate pair.
- Put Jev behind a provider-neutral `ObligationMatcher` contract. The HTTP endpoint and UI consume only the generic match response, so a future open-source structured-decision model can replace Jev without changing product code.
- Use Jev noul probabilities for independent candidate scores, batched into one System One request after deterministic prefiltering.
- Never auto-link and never let model output bypass `planInvoiceLink()` validation.
- Default UI: ranked top five. `Ver todas` reveals the complete existing local candidate list and search. Provider errors/timeouts degrade to the full local list without blocking invoice archiving.
- Keep secrets in encrypted Cloudflare Worker secret bindings. No Jev key may use a `VITE_*` variable or reach the browser.

## Scope
In: Cloudflare Worker bootstrap, provider-neutral matcher, Jev adapter, Firebase-token auth/role/tenant guard through Firestore REST, client HTTP adapter/hook, intake ranking UI, focused tests, required config/example documentation.
Out: production deployment, production Firestore writes, automatic candidate selection, changing accounting validation, changing theme, editing the user-dirty `src/features/facturas/README.md`.

## Constraints
- Preserve sanitizer, `viewedBy`, `PartialPaymentModal`, and `firebase.json` no-cache headers.
- UI copy remains Spanish; code/comments/tests/config documentation default to English.
- Do not expose invoice PDFs or full extracted text to Jev; send only bounded structured invoice/candidate fields.
- Do not overwrite unrelated dirty work in `/Users/jarl/Dev/fincontrol`; implementation lives in the isolated worktree.
- No deploy, billing change, secret creation, or production data operation without explicit confirmation.

## Tasks
- [x] T1 Backend matcher: create the Functions package, deterministic shortlist, generic matcher contract, Jev adapter, authenticated callable, and backend tests. Route: delegated writer (multi-file write trigger). Evidence: RED missing modules; GREEN 17 tests; TypeScript build passed. No commit (not authorized).
- [x] T2 Client workflow: add the callable client/hook and Top 5 + `Ver todas` UI with loading/fallback states and focused UI tests. Route: delegated writer (multi-file write trigger). Evidence: 21 focused tests and scoped ESLint passed; `git diff --check` passed. No behavioral RED was observed because the initial runner failure was environmental. No commit (not authorized).
- [x] T3 Verification and handoff: run focused/full checks permitted by the environment, inspect the diff, document required secret/deploy setup, and report all pending external steps. Route: independent delegated verifier because native assessment was unavailable/high by policy. Evidence: 17 backend tests, 137 client/domain tests, Functions build, scoped ESLint, synthetic client build, and `git diff --check` passed. Parent spot check reran 17 backend tests successfully. No commit or deploy.
- [x] T4 Free hosting migration: replace the Firebase Functions/Blaze backend and callable client with a Cloudflare Worker Free HTTP endpoint. Preserve the generic matcher, authoritative Firestore reads, Firebase ID-token authorization, and graceful fallback. Route: delegated writer (multi-file write trigger). Evidence: Worker 12/12 tests, Worker typecheck, client/domain 140/140 tests, scoped ESLint, and whitespace check passed; obsolete Functions package removed. No commit or deploy.
- [x] T5 Reverification: run Worker tests/typecheck, client/domain tests, lint/build, dependency audit, Wrangler dry-run, and independent security/correctness readback. Route: independent delegated verifier because native assessment was unavailable/high by policy. Evidence: Worker 17/17, client/domain 140/140, typecheck, ESLint, synthetic build, Wrangler dry-run, production audit, whitespace check, and parent spot check passed. One medium missing-`exp` finding was fixed RED→GREEN and independently reverified. No commit or deploy.

## Acceptance criteria
1. `Vincular a existentes` shows at most five ranked suggestions by default and never auto-selects one.
2. `Ver todas` reveals the complete family/source-filtered list and preserves manual search and selected IDs.
3. Jev receives a bounded structured shortlist and returns generic candidate IDs/scores through a provider-neutral interface.
4. Missing credentials, timeout, invalid output, or callable failure falls back to the full local list and never blocks archiving.
5. Only authenticated admin/manager users in the resolved tenant can invoke ranking; the API key remains server-side.
6. Existing `archiveInvoice()` / `planInvoiceLink()` invariants remain the final link authority.
7. Focused tests, lint/typecheck, and client build pass, or every unavailable/failing check is recorded.

## Progress / evidence
Forecast: ~650 authored changed lines across backend, client, tests, and config (>400 review heuristic). Delivery strategy requires a split decision before any commit; no commit is authorized yet.
- 2026-09-20 exploration: current UI lists all family/source candidates; no Functions backend or App Check exists; TypeSafe HTTP API supports batched typed questions and Jev noul probabilities suitable for re-ranking.
- Worktree isolation created at `/Users/jarl/Dev/fincontrol-invoice-ranking` to avoid unrelated dirty work on `feat/treasury-ritual-guide`.
- T1 backend: Firebase callable reads the user registry and authoritative tenant obligation collection, prefilters to 20, and returns 5 matches. Provider-neutral matcher wraps Jev's map-shaped Noul request. RED observed before modules existed; GREEN `npm test --prefix functions` = 17 passed; `npm run build --prefix functions` passed. `npm install --prefix functions` reported 9 moderate audit findings. Live Jev and deployment remain untested/unperformed.
- T2 client: callable adapter sends only six structured invoice fields; debounced stale-safe hook drives top-five suggestions; `Ver todas` restores the complete local list/search and selection remains reducer-owned. Focused suite = 21 passed; scoped ESLint and whitespace check passed. Root `npm ci` installed the lockfile unchanged and reported 32 dependency vulnerabilities plus a Node 26 `superstatic` engine warning. Ordinary build stopped at the intentional missing `VITE_FIREBASE_*` guard.
- T3 independent verification: native assessment returned unavailable, so policy treated the candidate as high risk. Functions tests 17/17, Functions TypeScript build, combined Facturas/intake/archive tests 137/137, scoped ESLint, synthetic-config production build (2,841 modules), and whitespace check all passed. Official TypeSafe API/SDK/rerank docs confirm the static System One contract. No severe/major findings. Parent spot check reran Functions tests: 17/17 passed.
- Live Jev verification 2026-09-21: one synthetic two-candidate request succeeded in 833 ms; the exact match scored 0.99 and the unrelated candidate 0.02. No real invoice/customer data was sent.
- Accepted architecture change 2026-09-21: Firebase Blaze is rejected because it is paid. Official Cloudflare documentation confirms the Workers Free tier includes 100,000 requests/day and encrypted secret bindings; Firebase documents that Firestore REST requests carrying a Firebase ID token are evaluated through Firestore Security Rules.
- T4 Cloudflare migration: Worker verifies Firebase JWTs cryptographically, forwards the ID token to Firestore REST so Security Rules remain active, derives role/appId from `users/{uid}`, reads up to 2,000 authoritative obligations with bounded pagination, and makes zero Firestore writes. Client now sends the six allowlisted fields plus Firebase bearer token to `VITE_OBLIGATION_MATCHER_URL`. Obsolete Firebase Functions files/config were removed.
- Live Worker-adapter Jev verification 2026-09-21: synthetic two-candidate request succeeded in 793 ms; exact match 0.99, unrelated match 0.01. A first direct Node TypeScript import failed before any API call because Node strip-only mode cannot transform parameter properties; a separate read-only diagnosis selected temporary `tsc` emission, which succeeded and cleaned itself.
- T5 independent verification: Worker 12/12 (before correction), typecheck, client/domain 140/140, scoped ESLint, synthetic production build (2,839 modules), Wrangler dry-run bundle (55.17 KiB / 14.60 KiB gzip), whitespace check, and Functions absence all passed on a hash-stable tree. Production dependency audit is clean; five high findings are dev-only chains under Wrangler 4.38.0 (`miniflare` → `sharp`/`undici`/`ws`) with an available Wrangler update.
- T5 correction: verifier found that JOSE validated expiry only when `exp` existed. Worker now requires `exp` and a finite numeric value; tests cover missing/expired exp and invalid alg/kid. RED 1 failed/16 passed → GREEN 17/17; independent correction verification, typecheck, whitespace check, and parent 17/17 spot check passed. No remaining blocker.
- Limitations: no backend deployment, Cloudflare authentication/account check, secret creation, or production access. Free-tier account/quota and live Worker runtime remain externally unverified; only local Wrangler bundling and the direct Worker Jev adapter were verified. The tracked client files carry broad formatting churn from an external autoformat during earlier verification; a delegated attempt to reduce it safely was blocked, so no cleanup edit was made. `.atl/skill-registry.md` is unrelated runtime churn and is excluded from the feature.

## Next step
Owner decision before delivery: reduce/review the large formatted diff and choose commit slices; then, only with explicit authorization, configure the Cloudflare Free account variables/secret, deploy the Worker, set `VITE_OBLIGATION_MATCHER_URL`, rebuild Hosting, and run one authenticated browser smoke test. No paid Firebase Blaze plan is required.
