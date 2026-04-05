# Nothing Design System — Agent Skill

## Purpose
Apply and maintain the Nothing Design System across all UI components in this project.

## Design Principles
- Monochrome first: Black backgrounds, white text, no decorative color
- Color = meaning only: Red=error, Green=success, Yellow=warning, Blue=info
- No gradients, no shadows: flat surfaces only
- Cards are uniform: ALL cards same dark background, NEVER colored backgrounds

## Color Palette (CSS variables)
- --background: #000000 (page bg)
- --surface: #111111 (cards, panels)
- --surface-raised: #1A1A1A (modals)
- --border: #222222 (subtle)
- --border-visible: #333333 (visible)
- --text-disabled: #666666
- --text-secondary: #999999
- --text-primary: #E8E8E8
- --text-display: #FFFFFF
- --nd-accent: #D71921 (error/negative)
- --nd-success: #4A9E5C (positive)
- --nd-warning: #D4A843 (pending)
- --nd-interactive: #5B9BF6 (info/active)

## Typography
- Body: Space Grotesk
- Big numbers: nd-display class (Doto/Space Mono)
- Labels: nd-label class (11px, uppercase, Space Mono, 0.08em tracking)
- Code: nd-mono class (Space Mono)

## KPI Cards (CRITICAL RULE)
ALL cards: bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-5
NEVER color card backgrounds. Show positive/negative via text color only:
- Positive number: text-[var(--nd-success)]
- Negative number: text-[var(--nd-accent)]
- Neutral: text-[var(--text-display)]

## Buttons
Primary: bg-[var(--text-display)] text-[var(--background)] rounded-full nd-mono uppercase tracking-widest
Secondary: border border-[var(--border-visible)] text-[var(--text-primary)] rounded-full nd-mono

## Inputs
bg-[var(--surface)] border border-[var(--border-visible)] rounded-xl text-[var(--text-primary)]
focus: border-[var(--text-secondary)]

## Tables
Header: nd-label text-[var(--text-secondary)]
Rows: border-b border-[var(--border)] hover:bg-[var(--surface-raised)]

## Status Badges
Use text+border color, transparent background:
- nd-accent: error/urgent
- nd-success: approved/ok
- nd-warning: pending
- nd-interactive: info

## Forbidden
- Colored card/panel backgrounds
- Tailwind color classes (blue-500, green-400, etc.) — always use CSS vars
- Gradients
- Box shadows
