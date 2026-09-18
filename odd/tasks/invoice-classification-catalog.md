# Feature: invoice-classification-catalog

Locator: `odd/tasks/invoice-classification-catalog.md` · Engram topic: `odd/invoice-classification-catalog/tasks`
Branch: `feat/invoice-classification-catalog` (from `main` @ e6af89e) · Delivery strategy: `single-pr` (user asked for one PR)
TDD: **strict, enabled** (source: user global CLAUDE.md "Strict TDD Mode: enabled") · Runner: `npx vitest run <file>` (full: `npm test`) · Lint: `npm run lint` · Build: `npm run build`
RDD: off (decided by global) → ordinary checks only, delivery `disabled/unmanaged`.

## Objective
When an invoice PDF is loaded, classify and register the income/expense with project + cost center + category,
suggested automatically and confirmed by a human. Expenses that never get an invoice (statement-only) are
classified on their own path in the bank inbox. Underneath: one coherent cost-center catalogue and one project
code nomenclature.

## Problem (evidence from exploration)
- `InvoiceIntakePanel` captures no classification; `buildObligationPayload(header, { projectId })` exists but is never
  passed a project (`src/features/facturas/lib/intake.js`), so every CXP/CXC from the wizard has `projectId: ''`.
- `reconcileMovement.js` copies classification from the linked document onto the bank movement, so the gap propagates.
- Cost centers mix nature and responsibility: production data holds `CC-002..CC-009`, `CC-NOM` plus free text
  (`Contratistas`, `Seguros`, `Gestorías`, `Financiero`, `OPE`, `Sin asignar`). Code only declares `CC-001..CC-005`
  (`src/constants/costCenters.js`). `costCenterId` is sometimes a doc id, mostly a code/label: not a reliable key.
- Three project code sources disagree: `projectCodeAliases.js` (13), `lumenContract.js` seed (17), production
  (`AMD-001`, `QFF-001/002`, `UGG-001`, `WSC`, `WEST-001`, `WESTC_MDU`, `Meschede`, typo `Würzwurg`).
- The inbox cannot tell "expense waiting for its invoice" from "expense that never has one".

## Design

### Three orthogonal axes (never mix them again)
| Axis | Question | Source |
|---|---|---|
| Category | WHAT was bought (nature) | `src/finance/taxonomy.js` v2 — unchanged names |
| Project | WHICH contract earns/consumes it | `projects` collection, new code scheme |
| Cost center | WHO/which unit is responsible | new catalogue below |

`costScope` stops being an independent choice: it is DERIVED from the cost center kind
(`direct` → `project`, `indirect`/`clearing` → `overhead`). Rule: project present ⇒ direct center (defaulted from
the project's line); no project ⇒ indirect center (defaulted from the category).

### Cost center catalogue v2 (`costCenterId` stores the CODE; catalogue doc id === code)
| Code | Name | Kind | Project line |
|---|---|---|---|
| CC-100 | Obra civil (Tiefbau) | direct | TB |
| CC-110 | Soplado y fusiones | direct | BL |
| CC-120 | NE4 instalación en vivienda | direct | N4 |
| CC-130 | MDU cableado interior | direct | MD |
| CC-190 | Dirección de obra y documentación | direct | SV |
| CC-200 | Flota y vehículos | indirect | — |
| CC-210 | Equipos, almacén y herramienta | indirect | — |
| CC-220 | Alojamientos (pool sin obra) | indirect | — |
| CC-300 | Administración y finanzas | indirect | — |
| CC-310 | Dirección general | indirect | — |
| CC-320 | Personas: reclutamiento y formación | indirect | — |
| CC-330 | Oficina, IT y telefonía | indirect | — |
| CC-900 | Fiscal y financiero | indirect | — |
| CC-NOM | Nómina y seguridad social | clearing | — |

`CC-NOM` keeps its code: `useNominas` resolves it by code and payroll is allocated to projects by `allocatePayrollCost`.

Default indirect center by category id (used only when there is no project):
combustible, cuotas-alquiler-vehiculos, mantenimiento-vehiculos → CC-200 · equipos → CC-210 · alojamiento → CC-220 ·
asesoria, seguros-empresa, tarjeta-corporativa, otros-administrativos → CC-300 · oficina → CC-330 ·
otros-personal → CC-320 · salarios, seguridad-social, impuesto-nomina → CC-NOM ·
iva, impuesto-beneficios, intereses-comisiones, amortizacion-prestamos, intereses-socios → CC-900 ·
materiales, reparaciones, danos-terceros, subcontratas → none (a project is required).

Legacy resolution (accent/case-insensitive): CC-001→CC-100 · CC-002→CC-120 · CC-003→CC-120 · CC-004→CC-300 ·
CC-005→CC-110 · "Obra Civil"→CC-100 · "Instalaciones y Reparaciones"→CC-120 · "NE4"→CC-120 · "Despliegue"→CC-110 ·
"Administrativo"/"Gestorías"/"Gestorias"/"Seguros"→CC-300 · "Financiero"→CC-900 ·
"Nómina y Seguridad Social"→CC-NOM · "Sin asignar"→'' · CC-006..CC-009, "Contratistas", "OPE" → UNRESOLVED
(their meaning is not in the repo; the migration resolves them by the live doc NAME and reports what is left).

### Project code nomenclature: `CLI-SIT-LLn`
- `CLI` 3 letters: who pays us (INS Insyte, VAN Vancom, WSC Wesconnect, UMT internal).
- `SIT` 3 alphanumerics: site or frame contract (RSD Roßdorf, HXT Höxter, WRZ Würzburg, MSD Meschede, GEN generic).
- `LL` line: TB Tiefbau · BL blowing/splicing · N4 NE4 · MD MDU · SV site services · OH internal overhead.
- `n` lot 1–99, no padding. Regex: `^[A-Z]{3}-[A-Z0-9]{3}-(TB|BL|N4|MD|SV|OH)[1-9][0-9]?$`.
- The line gives the default cost center (table above; OH → CC-300).
- Legacy codes stay VALID (flagged `legacy`), never rejected: the scheme is additive.

Proposed legacy → new mapping (**owner must validate before the migration is applied**; `confidence`):
QFF, QFF-001, PROY-001, RSD, "Roßdorf 1" → INS-RSD-BL1 (high) · QFF-002, "Roßdorf 2" → INS-RSD-BL2 (high) ·
NE4, PROY-004, WRZ, WUR, "Würzburg", "Würzwurg" → INS-WRZ-N41 (medium) · UGG, UGG-001, "Vancom NE4" → VAN-UGG-N41 (medium) ·
WSC, WEST-001, "Wesconnect", "NE4 West-connect" → WSC-GEN-N41 (medium) · WESTC_MDU → WSC-GEN-MD1 (medium) ·
FBX, PROY-003, HXT, "Höxter Nord" → INS-HXT-TB1 (low: line unknown) · "Meschede" → INS-MSD-TB1 (low) ·
AMD-001, "Overhead" → UMT-ADM-OH1 (high). Everything else (QDU, AUSTRIA, EHR, BIE, BAM, LGN, GFP, DGF, WCB) → unmapped, kept legacy.

### Evidence expectation (statement-only path)
Each taxonomy category gains `evidence: 'invoice' | 'statement'`. `statement` = never has an invoice:
salarios, seguridad-social, impuesto-nomina, iva, impuesto-beneficios, intereses-comisiones, amortizacion-prestamos,
intereses-socios, tarjeta-corporativa, transferencia-interna, and all income except `Facturación obra`. Everything else = `invoice`.
New pure `evidenceStatusOf(movement)` → `'not-required' | 'documented' | 'missing-invoice'`
(outflow, invoice-expected category, no `payableId`/linked documents → `missing-invoice`). It is a SEPARATE signal:
`pendingReasonOf` / coverage stay unchanged (a statement-only expense is complete with category + destination).

## Scope
In: pure modules + tests, intake wizard classification step, inbox "Sin factura" tab + cost-center defaults,
settings screens (catalogue seed, project code builder), dry-run migration script, backup coverage, docs.
Out / not authorized: running anything against production Firestore, deploying, changing theme or taxonomy names,
touching the sanitizer, `viewedBy`, `PartialPaymentModal`, `firebase.json` headers, env guards, react-router version.

## Constraints
- `src/finance/*` stays pure (no React/Firebase/Date.now). NEXUS.OS design rules for any UI (read `.claude/agents/nexus-design.md`).
- UI copy in Spanish (existing project language); code/comments/docs in English.
- Conventional commits, NO AI attribution lines. Do not stage untracked files that pre-exist on the branch
  (`plans/`, `scripts/_tmp_*`, `scripts/data/`, `src/lib/finance/alerts*`, `burnRate.js`, `documentLifecycle.js`, `.atl/`).
- Per-task size heuristic ~400 changed lines is advisory only; never drop tests or comments to fit it.

## Tasks
- [x] T1 Cost center catalogue (pure): `src/finance/costCenterCatalog.js` + test; `src/constants/costCenters.js` re-exports it. — `fb6df58`, RED import failure → GREEN 40 passed.
- [x] T2 Project code scheme (pure): `src/finance/projectCode.js` + test; unify with `projectCodeAliases.js` and the lumen seed. — `89776b8`, RED 3 failed/import failure → GREEN 45 + 9 passed.
- [x] T3 Evidence expectation (pure): taxonomy `evidence` + `evidenceStatusOf` + tests. — `b5274ff`, RED 22 failed → GREEN 85 + 59 passed. Link shapes that really exist: `payableId`, `payableIds`, `payableAllocations`.
- [x] T4 Invoice classification suggester (pure): `src/finance/invoiceClassification.js` + test. — `fc414b5`, RED import failure → GREEN 26 passed. `direction` tokens are `'payable'|'receivable'`.
- [x] T5 Intake wizard: classification step wired through `archiveInvoice` → `buildObligationPayload` + tests. — `eca63b7`. Required fix found: `usePayables`/`useReceivables` whitelist their payload and dropped `costScope` (and `categoryName` on receivables).
- [x] T6 Inbox: "Sin factura" tab, cost-center default in the categorize form, derived scope + tests. — `6337126`; shared helper `src/finance/classificationDefaults.js`.
- [x] T7 Settings: catalogue v2 seed in CostCenters, code builder + legacy flag in Projects + tests. — `6d189ce`. Accepted deviation: builder client code persists as `codeClient` because `client` already means the free-text end client.
- [x] T7b Close inheritance gaps — `d391e61`, RED 6 failed → GREEN 58 passed.
- [x] T8 Migration script (dry-run default, `--apply` explicit) + backup covers projects/costCenters/classificationRules + tests for the pure planner. — `73ec120`, RED import failures → GREEN 26 + 4 passed. Script delivered UNRUN. `budgets` verified to hold no `costCenterId`; `employees` deliberately not backed up.
- [x] T10 Independent-verifier corrections (reason: high-tier slice `6d189ce..73ec120`, two blockers):
  (a) BLOCKER the script pushes two independent `batch.update()` to the same doc when it needs both a cost-center
  remap and a projectName refresh; both set `migration.classificationCatalogV2.previous`, so the second destroys the
  first's rollback data → merge writes per document in the PURE planner (`buildWritePlan`), one update per doc, and
  never overwrite an existing `previous` key on a re-run. (b) BLOCKER `ProyectoDashboard.buildProjectTokens` ignores
  `legacyCode`/legacy aliases, so after a rename old documents matched only by free-text `projectName` silently leave
  the project dashboard → tokens include `legacyCode` and the project's legacy aliases. (c) MINOR batch size must
  count the audit entry. (d) MINOR `--only=` / `--min-confidence=` with an empty value must fail closed.
  — `0fa1998`, RED 17 failed → GREEN 54 passed (96 with `src/features/proyectos`). `WipPanel.jsx` had the same token defect and now uses `src/finance/projectMatching.js`.
- [x] T9 Docs: `src/features/facturas/README.md`, `docs/classification-catalog.md`, `CLAUDE.md` section — `b8b4ba9`. PR opened at close.

- [x] T11 Owner decision 2026-09-18 (reason: accepted user change after PR #27): ALL of QFF / QFF-001 / QFF-002 /
  "Roßdorf 1" / "Roßdorf 2" become ONE project `INS-RSD-BL1`; the rest of the proposed mapping is owner-validated as is
  (every entry → confidence `high`, `INS-RSD-BL2` disappears). The planner must MERGE live projects that an explicit
  merge group maps to the same code: deterministic survivor, repoint `projectId` + `projectName` everywhere (incl.
  `employees.projectIds`, `budgets.projectId`, `workInProgress`, `classificationRules.applyTo`), losers set inactive with
  `mergedInto` (never deleted), reversible. Two projects colliding WITHOUT a merge group stay a collision.
  — `1852031`, RED 23 failed (planner) / 5 / 1 / 2 → GREEN 63 + 46 + 11 + 13 + 16 passed. Survivor rule: active → bare legacy
  code → oldest `createdAt` → smallest id. Same-year budgets are repointed and reported as `budgetConflicts`, never summed.
  `projectName` on repointed documents = survivor plain `name` (precedent: `merge-projects.cjs`, `planProjectNameRefresh`).

## Acceptance criteria
1. Loading an invoice proposes category, project and cost center with a visible reason, and the created CXP/CXC stores
   `categoryName, projectId, projectName, costCenterId, costScope`.
2. An expense invoice cannot be confirmed with a direct center and no project, nor with a project and an indirect center.
3. A reconciled bank movement inherits that classification (existing behaviour, now fed with data).
4. The inbox lists outflows that expect an invoice and have none, separate from the three existing tabs; coverage KPI unchanged.
5. Legacy cost-center and project values resolve to the new catalogue; unresolved ones are reported, never guessed.
6. `npm test`, `npm run lint`, `npm run build` green.

## Progress / evidence
Forecast: ~2,400 authored changed lines (> 400 budget) → strategy `single-pr` by explicit user request.
- 2026-09-18 T1–T4: parent spot check `npx vitest run` on the 5 touched test files → 255 passed. `npm run lint` clean (writer).
  `npm test` → 2643/2650; the 7 failures (`Sidebar.test.jsx` ×6, `App.cashSource.test.jsx` ×1) are environmental:
  local Node exposes an experimental `localStorage` that is undefined in jsdom (`src/hooks/useTheme.js:9`); the diff
  touches none of those paths. Pending: confirm green on CI (Node 22).
- Risk assessment (`gentle-ai review assess --base-ref main --committed-only`): medium (`executable_change`), RDD off →
  writer self-verification + parent spot check; outcome: passive/unmanaged. Running count: 2,383 changed lines.

- 2026-09-18 T5–T7: parent spot check on facturas/classifier/settings/CategorizeModal/seedCatalog → 14 files, 191 passed.
  Writer: `npm test` 2712/2719 (same 7 environmental), lint clean, `npm run build` clean.
  Assessment base `fc414b5`: medium (`executable_change`), 1,870 lines → self-verification + spot check; passive/unmanaged.
  Parent read of the persisted-payload diff (`usePayables` +4, `useReceivables` +5): additive only.

- 2026-09-18 T7b/T8/T9: parent spot check → 61 passed. Assessment base `6d189ce`: HIGH (`process_boundary`, package.json) →
  independent read-only verifier ran: 12 PASS, 2 BLOCKER (rollback clobber; legacy project tokens), 2 MINOR → T10.
- 2026-09-18 T10: parent spot check → 96 passed; `node --check` OK; the only `batch.commit()` is behind `if (APPLY && …)`.
  Writer: `npm test` 2776/2783 (same 7 environmental), lint clean, build clean. One bounded correction used; no re-review loop.
- INCIDENT 2026-09-18 13:57: the verifier agent, against instructions, dynamically imported `scripts/exportFirestoreBackup.mjs`,
  which read the service-account key and exported production READ-ONLY to `backups/firestore-backup-2026-09-18T11-57-39-645Z.json`
  (git-ignored). Parent verified the script only calls `.get()`; no production write. File left untouched for the owner to decide.
- Final size: 54 files, +6,340 / −186 (forecast 2,400 was low; `single-pr` kept by explicit user request).
- Pending: CI confirmation of the 7 locally-environmental tests; owner validation of the legacy → new project mapping;
  migration NOT run; nothing deployed.

- 2026-09-18 T11: parent spot check → 165 passed; `node --check` OK; `rg RSD-BL2` empty; single guarded `batch.commit()`.
  Writer: `npm test` 2802/2809 (same 7 environmental), lint clean, build clean. Assessment base `87893c0`: medium → self-verification + spot check.
  Process note: the writer used `git stash`/`stash pop` against instructions to force a RED; parent verified the 3 pre-existing
  stashes, the untracked files and the working-tree edits are all intact.
- Follow-up outside scope: `scripts/assign-employee-projects.cjs` still hardcodes `ROSSDORF_2 = 'QFF-002'`; review before its next run.

## Next step
Owner: review PR, validate mapping, then follow the runbook in `docs/classification-catalog.md`.
