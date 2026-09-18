# Feature: classification-followup-fixes

Locator: `odd/tasks/classification-followup-fixes.md` · Engram topic: `odd/classification-followup-fixes/tasks`
Branch: `fix/classification-followups` (from `main` @ 6edeab8, PR #27 already merged and deployed to hosting)
Delivery strategy: `single-pr`, deliberately SMALL and separate (owner review: PR #27 was too large to bisect).
TDD: **strict, enabled** (source: user global CLAUDE.md) · Runner: `npx vitest run <file>` (full: `npm test`) · Lint: `npm run lint` · Build: `npm run build`
RDD: off (decided by global) → ordinary checks, delivery `disabled/unmanaged`.
Writer model: **opus** (explicit owner instruction 2026-09-18; overrides the default model table).

## Objective
Close the four defects an owner review of PR #27 raised and a read-only verification confirmed at `6edeab8`, while production
data is still UNMIGRATED (legacy project codes and cost-center values live next to v2 values).

## Problem (verified evidence, file:line at 6edeab8)
1. **Project code builder double count.** `src/features/settings/Projects.jsx` (~205) saves a structured code without stamping
   `legacyCode`. `src/finance/projectMatching.js` `buildProjectTokens` adds EVERY alias of the `LEGACY_PROJECT_CODE_MAP` entry whose
   target equals `project.code`. Rename one live Roßdorf project to `INS-RSD-BL1` by hand → its tokens include "Roßdorf 2" → a payable
   carrying only `projectName: 'Roßdorf 2'` matches BOTH the renamed project and its still-live sibling in `ProyectoDashboard` /
   `WipPanel`. Silent, reachable with one click, before any migration.
2. **REPLACE swap is not failure-safe.** `swapInvoiceLink` (`src/hooks/useInvoiceDocuments.js:205-218`) is two sequential `updateDoc`
   (`arrayRemove` then `arrayUnion`; Firestore cannot do both on one field in one write). The swap loop in `applyInvoiceReplace`
   (`src/features/facturas/lib/amend.js:247-252`) has NO try/catch: a failure rejects the promise instead of returning
   `{ partial: true }`, and old + new PDF bytes (≤ 4 MiB) coexist indefinitely. Between the two writes the obligation references no PDF.
3. **BudgetVsActual cost-center filter is broken.** `src/features/presupuesto/BudgetVsActual.jsx`: dropdown keyed by `cc.name`
   (`:801-804`) but the predicate compares `normCC(costCenterId)` — a stored CODE (`:585,612`); `normCC` (`:65-72`) is a third, older
   dictionary (OPE/ADM/LOG/FIN/VEN) that knows neither `CC-0xx` nor `CC-1xx`. Pre-existing, but v2 codes make it matter.
4. **Two project dictionaries.** `src/finance/projectCodeAliases.js` (`canonicalizeProjectCode`, `projectCodesMatch`,
   `extractProjectToken`) knows only short legacy codes: `projectCodesMatch('INS-RSD-BL1','QFF') === false`. Production callers:
   `useProjects.js:19,77` (duplicate detection), `usePayables.js:203,662`, `useReceivables.js:338,718` via `lumenContract.js`
   `normalizeProjectCode`, `Projects.jsx:307,312`. `normalizeProjectCode('INS-RSD-BL1 (Roßdorf 1)')` returns `ROSSDORF` because
   `extractProjectToken` prefers the short parenthesised part over the head code.

## Scope
In: the four fixes with tests; a README/doc note per behaviour change.
Out / not authorized: running scripts, touching production data, deploying, the migration itself, true atomicity of EDIT
(needs `updatePayable`/`updateReceivable` to accept a shared batch — separate work), a mounted-UI→Firestore test for edit/delete
(separate work), `firestore.rules`, theme, sanitizer, `viewedBy`, `PartialPaymentModal`, `firebase.json`, env guards, dependencies.

## Constraints
- `src/finance/*` stays pure. UI copy in neutral professional Spanish; code/comments/tests/docs in English; no task ids in code.
- Existing inputs to `canonicalizeProjectCode` / `normalizeProjectCode` / `projectCodesMatch` must keep their current outputs unless
  the old output is the defect being fixed — every such change is listed in the report with before/after.
- Conventional commits, NO AI attribution. Never stage the owner's unrelated untracked files (`plans/`, `scripts/_tmp_*`,
  `scripts/data/`, other untracked `scripts/*`, `src/lib/finance/alerts*`, `burnRate.js`, `documentLifecycle.js`, `.atl/`).
- ~400 changed lines per task is a heuristic only; never drop tests or comments to fit it. Forecast: ~700 lines → still one small PR.

## Tasks (route: delegated direct — writer trigger, each task touches 2+ non-trivial files)
- [x] F1 Project builder stamps `legacyCode`; alias tokens never capture another LIVE project's own code/name/displayName.
- [x] F2 REPLACE swap: per-obligation failure capture → `{ success:false, partial:true, failures[] }`, add-before-remove ordering so an
  obligation is never left without a PDF reference, old PDF deleted ONLY when every swap succeeded, retry converges.
- [x] F3 BudgetVsActual filter compares cost-center CODES resolved through `resolveLegacyCostCenter`; legacy OPE/ADM/… kept as aliases.
- [x] F4 One project dictionary: structured codes are first-class in `projectCodeAliases.js`; legacy ↔ v2 resolve to the same obra;
  `extractProjectToken` prefers a structured head code; `useProjects` duplicate detection sees `QFF` ≡ `INS-RSD-BL1`.

## Acceptance criteria
1. Renaming one Roßdorf project to `INS-RSD-BL1` never makes a sibling's documents appear under it while the sibling is live; after
   the sibling is inactive/`mergedInto`, they do.
2. A failing swap returns a partial result, keeps the old PDF and every obligation still references a readable PDF.
3. Filtering BudgetVsActual by a cost center returns movements stored with its v2 code, its legacy code and its legacy label.
4. `projectCodesMatch('INS-RSD-BL1','QFF')`, `('INS-RSD-BL1','QFF-002')` → true; unrelated obras → false; all pre-existing
   alias tests unchanged.
5. `npm test` (modulo the 7 known local-environment failures), `npm run lint`, `npm run build` green; CI green.

## Progress / evidence (2026-09-18, writer on opus, route: delegated direct)
- F1 `8164258` — RED 5 failed (projectMatching) / 2 failed (Projects) → GREEN 24 / 25 passed. `buildProjectTokens(project, { liveProjects })`
  is byte-identical without the option; aliases equal to a live sibling's code/name/displayName/legacyCode are excluded, re-admitted once the
  sibling is inactive or `mergedInto`. Builder stamps `legacyCode` (first original wins) and warns on merge-group renames.
- F2 `86aeccc` — RED 3 / 6 / 1 failed → GREEN 24 / 34 / 13 passed. `swapInvoiceLink` = `arrayUnion(new)` then `arrayRemove(old)`; swap failures →
  `{ success:false, partial:true, failures }`, both deletes skipped, audit still written. Retry recognised by `isOwnHalfFinishedReplacement`
  (non-empty equal `identity` AND equal link set); anything else still refused (3 tests).
- F3 `3fb7679` — RED 16 / 3 failed → GREEN 57 / 17 passed. `resolveStoredCostCenter` extracted into `costCenterCatalog.js`, shared by the screen and
  the migration planner (planner suite unchanged: 79 passed). `normCC` removed; its tokens folded into the catalogue's legacy map.
- F4 `ceef4ab` — RED 21 / 2 / 3 / 2 failed → GREEN 121 / 7 / 8 / 27 passed. Dictionary primitives moved down into `projectCodeAliases.js`
  (`projectCode.js` re-exports); `canonicalObraKey`; `projectCodesMatch` compares obra keys. Changed pre-existing outputs: only
  `extractProjectToken` for "structured head + short parenthesised part" (`INS-RSD-BL1 (Roßdorf)` `ROSSDORF`→`INS-RSD-BL1`, same for VAN/WSC/UMT);
  34-row pinned baseline for everything else. `createProject` rejects a second project for the same obra; `handleImportDefaults` counts by obra key.
- Correction `0320d32` (parent error): the parent instructed "OPE stays unresolved" on a FALSE premise. `git show 6edeab8:…/BudgetVsActual.jsx`
  shows `'OPE': 'Despliegue'` in the same `LEGACY_CC_MAP` as ADM/LOG/FIN/VEN → `OPE`, `CC-OPE` → `CC-110`. RED 2 failed → GREEN 154 passed.
  Still genuinely unrecorded: `CC-006..CC-009`, "Contratistas". Consequence: the migration dry-run will propose `OPE → CC-110` remaps.
- Parent spot checks: 293 passed, then the touched suites again after the correction (see PR). Writer: `npm test` 3078/3085 (the 7 known
  local-environment failures only), lint clean, build clean. Stashes 3, untracked owner files untouched, `scripts/`, `firestore.rules`,
  `package.json`, `firebase.json` unchanged vs `main`.
- Risk assessment base `main`: medium (`executable_change`, 1,988 lines) → writer self-verification (opus, not a small-model profile) + parent
  spot check; RDD off → passive/unmanaged. Final size: 28 files, +1,873 / −198.
- Open owner decision: the unified dictionary makes `RSD`≡`QFF`, `HXT`≡`FBX`, `WRZ`/`WUR`≡`NE4` (it reads the validated mapping literally).
  If any of those is a separate obra, split its `LEGACY_PROJECT_CODE_MAP` entry.
- Not done / pending: CI; not deployed; true atomicity of EDIT and a mounted-UI→Firestore test remain out of scope.

## Next step
Owner: review and merge the PR; deploy hosting when ready. Migration still requires backup + dry-run after the Firestore quota resets.
