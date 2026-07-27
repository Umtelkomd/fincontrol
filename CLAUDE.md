# CLAUDE.md — FinControl (UMTELKOMD Finance)

## What Is This?
Financial management app for **UMTELKOMD GmbH** — tracks transactions, projects, cost centers, CXP/CXC.
React 19 + Vite + Firebase + Tailwind v4 + Recharts.

## Quick Start
```bash
cd ~/Dev/fincontrol
npm run dev          # localhost:5173
npm run build && npx -y firebase-tools deploy --only hosting   # deploy (predeploy hook rebuilds)
```

## Repo & Deploy
- **Local:** `~/Dev/fincontrol/`
- **GitHub:** Umtelkomd/fincontrol
- **Live:** https://umtelkomd-finance.web.app
- **Deploy:** Firebase Hosting (`npx firebase deploy --only hosting` — predeploy rebuilds)

## Firebase Config
- **Project:** umtelkomd-finance
- **App ID:** `1:597712756560:web:ad12cd9794f11992641655`
- **Firestore path:** `artifacts/{APP_ID}/public/data/{collection}`
- **Collections:** bankMovements (canonical cash ledger, DATEV-fed), receivables (CXC),
  payables (CXP), payrollPeriods, employees, projects, projectControl, costCenters,
  categories, classificationRules, recurringCosts, budgets, notifications, auditLog,
  settings (singletons: bankAccount, categories, overhead, reconciliation, treasury).
  `transactions` holds the 2025 historical P&L records (419 docs, ids `sheet-2025-N`,
  migrated from the old bundled array on 2026-07-22) plus entries written via the
  Transacciones view. Read through `useAllTransactions` for historical reporting
  (BudgetVsActual pre-2026 actuals, Recurrencia dedupe, Alertas, ImportExport).
  Cash NEVER derives from it — bankMovements + reconciliation anchors are canonical.
- **Service account key:** `~/.credentials/umtelkomd-firebase.json`

## User Roles
- `jromero` — admin (full access)
- `bsandoval` — manager (CXP + CXC)
- Others — editor

## Key Files
- `src/App.jsx` — Main app with routing (single router; nav in `src/components/layout/navItems.js`)
- `src/lib/finance/` — PURE finance engine (cash position via reconciliation anchors,
  13-week forecast, aging, burn/runway, German fiscal calendar incl. Dauerfristverlängerung,
  alerts). Fully unit-tested; no Firebase imports allowed here.
- `src/hooks/useTransactions.js` — Transaction CRUD + sanitizer
- `src/hooks/useFinanceLedger.js` — canonical ledger + anchor-derived cash position (cashMeta)
- `src/hooks/useTreasuryMetrics.js` — aging, projections, runway on top of the ledger
- `src/hooks/useForwardProjection.js` — 90-day daily forecast (wraps `src/finance/forwardProjection.js`)
- `src/hooks/useReconciliation.js` / `useTreasurySettings.js` — settings/reconciliation & settings/treasury
- `src/features/resumen/Resumen.jsx` — "Cómo va la empresa" cockpit (default landing, alerts panel)
- `src/features/cfo/CFODashboard.jsx` — CFO dashboard view
- `src/features/proyectos/ProyectoDashboard.jsx` — Project dashboard view
- `src/utils/sanitizeFirestore.js` — the React-301 sanitizer (tested; see CRITICAL #1)
- `src/data/balances2025.js` — legacy starting balances (fallback only; anchors supersede it)
- `firebase.json` — Hosting config with no-cache headers

## Cash position (July 2026 model)
- Reconciliation anchors live in `settings/reconciliation` (Configuración → Tesorería).
  Cash today = newest anchor ≤ today + signed bank movements after it. Verified anchor:
  2026-05-31 → +1,214.20 € (DATEV SuSa 1200). `scripts/seed-reconciliation-anchor.cjs` seeds it.
- Bank movements imported before May 2026 have NO usable `signedAmount` — always derive via
  `direction` fallback (`signedAmountOf` in `src/lib/finance/movementAmount.js`).
- VAT estimates per month live in `settings/treasury` (due the 10th of M+2, Dauerfrist).

## Dependencies (key)
- `firebase@^12` — Backend
- `recharts@^3` — Charts
- `lucide-react` — Icons
- `jspdf` + `jspdf-autotable` — PDF export
- `react-router-dom@^7` — Client-side routing
- `pdfjs-dist@^6` — PDF rendering

## Architecture — Feature-First Structure
App uses feature-first modular design under `src/features/`:
- `cxc/` — Accounts receivable (CXC) feature
- `cxp/` — Accounts payable (CXP) feature
- `cashflow/` — Cash flow management
- `presupuesto/` — Budget planning
- `datev-import/` — DATEV integration
- `nominas/` — Payroll
- `employees/` — Employee records
- `cfo/` — CFO dashboards and reporting
- `proyectos/` — Project tracking

Financial calculation utilities live in `src/finance/` (separate from hooks), hooks in `src/hooks/`.

## Theme — NEXUS.OS (dark-first, strict)
- Accent: `#FF4D2E` (orange) — used for CTAs, brand `.OS`, active nav, chart highlights
- Surfaces escalate: `#07080A` (page) → `#0E1014` (panel) → `#161920` (card) → `#1D2029` (elevated)
- Fonts: Space Grotesk (display, 300/400/500), JetBrains Mono (labels/data), Inter (body)
- Radii: 4 / 6 / 10 px — never `xl`, `2xl`, `3xl`
- Wordmark: `FinControl.OS` where `.OS` is in accent color

## ⚠️ CRITICAL — DO NOT BREAK THESE

### 1. sanitizeValue() in src/utils/sanitizeFirestore.js
Recursive sanitizer that prevents **React error 301** (non-serializable Firestore objects).
Extracted from the removed useTransactions hook in July 2026, now unit-tested.
**DO NOT remove or simplify it.**

### 2. viewedBy field
Firestore docs have a `viewedBy` field that's a plain object (not a Firestore type).
**Must be skipped/handled in the sanitizer** — not converted.

### 3. firebase.json no-cache headers
```json
"headers": [{
  "source": "**/*.js",
  "headers": [{ "key": "Cache-Control", "value": "no-cache, no-store, must-revalidate" }]
}]
```
**Keep these** — prevents stale JS after deploys.

### 4. PartialPaymentModal
Uses wrapper pattern (inner component + outer wrapper) for hooks safety. Don't flatten it.

### 6. Never run `npm audit fix --force` on react-router-dom
`npm audit` flags react-router and offers to "fix" it by downgrading to 7.11.0.
**Taking that fix makes the app less safe.** Two separate advisories overlap:

| Version | Advisory | Applies here? |
|---|---|---|
| 6.0.0 – 7.17.0 | XSS via Open Redirects (CVSS **8.0**) | **Yes** — exploitable in a client-side SPA |
| 7.12.0 – 8.2.0 | RSC Mode CSRF Bypass (CVSS **0**) | **No** — needs React Server Components |

No published version escapes both. Staying on the newest (`^7.18.1`) avoids the
exploitable XSS and leaves only the RSC advisory, which cannot apply: this is a
static SPA on Firebase Hosting with no server, no RSC and no server actions.
The audit line is expected — do not "resolve" it by moving backwards. Re-evaluate
only when a release lands above 8.2.0.

Remaining high-severity audit entries come from `brace-expansion` via
`minimatch` via `eslint-plugin-react`, i.e. lint tooling that never reaches the
bundle. The fix is `"overrides": { "brace-expansion": "^5.0.8" }` in
package.json — verify `npm run lint` still passes afterwards, since that jumps
brace-expansion across four major versions under an old minimatch.

## Commands
```bash
npm run dev              # Start dev server (localhost:5173)
npm test                 # Run vitest unit tests
npm run lint             # ESLint checks
npm run preview          # Preview production build
npm run backup:firestore # Export Firestore data
npm run migrate:legacy   # Migrate legacy transactions
npm run build            # Build for production
```

### 5. Firebase env guardrails (added after the 2026-06 `auth/invalid-api-key` outage)
A `dist` built without `.env` shipped an empty Firebase config and took prod down.
Three guards prevent recurrence — **do not remove them**:
- `vite.config.js` — aborts the build if any `VITE_FIREBASE_*` var is missing.
- `src/services/firebase.js` — throws a clear error if any config value is empty.
- `firebase.json` → `hosting.predeploy: ["npm run build"]` — every `firebase deploy`
  rebuilds from current source + `.env`, so a stale/env-less `dist` can't ship.

Deploy is now just `npx -y firebase-tools deploy --only hosting` (it rebuilds for you).
Note: plain `npx firebase` resolves to the local `firebase` SDK package (no executable) — always use `firebase-tools`.

## Design System
This project uses the **NEXUS.OS** design system. Before making any UI changes, read the agent skill:
`.claude/agents/nexus-design.md`

Key rules:
- All panels/cards use `bg-[var(--color-bg-1)]` or `bg-[var(--color-bg-2)]` — never colored backgrounds
- Headings: `<h1>` = `font-light` (300), `<h2>` = `font-medium` (500), both on `var(--font-display)`
- Radii: `rounded-sm` / `rounded-md` / `rounded-lg` for controls and surfaces; `rounded-full` only for avatars, status dots, loaders, progress, toggles, and `.nx-badge`
- Buttons use `.nx-btn .nx-btn-primary|-secondary|-ghost|-danger` — never `rounded-full` on buttons
- Accent `#FF4D2E` is reserved for CTAs, active states, `.OS` brand fragment, chart highlights
- The previous visual system is deprecated — NEXUS.OS is the only source of truth
