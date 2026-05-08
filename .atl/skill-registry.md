# Skill Registry — fincontrol

Generated: 2026-05-08
Project: `/Users/jarl/Dev/fincontrol`

## Project standards

- Source files are React/Vite JavaScript (`.js`, `.jsx`) with `@/*` alias mapped to `src/*`.
- Use NEXUS.OS as the only UI source of truth: dark-first surfaces, accent `#FF4D2E`, Space Grotesk/JetBrains Mono/Inter, tight radii.
- Never remove or simplify `sanitizeValue()` in `src/hooks/useTransactions.js`; it protects against React error 301 from Firestore values.
- Treat `viewedBy` as a plain object in sanitizer paths; do not convert it as a Firestore type.
- Keep `firebase.json` no-cache headers for JS and global hosting responses.
- Keep `PartialPaymentModal` wrapper pattern for hooks safety; do not flatten it.
- For UI changes, follow `.claude/agents/nexus-design.md`: no shadows, gradients, generic Tailwind colors, oversized radii, or colored panel backgrounds.

## Selected skills

### branch-pr
- Trigger: creating, opening, or preparing PRs for review.
- Path: `/Users/jarl/.config/opencode/skills/branch-pr/SKILL.md`
- Require every PR to link an approved issue and have exactly one `type:*` label.
- Use branch names matching `^(feat|fix|chore|docs|style|refactor|perf|test|build|ci|revert)/[a-z0-9._-]+$`.
- Use conventional commits only; no `Co-Authored-By` trailers.
- PR body must include linked issue, type, summary, changes table, test plan, and checklist.

### chained-pr
- Trigger: PRs over 400 lines, stacked PRs, review slices.
- Path: `/Users/jarl/.config/opencode/skills/chained-pr/SKILL.md`
- Split PRs over 400 changed lines unless a maintainer accepts `size:exception`.
- Keep each PR reviewable in about 60 minutes and scoped to one deliverable work unit.
- State chain dependencies, start/end state, follow-ups, and out-of-scope items in chained PRs.
- Treat polluted diffs as base bugs; retarget or rebase until the PR shows only its work unit.

### cognitive-doc-design
- Trigger: writing guides, READMEs, RFCs, onboarding, architecture, or review-facing docs.
- Path: `/Users/jarl/.config/opencode/skills/cognitive-doc-design/SKILL.md`
- Lead with the answer, then disclose details progressively.
- Chunk related information; prefer tables, checklists, examples, and templates over dense prose.
- For review docs, state what to review first and what is intentionally out of scope.

### comment-writer
- Trigger: PR feedback, issue replies, reviews, Slack messages, or GitHub comments.
- Path: `/Users/jarl/.config/opencode/skills/comment-writer/SKILL.md`
- Start with the actionable point; keep comments warm, direct, and short.
- Explain the technical reason when asking for a change.
- Match the thread language; Spanish uses natural Rioplatense voseo.
- Avoid em dashes.

### go-testing
- Trigger: Go tests, go test coverage, Bubbletea teatest, golden files.
- Path: `/Users/jarl/.config/opencode/skills/go-testing/SKILL.md`
- Prefer table-driven tests with `t.Run` for multiple cases.
- Test behavior and state transitions, not implementation trivia.
- Use `t.TempDir()` for filesystem tests; keep slow/external integration tests skippable with `testing.Short()`.
- Golden files must be deterministic and rerun after update mode.

### issue-creation
- Trigger: creating GitHub issues, bug reports, or feature requests.
- Path: `/Users/jarl/.config/opencode/skills/issue-creation/SKILL.md`
- Use issue templates; blank issues are disabled.
- Search for duplicates before creating an issue.
- New issues get `status:needs-review`; maintainer must add `status:approved` before PR work.
- Questions belong in Discussions, not issues.

### judgment-day
- Trigger: judgment day, dual review, adversarial review, juzgar.
- Path: `/Users/jarl/.config/opencode/skills/judgment-day/SKILL.md`
- Resolve project standards before judging and inject the same standards into both judge prompts.
- Run two blind judges in parallel, wait for both, then synthesize.
- Ask before fixing Round 1 confirmed issues; re-judge after fixes.
- Terminal states are only `JUDGMENT: APPROVED` or `JUDGMENT: ESCALATED`.

### skill-creator
- Trigger: new skills, agent instructions, documenting AI usage patterns.
- Path: `/Users/jarl/.config/opencode/skills/skill-creator/SKILL.md`
- Skills are runtime LLM instruction contracts, not human docs.
- Use valid frontmatter with one-line quoted description and local references.
- Keep bodies concise and move examples or edge cases into `assets/` or `references/`.
- Register project skills in `AGENTS.md` when created.

### work-unit-commits
- Trigger: implementation, commit splitting, chained PRs, or keeping tests and docs with code.
- Path: `/Users/jarl/.config/opencode/skills/work-unit-commits/SKILL.md`
- Commit by deliverable behavior, fix, migration, or docs unit, not by file type.
- Keep tests with the code they verify and docs with user-visible changes.
- Each commit should tell a reviewable story and be a candidate chained PR if scope grows.
- If SDD tasks forecast >400 lines, group commits into chained PR slices before implementation.

## Skill resolution notes

- Scanned user skills under `/Users/jarl/.config/opencode/skills` and `/Users/jarl/.claude/skills`.
- No project-level `skills/`, `.agent/skills/`, `.claude/skills/`, or `.gemini/skills/` were found.
- Skipped SDD skills, `_shared`, and `skill-registry` per SDD init registry rules.
- Project convention inputs included `AGENTS.md`, `CLAUDE.md`, and referenced `.claude/agents/nexus-design.md`.
