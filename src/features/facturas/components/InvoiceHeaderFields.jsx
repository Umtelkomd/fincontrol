/**
 * Shared invoice header inputs (contraparte, número, fecha, neto, IVA,
 * bruto) — used by InvoiceIntakePanel (new invoice) and InvoiceEditModal
 * (correcting an archived invoice). `idPrefix` keeps DOM ids unique when
 * both a wizard and a modal could, in principle, render at once.
 *
 * `disabledFields` (a Set) disables individual amount inputs — the EDIT
 * modal uses it for a LOCKED obligation's net/tax/gross — and
 * `disabledHint` renders the muted explanation the task calls for.
 */
import FieldLabel from './FieldLabel';

const InvoiceHeaderFields = ({
  idPrefix = 'facturas',
  form,
  onFieldChange,
  disabledFields = new Set(),
  disabledHint = '',
  mismatch = false,
}) => (
  <div className="space-y-3">
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <FieldLabel label="Contraparte" htmlFor={`${idPrefix}-counterparty`}>
        <input
          id={`${idPrefix}-counterparty`}
          required
          className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-0)] px-3 py-2 text-sm text-[var(--color-fg-1)]"
          value={form.counterpartyName}
          onChange={onFieldChange('counterpartyName')}
        />
      </FieldLabel>
      <FieldLabel label="Nº de factura" htmlFor={`${idPrefix}-invoice-number`}>
        <input
          id={`${idPrefix}-invoice-number`}
          required
          className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-0)] px-3 py-2 text-sm text-[var(--color-fg-1)]"
          value={form.invoiceNumber}
          onChange={onFieldChange('invoiceNumber')}
        />
      </FieldLabel>
      <FieldLabel label="Fecha" htmlFor={`${idPrefix}-issue-date`}>
        <input
          id={`${idPrefix}-issue-date`}
          type="date"
          required
          className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-0)] px-3 py-2 text-sm text-[var(--color-fg-1)]"
          value={form.issueDate}
          onChange={onFieldChange('issueDate')}
        />
      </FieldLabel>
      <FieldLabel label="Neto" htmlFor={`${idPrefix}-net`}>
        <input
          id={`${idPrefix}-net`}
          type="number"
          step="0.01"
          required
          disabled={disabledFields.has('netAmount')}
          className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-0)] px-3 py-2 text-sm text-[var(--color-fg-1)] disabled:opacity-50"
          value={form.netAmount}
          onChange={onFieldChange('netAmount')}
        />
      </FieldLabel>
      <FieldLabel label="IVA" htmlFor={`${idPrefix}-tax`}>
        <input
          id={`${idPrefix}-tax`}
          type="number"
          step="0.01"
          disabled={disabledFields.has('taxAmount')}
          className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-0)] px-3 py-2 text-sm text-[var(--color-fg-1)] disabled:opacity-50"
          value={form.taxAmount}
          onChange={onFieldChange('taxAmount')}
        />
      </FieldLabel>
      <FieldLabel label="Bruto" htmlFor={`${idPrefix}-gross`}>
        <input
          id={`${idPrefix}-gross`}
          type="number"
          step="0.01"
          required
          disabled={disabledFields.has('grossAmount')}
          className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-0)] px-3 py-2 text-sm text-[var(--color-fg-1)] disabled:opacity-50"
          value={form.grossAmount}
          onChange={onFieldChange('grossAmount')}
        />
      </FieldLabel>
    </div>

    {disabledFields.size > 0 && disabledHint && (
      <p className="text-xs text-[var(--color-fg-4)]">{disabledHint}</p>
    )}
    {mismatch && <p className="text-sm text-[var(--color-warn)]">Neto + IVA no cuadra con el bruto</p>}
  </div>
);

export default InvoiceHeaderFields;
