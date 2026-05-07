/**
 * NEXUS.OS — Panel
 *
 * The base "card" container. Border + radius-md, surface bg, no elevation effects.
 * Optional header with title + meta + actions slot.
 *
 * Usage:
 *   <Panel title="Cuentas por cobrar" meta="42 pendientes" actions={<Button .../>}>
 *     ...content...
 *   </Panel>
 */
const Panel = ({
  title,
  meta,
  actions,
  children,
  padding = true,
  className = '',
  bodyClassName = '',
}) => {
  const hasHeader = title || meta || actions;
  return (
    <section className={`panel ${className}`}>
      {hasHeader && (
        <header className="phead">
          <div className="flex items-center gap-3 min-w-0">
            {title && <h3 className="title truncate">{title}</h3>}
            {meta && <span className="m">{meta}</span>}
          </div>
          {actions && <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>}
        </header>
      )}
      <div className={`${padding ? 'pbody' : ''} ${bodyClassName}`}>{children}</div>
    </section>
  );
};

export default Panel;
