# Feature: treasury-ritual-guide

Locator: `odd/tasks/treasury-ritual-guide.md` · Engram topic: `odd/treasury-ritual-guide/tasks`
Branch: `feat/treasury-ritual-guide` (from `main` @ 6edeab8)
Delivery strategy: `single-pr`
TDD: **strict, enabled** · Runner: `npx vitest run <file>` (full: `npm test`) · Lint: `npm run lint`
RDD: off (decided by global) → ordinary checks, delivery `disabled/unmanaged`.

## Objective

Guide the operator through the cash ritual with **one next step** at a time (non-blocking). Admin and manager can import the bank statement and empty the classifier inbox; remesas already allowed for manager. Editor stays dashboard-only.

## Product decisions (owner, 2026-09-19)

1. Guide style: **next-step strip**, never a wall. Reports stay usable.
2. Who operates: **admin + manager**. Do **not** grant the whole `settings` module to manager.

## Problem

- Resumen already piles alerts (`buildResumenAlerts`) but they are not sequenced as the ritual (import → anchor → classify → remesas).
- `/banco` and `/clasificar` sit behind `permission="settings"`. Manager (Beatriz) cannot run steps 1–3 even though Firestore already allows manager writes on tenant data.
- Banco lives under Configuración in the nav; remesas are URL-only.

## Ritual order (the sequencer must follow this, first match wins)

1. Cash source `unavailable` → retry (no navigation).
2. Import gap (>5 quiet bank-business days) → `/banco`.
3. No usable anchor (`cashSource !== 'anchors'`) or anchor older than 45 days → `/banco` (register closing balance).
4. Anchor drift → `/configuracion` (Tesorería).
5. Classifier inbox (`pendingReasonOf` count > 0) → `/clasificar`. Missing-invoice is **not** this step.
6. Pending confirming remesas (`isPendingBatch` and not internal transfer) → `/cxc/remesas`.
7. Done.

The existing alerts panel stays for aging, payroll, runway. The strip is the **single** ritual action.

## Scope

In: pure sequencer + tests; manager permission for Banco/Bandeja only; Resumen strip; nav (Banco under Operar, badges, remesas reachable); continue CTA on Banco / Bandeja / Remesas.
Out: blocking gates, firestore.rules changes, production data, deploy, theme, sanitizer, `viewedBy`, `PartialPaymentModal`, Firebase Functions, invoice intake cycle.

## Constraints

- `src/finance/*` stays pure. UI copy in neutral professional Spanish (tuteo); code/comments/tests/docs in English; no task ids in code.
- Never stage owner untracked files (`plans/`, `scripts/_tmp_*`, `scripts/data/`, other untracked `scripts/*`, `src/lib/finance/alerts*`, `burnRate.js`, `documentLifecycle.js`, `.atl/`).
- Conventional commits on this branch. No AI attribution. Do not mix `fix/classification-followups`.

## Tasks

- [x] T1 Pure `nextRitualStep` sequencer + tests.
- [x] T2 Permission `bank` for admin+manager; `/banco` and `/clasificar` use it; Banco moves to Operar; editor still blocked. Tests for nav + roles.
- [x] T3 Resumen next-step strip wired to the ledger (unavailable / import / anchor / drift / classify / remesas / done). Tests.
- [ ] T4 Nav badges for Banco / Bandeja / CXC remesas counts; continue CTA on those three screens pointing at the current next step. Tests.

## Acceptance criteria

1. Given import gap, the strip href is `/banco` even if the inbox is full.
2. Given a current anchor and empty inbox, a pending remesa is the next step.
3. Manager can open `/banco` and `/clasificar`; cannot open `/empleados` or `/reglas`.
4. Editor still cannot open Banco or Bandeja.
5. Cash unavailable: strip asks to retry, does not invent €0, does not send the user to Banco.
6. Missing-invoice rows do not by themselves make the next step “clasificar”.
7. Focused vitest for new files green; lint clean on touched files.

## Progress / evidence

- T1 `d60f186` — RED missing module; GREEN 15/15. `nextRitualStep` first-match sequencer.
- T2 `ba3cff4` — RED 5 failed / 19 passed; GREEN 24/24. Permission `bank`; Banco in Operar.
- T3 — GREEN 45/45 (`ritualCopy`, `ritualCounts`, `RitualNextStep`, `Resumen`). Strip after PageHeader / FinancialSourceStatus, before Alertas. Omitted while independentLoading. Missing-invoice is not inbox.

## Next step

Implement T4.
