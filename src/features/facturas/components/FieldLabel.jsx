/**
 * Shared `<label>` wrapper for a Facturas form control — used by
 * InvoiceIntakePanel and InvoiceEditModal so both forms render an identical
 * label/control pairing.
 */
const FieldLabel = ({ label, htmlFor, children }) => (
  <label htmlFor={htmlFor} className="block text-sm">
    <span className="label-mono mb-1 block text-[var(--color-fg-4)]">{label}</span>
    {children}
  </label>
);

export default FieldLabel;
