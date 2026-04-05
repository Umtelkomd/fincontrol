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

## Theme — Apple Dark
- Frosted glass effects
- Font: Inter
- Dark grays: `#1c1c1e`, `#2c2c2e`

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

## Design System
This project uses the **Nothing Design System**. Before making any UI changes, read the agent skill:
`.claude/agents/nothing-design.md`

Key rule: ALL cards/panels use `bg-[var(--surface)]` — NEVER colored backgrounds.
Colors are for text/borders only (positive=nd-success, negative=nd-accent).
