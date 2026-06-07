# CLAUDE.md — FinControl (UMTELKOMD Finance)

## What Is This?
Financial management app for **UMTELKOMD GmbH** — tracks transactions, projects, cost centers, CXP/CXC.
React 19 + Vite + Firebase + Tailwind v4 + Recharts.

## Quick Start
```bash
cd ~/Dev/fincontrol
npm run dev          # localhost:5173
npm run build && npx firebase deploy --only hosting   # deploy
```

## Repo & Deploy
- **Local:** `~/Dev/fincontrol/`
- **GitHub:** jarl9801/fincontrol (public)
- **Live:** https://umtelkomd-finance.web.app
- **Deploy:** Firebase Hosting (`npm run build && npx firebase deploy --only hosting`)

## Firebase Config
- **Project:** umtelkomd-finance
- **App ID:** `1:597712756560:web:ad12cd9794f11992641655`
- **Firestore path:** `artifacts/{APP_ID}/public/data/{collection}`
- **Collections:** transactions, projects, costCenters, categories
- **Service account key:** `~/.credentials/umtelkomd-firebase.json`

## User Roles
- `jromero` — admin (full access)
- `bsandoval` — manager (CXP + CXC)
- Others — editor

## Key Files
- `src/App.jsx` — Main app with routing
- `src/hooks/useTransactions.js` — Transaction CRUD + sanitizer
- `src/hooks/useMetrics.js` — Financial metrics/calculations
- `src/components/Dashboard.jsx` — Main dashboard view
- `src/data/balances2025.js` — Starting balances
- `firebase.json` — Hosting config with no-cache headers

## Starting Balance (Dec 2025)
- Banco: €28,450
- IVA: €7,332.94
- Total: €35,782.94
- Defined in `src/data/balances2025.js`

## Dependencies (key)
- `firebase@^12` — Backend
- `recharts@^3` — Charts
- `lucide-react` — Icons
- `jspdf` + `jspdf-autotable` — PDF export

## Theme — NEXUS.OS (dark-first, strict)
- Accent: `#FF4D2E` (orange) — used for CTAs, brand `.OS`, active nav, chart highlights
- Surfaces escalate: `#07080A` (page) → `#0E1014` (panel) → `#161920` (card) → `#1D2029` (elevated)
- Fonts: Space Grotesk (display, 300/400/500), JetBrains Mono (labels/data), Inter (body)
- Radii: 4 / 6 / 10 px — never `xl`, `2xl`, `3xl`
- Wordmark: `FinControl.OS` where `.OS` is in accent color

## ⚠️ CRITICAL — DO NOT BREAK THESE

### 1. sanitizeValue() in useTransactions.js
Recursive sanitizer that prevents **React error 301** (non-serializable Firestore objects).
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

### 5. Firebase env guardrails (added after the 2026-06 `auth/invalid-api-key` outage)
A `dist` built without `.env` shipped an empty Firebase config and took prod down.
Three guards prevent recurrence — **do not remove them**:
- `vite.config.js` — aborts the build if any `VITE_FIREBASE_*` var is missing.
- `src/services/firebase.js` — throws a clear error if any config value is empty.
- `firebase.json` → `hosting.predeploy: ["npm run build"]` — every `firebase deploy`
  rebuilds from current source + `.env`, so a stale/env-less `dist` can't ship.

Deploy is now just `npx firebase deploy --only hosting` (it rebuilds for you).

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
