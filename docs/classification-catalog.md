# Classification catalogue v2

One coherent cost-center catalogue and one project code nomenclature, behind
the invoice classification suggester described in
`src/features/facturas/README.md` → "Classification at intake". Design
source: `odd/tasks/invoice-classification-catalog.md`.

## Three orthogonal axes

| Axis | Question | Source |
|---|---|---|
| Category | WHAT was bought (nature) | `src/finance/taxonomy.js` v2 — unchanged names |
| Project | WHICH contract earns/consumes it | `projects` collection, v2 code scheme |
| Cost center | WHO/which unit is responsible | catalogue below |

`costScope` is never an independent choice: it is DERIVED from the cost
center's kind (`direct` → `project`, `indirect`/`clearing` → `overhead`).

## Cost center catalogue (`costCenterId` stores the CODE; catalogue doc id === code)

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

`CC-NOM` keeps its code: `useNominas` resolves it by code and payroll is
allocated to projects by `allocatePayrollCost`.

## Category → default cost center

Used only when there is no project (an outflow with a project always defaults
from the project's line instead):

| Category | Default center |
|---|---|
| combustible, cuotas-alquiler-vehiculos, mantenimiento-vehiculos | CC-200 |
| equipos | CC-210 |
| alojamiento | CC-220 |
| asesoria, seguros-empresa, tarjeta-corporativa, otros-administrativos | CC-300 |
| oficina | CC-330 |
| otros-personal | CC-320 |
| salarios, seguridad-social, impuesto-nomina | CC-NOM |
| iva, impuesto-beneficios, intereses-comisiones, amortizacion-prestamos, intereses-socios | CC-900 |
| materiales, reparaciones, danos-terceros, subcontratas | none — a project is required |

## Legacy cost-center resolution (accent/case-insensitive)

| Legacy | v2 code |
|---|---|
| CC-001 | CC-100 |
| CC-002, CC-003, "Instalaciones y Reparaciones", "NE4" | CC-120 |
| CC-004, "Administrativo", "Gestorías"/"Gestorias", "Seguros" | CC-300 |
| CC-005, "Despliegue" | CC-110 |
| "Obra Civil" | CC-100 |
| "Financiero" | CC-900 |
| "Nómina y Seguridad Social" | CC-NOM |
| "Sin asignar" | '' (empty) |
| CC-006…CC-009, "Contratistas", "OPE" | **UNRESOLVED** — meaning not in the repo; the migration resolves what it can by the live doc NAME and reports the rest |

## Project code scheme: `CLI-SIT-LLn`

- `CLI` — 3 letters, who pays us (INS Insyte, VAN Vancom, WSC Wesconnect, UMT internal).
- `SIT` — 3 alphanumerics, site or frame contract (RSD Roßdorf, HXT Höxter, WRZ Würzburg, MSD Meschede, GEN generic).
- `LL` — line: TB Tiefbau · BL blowing/splicing · N4 NE4 · MD MDU · SV site services · OH internal overhead.
- `n` — lot, 1–99, no padding.
- Pattern: `^[A-Z]{3}-[A-Z0-9]{3}-(TB|BL|N4|MD|SV|OH)[1-9][0-9]?$`.
- The line gives the default cost center (table above; OH → CC-300).
- **Legacy codes stay VALID**, flagged `legacy` — the scheme is additive, never a rejection.

Examples: `INS-RSD-BL1` (Insyte, Roßdorf, blowing/splicing, lot 1) ·
`VAN-UGG-N41` (Vancom, UGG, NE4, lot 1) · `UMT-ADM-OH1` (internal overhead, lot 1).

## Legacy → new project code mapping

**The owner validated this table on 2026-09-18** (T11) — every mapped entry
below is `confidence: high`. The `confidence` field and
`scripts/migrate-classification-catalog.cjs --min-confidence` stay in place
for any future, not-yet-validated entry.

| Legacy values | Code | Confidence |
|---|---|---|
| QFF, QFF-001, QFF-002, PROY-001, RSD, "Roßdorf 1", "Roßdorf 2" | INS-RSD-BL1 (merge group — see below) | high |
| NE4, PROY-004, WRZ, WUR, "Würzburg", "Würzwurg" | INS-WRZ-N41 | high |
| UGG, UGG-001, "Vancom NE4" | VAN-UGG-N41 | high |
| WSC, WEST-001, "Wesconnect", "NE4 West-connect" | WSC-GEN-N41 | high |
| WESTC_MDU | WSC-GEN-MD1 | high |
| FBX, PROY-003, HXT, "Höxter Nord" | INS-HXT-TB1 | high |
| "Meschede" | INS-MSD-TB1 | high |
| AMD-001, "Overhead" | UMT-ADM-OH1 | high |
| QDU, AUSTRIA, EHR, BIE, BAM, LGN, GFP, DGF, WCB | *(none)* | unmapped — stays legacy |

## Project merges

Owner decision 2026-09-18 (T11): QFF, QFF-001, QFF-002, PROY-001, RSD,
"Roßdorf 1" and "Roßdorf 2" are ONE project, `INS-RSD-BL1`. The former
separate code for the second Roßdorf site no longer exists anywhere. A
`merge: true` flag on a `LEGACY_PROJECT_CODE_MAP`
entry (`src/finance/projectCode.js`) is the explicit signal that several LIVE
projects resolving to that code are the same obra, not a naming collision.

`planProjectCodeMigration` (`src/finance/classificationMigration.js`) picks
one deterministic survivor among the colliding live projects — active over
inactive, then a bare legacy code (`QFF`) over a suffixed one (`QFF-001`),
then the oldest `createdAt`, then the smallest doc id — and renames only the
survivor to the v2 code. `planProjectMerge` then repoints every document that
referenced a loser onto the survivor: `projectId`/`projectName` on
bankMovements, receivables, payables and workInProgress;
`applyTo.projectId`/`applyTo.projectName` on classificationRules;
`projectId` on budgets; and `projectIds` on employees, de-duplicated. Loser
project docs are never deleted — they get `status: 'inactive'`,
`active: false`, `mergedInto: <survivorId>` and `mergedIntoCode`, which the
Proyectos settings screen shows as a muted "Fusionado en `<code>`" note.

Budgets follow one of two policies, chosen PER MERGE GROUP via an opt-in
`mergeBudgets: 'sum'` flag on its `LEGACY_PROJECT_CODE_MAP` entry:

- **Default (no flag):** never summed or merged. If both the survivor and a
  loser hold a budget for the same year, the loser's budget is still
  repointed (its `projectId` alone) but the pair is reported in the
  dry-run's `budgetConflicts` for a human to resolve — two budgets for one
  project-year is a business decision, not something the migration guesses.
- **`mergeBudgets: 'sum'` (owner decision 2026-09-18, T12 — currently only
  the Roßdorf entry):** a same-year survivor+loser pair is summed
  line-by-line instead of reported as a conflict. Lines are matched by
  identity (`type` + normalized `categoryName`, accent/case-insensitive):
  a matched pair adds its `monthlyBudget` element-wise (missing/NaN/non-
  numeric treated as 0, rounded to cents), an unmatched loser line is
  appended after the survivor's own lines (whose order is preserved), and
  every other field keeps the survivor's value unless it is empty. A 3+-
  project merge folds its losers one at a time, in the SAME deterministic
  survivor-rule order used to pick the survivor itself, so the result never
  depends on Firestore read order. The survivor budget's write carries the
  ORIGINAL lines under `migration.classificationCatalogV2.previous.lines`,
  so the sum is reversible. The loser budget is NEVER deleted and its
  `projectId` is deliberately left pointing at the (now inactive) loser
  project — repointing it to the survivor would make it count a second
  time — instead it is stamped `mergedInto: <survivorBudgetId>` and
  `mergedIntoProjectId: <survivorProjectId>`. A loser budget already
  stamped `mergedInto` is never summed again on a re-run (idempotent). A
  loser budget for a year the survivor has none is simply repointed, same
  as the default policy — nothing to sum. `ProyectoDashboard`'s budget
  panel matches budgets by free-text `projectName` tokens as well as by
  `projectId`, and a loser's legacy `projectName` (e.g. "Roßdorf 2") is
  itself one of the survivor's legacy aliases — so it excludes any budget
  carrying `mergedInto` from that match, or it would double-count the
  already-summed total.

### Renaming a project by hand

**Do not rename a merge-group project by hand before the migration has folded
it.** While QFF and QFF-002 are both live, renaming one of them to
`INS-RSD-BL1` makes its dictionary aliases ("QFF-002", "Roßdorf 2") collide
with the other project's own code and name, and a payable carrying only
`projectName: 'Roßdorf 2'` would appear under BOTH obras. Two guards keep that
from going unnoticed:

- The Proyectos form shows a muted warning when the structured code being
  saved is a merge target another LIVE project also resolves to. It is a
  warning, not a block — renaming the survivor is legitimate.
- `buildProjectTokens` (`src/finance/projectMatching.js`) takes the project
  list and withholds any alias that is another live project's own
  code/name/displayName/legacyCode. Once that sibling is `inactive` or carries
  `mergedInto` — the state the migration leaves — the alias is admitted again,
  so the survivor does answer for the absorbed obra's old documents.

Saving a code change in the Proyectos screen also stamps `legacyCode` with the
PREVIOUS code, once: every document captured before the rename still carries
that code as free text, and `legacyCode` is what keeps matching them. A later
rename never overwrites it — the first original is the one the documents hold.

`employees.projectIds` is NOT covered by `npm run backup:firestore` (personal
data) — its only rollback path is the
`migration.classificationCatalogV2.previous.projectIds` stamp the migration
writes on each affected employee document.

## Evidence expectation (statement-only path)

Each category carries `evidence: 'invoice' | 'statement'`. `statement`
(never has an invoice): salarios, seguridad-social, impuesto-nomina, iva,
impuesto-beneficios, intereses-comisiones, amortizacion-prestamos,
intereses-socios, tarjeta-corporativa, transferencia-interna, and all income
except "Facturación obra". Everything else is `invoice`.
`evidenceStatusOf(movement)` (`src/finance/costScope.js`) reports
`'not-required' | 'documented' | 'missing-invoice'` — a SEPARATE signal from
`pendingReasonOf`/coverage: a statement-only expense is complete once
categorized and destined.

## Rollout runbook

1. Merge this branch.
2. `npm run backup:firestore` — writes `backups/firestore-backup-*.json`, now including `projects`, `costCenters`, `classificationRules` and `settings`.
3. `npm run migrate:classification` (dry-run) — reads Firestore, writes nothing, and drops a report in `backups/classification-migration-*.json`. Review it, in particular the `unresolved` and `collisions` sections.
4. Adjust the mapping/unresolved values as needed (extend `LEGACY_PROJECT_CODE_MAP` in `src/finance/projectCode.js`, or the cost-center `LEGACY_KEY_MAP` in `src/finance/costCenterCatalog.js`) and re-run the dry run until the report looks right.
5. Apply: `node scripts/migrate-classification-catalog.cjs --apply --confirm=umtelkomd-finance` (refuses to run without a backup from step 2 that is under 24h old).
6. Deploy hosting: `npx -y firebase-tools deploy --only hosting`.
7. Configuración → Centros de costo → "Cargar predefinidos" is idempotent and optional after the migration — the migration already proposes the same catalogue upserts; this button is only a manual re-seed if needed.
