# NEXUS.OS Design System — Agent Skill (FinControl)

## Purpose
Apply and maintain the **NEXUS.OS** design system across the FinControl UI. Dark-first, austere, editorial — the product surface for UMTELKOMD finance inside the NEXUS.OS brand family.

This skill is the canonical visual contract for FinControl UI.

## Philosophy
- **Austere > decorative.** Surfaces, borders, type do the work. No gradients, no shadows, no glass.
- **One accent.** `#FF4D2E` — used for CTAs, brand fragments like `.OS`, active states, chart highlights. No competing color gets equal weight.
- **Type carries the voice.** Space Grotesk display at weight 300, JetBrains Mono for labels/data, Inter for body.
- **Radii stay tight.** 4 / 6 / 10 px. No `xl`, `2xl`, `3xl`, `[Nrem]` ever.

## Tokens — always use these

All tokens live in `src/index.css` under `@theme { ... }` (Tailwind v4). Reference them via `var(--color-*)`, or use the `label-mono` / `heading-display` / `font-display` / `font-mono` / `font-sans` utilities.

### Color
```
--color-ink:    #0A0B0D
--color-paper:  #F5F3EE
--color-accent: #FF4D2E  (hover: #FF6B50)

--color-bg-0:   #07080A  page
--color-bg-1:   #0E1014  panel
--color-bg-2:   #161920  card
--color-bg-3:   #1D2029  elevated / nav-active
--color-bg-4:   #262A34  hover
--color-line:   #222630  divider
--color-line-s: #2E3440  strong

--color-fg-1:   #F5F3EE  primary
--color-fg-2:   #B9BAB4  secondary
--color-fg-3:   #7B7D7A  tertiary / label
--color-fg-4:   #4A4C50  disabled

--color-ok:     #4ADE80
--color-warn:   #FFB020
--color-err:    #FF4D2E
--color-info:   #6BA6FF
```

### Type
```
--font-display: "Space Grotesk"     displays, h1, h2, panel titles
--font-mono:    "JetBrains Mono"    labels, data, numbers, tabs
--font-sans:    "Inter"             body, forms, buttons, paragraphs
```

### Radius
```
--radius-sm: 4px
--radius-md: 6px   buttons, forms, small cards
--radius-lg: 10px  panels, large cards, KPIs
```

## Page header pattern (mandatory for every view)

```jsx
<header className="flex flex-wrap items-end justify-between gap-4 border-b border-[var(--color-line)] pb-5">
  <div>
    <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-fg-3)]">
      § Section name
    </p>
    <h1
      className="mt-1 text-[32px] leading-none text-[var(--color-fg-1)] md:text-[40px]"
      style={{ fontFamily: 'var(--font-display)', fontWeight: 300, letterSpacing: '-0.03em' }}
    >
      Word <em className="not-italic text-[var(--color-accent)]">accent</em>
    </h1>
    <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-fg-4)]">
      subtitle describing view purpose
    </p>
  </div>
  <div>{/* Right-rail actions — nx-btn-primary for the main CTA */}</div>
</header>
```

Every view must have this exact skeleton (minus the date/right-rail if not needed). The `<em>` accent fragment in the heading is optional but encouraged — it breaks monotony without adding color.

## Component classes (all defined in src/index.css)

### Buttons
```
.nx-btn + .nx-btn-primary | -secondary | -ghost | -danger (+ optional .nx-btn-sm)
```
Primary = accent background, ink text, `rounded-md`. Never `rounded-full` on buttons.

### Badges (pills)
```
.nx-badge + .nx-badge-ok | -warn | -err | -info | -neutral
```
Translucent tint + signal color text. `rounded-full` is correct here — pills are the exception to the radius rule.

### Tabs
```
.nx-tabs > .nx-tab [.active]
```
Mono uppercase at `tracking-[0.1em]`, accent border-bottom on active.

### Alerts
```
.nx-alert + .nx-alert-ok | -warn | -err | -info
```

### KPI cards
```
.nx-kpi > .nx-kpi-k (label) + .nx-kpi-v (value) + .nx-kpi-d (delta, add .down for negative)
```

### Panels
```
.panel > .phead (.title / .m) + .pbody
```

### Tables
```
.nx-table (.mono .num helpers on td)
```

### Progress, Toggle, Code
```
.nx-progress > .nx-progress-fill
.nx-toggle [.on]
.nx-code (.c comment .k keyword .s string .p punct)
```

### Typography utilities
```
.font-display   Space Grotesk, letter-spacing -0.03em
.font-mono      JetBrains Mono, letter-spacing 0.02em
.font-sans      Inter
.label-mono     10px uppercase tracking-[0.14em] fg-3
.heading-display  clamp(32-44px) font-light -0.03em
```

## Shell architecture (App.jsx + Sidebar.jsx + MobileMenu.jsx)

- **Desktop**: horizontal top-bar shell. Wordmark **FinControl.OS** (where `.OS` is in accent) + role/balance chips + Crear CTA (`nx-btn-primary`). Nav row below with mono uppercase items, active state = `bg-bg-3` + 2px accent border-bottom.
- **Mobile**: slide-in drawer (`animate-slideIn`), same wordmark, 2px accent left-border on active item.
- **Content header** (per view): follows the Page header pattern above.

## Charts (Recharts)

Chart series read Nexus tokens directly: lead with `--color-accent`, then fall back to monochrome `fg-1 → fg-4` with `--color-info` as an optional mid-chroma accent. Semantic overrides only for explicit signal (`success`, `negative`, etc.). The former shared `constants/chartTheme.js` was removed once it had no consumers — colour charts from the CSS variables at the call site.

## Forbidden patterns

These break the aesthetic — flag them in review:

1. `rounded-xl`, `rounded-2xl`, `rounded-3xl`, `rounded-[Nrem]` — always use `rounded-sm | md | lg`
2. `rounded-full` on buttons, cards, panels, and filter controls — only on avatars, status dots, loaders, progress, toggles, and `.nx-badge`
3. `font-bold` on `<h1>` — use `font-light` (300). H2/panel titles use `font-medium` (500).
4. `tracking-[0.18em+]` — max letter-spacing is `tracking-[0.14em]`. Older UI used wider tracking; drop it.
5. Generic Tailwind colors (`text-blue-500`, `bg-green-400`, etc.) — always a Nexus token.
6. `box-shadow` / `shadow-md` / any shadow utility — Nexus has none.
7. `linear-gradient(...)` — forbidden.
8. Square bracket loading text like `[CARGANDO...]` — use `Cargando…` in `label-mono` style.
9. `font-['Doto']`, `font-['Space Mono']` — replaced by `font-display` (Space Grotesk) and `font-mono` (JetBrains Mono).
10. Colored card/panel backgrounds (`bg-info`, `bg-warn`) — only `.nx-badge` carries translucent semantic tints. Panels stay on `bg-2`.

## Migration notes

The `nd-*` / `n-*` utility classes (`nd-label`, `nd-mono`, `nd-display`, `nd-heading`, `n-label`, `n-tag`, `n-empty`, `dot-grid`, etc.) still exist in `index.css` as compatibility shims — they render Nexus styling under the old class names. New code should prefer the canonical Nexus equivalents:
- `nd-label` / `n-label` → `label-mono`
- `nd-mono` / `n-mono` → `font-mono`
- `nd-display` → `font-display` + explicit `font-light`
- `nd-heading` → `font-display font-medium` or a manual h2 pattern

Over time these shims should be swept away, but they let existing views keep working while being touched for real migrations.
