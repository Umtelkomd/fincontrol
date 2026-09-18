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

## Proposed legacy → new project code mapping

**The owner validates this before the migration is applied** — it is a
proposal, not a fact already in the repo. `confidence` also gates
`scripts/migrate-classification-catalog.cjs --min-confidence`.

| Legacy values | Proposed code | Confidence |
|---|---|---|
| QFF, QFF-001, PROY-001, RSD, "Roßdorf 1" | INS-RSD-BL1 | high |
| QFF-002, "Roßdorf 2" | INS-RSD-BL2 | high |
| NE4, PROY-004, WRZ, WUR, "Würzburg", "Würzwurg" | INS-WRZ-N41 | medium |
| UGG, UGG-001, "Vancom NE4" | VAN-UGG-N41 | medium |
| WSC, WEST-001, "Wesconnect", "NE4 West-connect" | WSC-GEN-N41 | medium |
| WESTC_MDU | WSC-GEN-MD1 | medium |
| FBX, PROY-003, HXT, "Höxter Nord" | INS-HXT-TB1 | low (line unknown) |
| "Meschede" | INS-MSD-TB1 | low |
| AMD-001, "Overhead" | UMT-ADM-OH1 | high |
| QDU, AUSTRIA, EHR, BIE, BAM, LGN, GFP, DGF, WCB | *(none)* | unmapped — stays legacy |

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
