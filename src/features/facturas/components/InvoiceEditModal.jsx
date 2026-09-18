/**
 * InvoiceEditModal — EDIT: correct an archived invoice's header,
 * classification and (when unlocked) amounts, writing through to the
 * obligation it created (see src/finance/invoiceAmendment.js's
 * planInvoiceEdit for every accounting rule). Reuses the same header +
 * Clasificación fields as InvoiceIntakePanel via InvoiceHeaderFields /
 * ClassificationFields.
 *
 * Direction is NEVER editable here (delete and re-archive instead), so the
 * form carries no direction field at all.
 */
import { useMemo, useState } from 'react';
import { Button } from '../../../components/ui/nexus';
import { CATEGORY_TYPE } from '../../../finance/taxonomy';
import { defaultCostCenterFor } from '../../../finance/classificationDefaults';
import { ownedLinks, planInvoiceEdit } from '../../../finance/invoiceAmendment';
import ClassificationFields from './ClassificationFields';
import FieldLabel from './FieldLabel';
import InvoiceHeaderFields from './InvoiceHeaderFields';

const toNumber = (value) => {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value.replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};

const AMOUNT_LOCK_HINT = 'Importe bloqueado: la CXP/CXC ya tiene pagos o está conciliada';

const InvoiceEditModal = ({
  isOpen,
  onClose,
  document,
  obligations = [],
  bankMovements = [],
  projects = [],
  submitting = false,
  onSubmit,
}) => {
  const family = document?.family || (document?.direction === 'incoming' ? 'payable' : 'receivable');
  const { owned } = useMemo(() => ownedLinks(document || {}), [document]);
  const ownedLink = owned[0] || null;
  const ownedObligation = useMemo(
    () => (ownedLink ? obligations.find((row) => row.kind === ownedLink.family && row.id === ownedLink.recordId) || null : null),
    [ownedLink, obligations],
  );
  const activeProjects = projects.filter((project) => (project.status || 'active') === 'active');
  const categoryType = family === 'payable' ? CATEGORY_TYPE.EXPENSE : CATEGORY_TYPE.INCOME;

  const [form, setForm] = useState(() => ({
    counterpartyName: document?.counterpartyName || '',
    invoiceNumber: document?.invoiceNumber || '',
    issueDate: document?.issueDate || '',
    netAmount: document?.netAmount != null ? String(document.netAmount) : '',
    taxAmount: document?.taxAmount != null ? String(document.taxAmount) : '',
    grossAmount: document?.grossAmount != null ? String(document.grossAmount) : '',
    categoryName: ownedObligation?.categoryName || '',
    projectId: ownedObligation?.projectId || '',
    costCenterId: ownedObligation?.costCenterId || '',
    reason: '',
  }));

  if (!isOpen || !document) return null;

  const numericForm = {
    ...form,
    netAmount: toNumber(form.netAmount),
    taxAmount: toNumber(form.taxAmount),
    grossAmount: toNumber(form.grossAmount),
  };
  const plan = planInvoiceEdit({ invoiceDocument: document, obligations, bankMovements, form: numericForm, projects });
  const lockedAmounts = new Set(plan.lockedFields);
  const mismatch = Math.abs(numericForm.netAmount + numericForm.taxAmount - numericForm.grossAmount) > 0.01;

  const handleFieldChange = (field) => (event) => setForm((previous) => ({ ...previous, [field]: event.target.value }));
  const handleClassificationFieldChange = (field) => (event) =>
    setForm((previous) => ({ ...previous, [field]: event.target.value }));
  const handleProjectChange = (event) => {
    const projectId = event.target.value;
    const project = activeProjects.find((candidate) => candidate.id === projectId) || null;
    const costCenterDefault = defaultCostCenterFor({ projectId, project, categoryName: form.categoryName });
    setForm((previous) => ({ ...previous, projectId, costCenterId: costCenterDefault || previous.costCenterId }));
  };

  const obligationLabel = ownedLink?.family === 'receivable' ? 'la CXC vinculada' : 'la CXP vinculada';
  const summary = [];
  if (plan.obligationPatches.length > 0) {
    summary.push(
      `Se actualizará ${obligationLabel}${plan.movementPatches.length > 0 ? ` y ${plan.movementPatches.length} movimiento bancario${plan.movementPatches.length > 1 ? 's' : ''}` : ''}.`,
    );
  } else if (Object.keys(plan.archivePatch).length > 0) {
    summary.push('Solo se actualizará el archivo de la factura (esta factura no creó una obligación propia).');
  }

  const handleSubmit = async (event) => {
    event.preventDefault();
    await onSubmit?.(numericForm);
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-[rgba(7,8,10,0.86)] p-4" role="dialog" aria-modal="true">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-md border border-[var(--color-line-s)] bg-[var(--color-bg-1)] p-6">
        <div className="mb-4 flex items-start justify-between gap-3">
          <h3 className="font-mono text-[13px] uppercase tracking-[0.06em] text-[var(--color-fg-1)]">Editar factura</h3>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cerrar
          </Button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <InvoiceHeaderFields
            idPrefix="factura-edit"
            form={form}
            onFieldChange={handleFieldChange}
            disabledFields={lockedAmounts}
            disabledHint={AMOUNT_LOCK_HINT}
            mismatch={mismatch}
          />

          {ownedObligation ? (
            <ClassificationFields
              idPrefix="factura-edit"
              categoryType={categoryType}
              projects={activeProjects}
              classification={{ categoryName: form.categoryName, projectId: form.projectId, costCenterId: form.costCenterId }}
              errors={plan.errors}
              onCategoryChange={handleClassificationFieldChange('categoryName')}
              onProjectChange={handleProjectChange}
              onCostCenterChange={handleClassificationFieldChange('costCenterId')}
            />
          ) : (
            <p className="label-mono text-[var(--color-fg-4)]">
              Esta factura no creó ninguna obligación propia: no hay clasificación que editar aquí.
            </p>
          )}

          <FieldLabel label="Motivo de la corrección" htmlFor="factura-edit-reason">
            <input
              id="factura-edit-reason"
              required
              className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-0)] px-3 py-2 text-sm text-[var(--color-fg-1)]"
              value={form.reason}
              onChange={handleFieldChange('reason')}
            />
          </FieldLabel>
          {plan.errors.reason && <p className="text-xs text-[var(--color-err)]">{plan.errors.reason}</p>}

          {summary.length > 0 && (
            <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-2)] p-3 text-sm text-[var(--color-fg-2)]">
              {summary.map((line) => (
                <p key={line}>{line}</p>
              ))}
            </div>
          )}
          {plan.skippedMovements.length > 0 && (
            <p className="text-xs text-[var(--color-fg-4)]">
              No se tocan: {plan.skippedMovements.length} movimiento{plan.skippedMovements.length > 1 ? 's' : ''} bancario
              {plan.skippedMovements.length > 1 ? 's' : ''} ligado{plan.skippedMovements.length > 1 ? 's' : ''} a varias facturas.
            </p>
          )}

          <div className="flex items-center gap-2">
            <Button type="submit" variant="primary" loading={submitting} disabled={submitting}>
              Guardar cambios
            </Button>
            <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>
              Cancelar
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default InvoiceEditModal;
