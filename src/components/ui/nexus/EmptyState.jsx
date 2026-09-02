/**
 * NEXUS.OS — EmptyState
 *
 * Standard empty placeholder for tables, lists, panels.
 * Mono uppercase header + sans body + optional CTA. The title is rendered
 * as-is: the old `[title]` brackets read as placeholder text.
 *
 * <EmptyState
 *   title="Sin transacciones"
 *   description="Importa registros o crea uno nuevo."
 *   action={<Button variant="primary">Crear</Button>}
 * />
 */
const EmptyState = ({ title, description, action, icon: Icon, className = '' }) => (
  <div className={`flex flex-col items-center justify-center py-12 px-6 text-center ${className}`}>
    {Icon && (
      <div className="w-10 h-10 rounded-md border border-[var(--color-line)] bg-[var(--color-bg-2)] flex items-center justify-center mb-4">
        <Icon size={16} className="text-[var(--color-fg-4)]" />
      </div>
    )}
    {title && (
      <p className="label-mono text-[var(--color-fg-3)] mb-2">{title}</p>
    )}
    {description && (
      <p className="text-[13px] text-[var(--color-fg-4)] max-w-[400px] leading-relaxed">
        {description}
      </p>
    )}
    {action && <div className="mt-5">{action}</div>}
  </div>
);

export default EmptyState;
