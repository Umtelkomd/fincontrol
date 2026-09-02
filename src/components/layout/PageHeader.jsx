/**
 * PageHeader — the mandatory NEXUS.OS page header, once.
 *
 * Every route renders exactly one of these and nothing else may emit an <h1>.
 * The skeleton is the one in .claude/agents/nexus-design.md: eyebrow
 * "§ Section" → display h1 at weight 300 (optional accent fragment) → mono
 * subtitle → right rail for the primary action.
 *
 *   <PageHeader
 *     section="Bandeja"
 *     title="Clasificar"
 *     accent="movimientos"
 *     subtitle="2026 · 12 pendientes"
 *     actions={<Button variant="primary">Aplicar reglas</Button>}
 *   />
 *
 * `children` render under the subtitle, inside the left column, for the rare
 * extra line a screen needs (a rules-active note, a partial-data caveat).
 */
const PageHeader = ({ section, title, accent, subtitle, actions, children }) => (
  <header className="flex flex-wrap items-end justify-between gap-4 border-b border-[var(--color-line)] pb-5">
    <div className="min-w-0">
      {section && (
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--color-fg-3)]">
          § {section}
        </p>
      )}
      <h1
        className="mt-1 text-[32px] leading-none text-[var(--color-fg-1)] md:text-[40px]"
        style={{ fontFamily: 'var(--font-display)', fontWeight: 300, letterSpacing: '-0.03em' }}
      >
        {title}
        {accent && (
          <>
            {' '}
            <em className="not-italic text-[var(--color-accent)]">{accent}</em>
          </>
        )}
      </h1>
      {subtitle && (
        <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--color-fg-3)]">
          {subtitle}
        </p>
      )}
      {children}
    </div>
    {actions && <div className="flex flex-shrink-0 flex-wrap items-center gap-2">{actions}</div>}
  </header>
);

export default PageHeader;
