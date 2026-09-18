/**
 * Shared classification block (categoría / proyecto / centro de costo) —
 * used by InvoiceIntakePanel (new invoice, with an auto-suggestion) and
 * InvoiceEditModal (T13 correction of an archived invoice, no suggestion).
 *
 * `suggestion` is optional: when present, a confidence badge and per-field
 * reasons are shown (intake); when absent, the block is a plain editable
 * form with no reasons.
 */
import { costCenterOptions, scopeOfCostCenter } from '../../../finance/costCenterCatalog';
import { categoryOptions } from '../../../finance/taxonomy';
import FieldLabel from './FieldLabel';

const CONFIDENCE_BADGE = { high: 'nx-badge-ok', medium: 'nx-badge-info', low: 'nx-badge-warn', none: 'nx-badge-neutral' };
const CONFIDENCE_LABEL = { high: 'Confianza alta', medium: 'Confianza media', low: 'Confianza baja', none: 'Sin evidencia' };
const SCOPE_LABEL = { project: 'Obra', overhead: 'Estructura' };

/** `{ name, groupLabel }[]` for `type`, grouped in taxonomy order — one array of `{label, options}` groups. */
const categoryGroupsFor = (type) => {
  const groups = [];
  categoryOptions()
    .filter((option) => option.type === type)
    .forEach((option) => {
      let group = groups.find((g) => g.label === option.groupLabel);
      if (!group) {
        group = { label: option.groupLabel, options: [] };
        groups.push(group);
      }
      group.options.push(option);
    });
  return groups;
};

const ClassificationFields = ({
  idPrefix = 'facturas',
  categoryType,
  projects = [],
  classification,
  suggestion = null,
  errors = {},
  legend = 'Clasificación',
  onCategoryChange,
  onProjectChange,
  onCostCenterChange,
}) => {
  const categoryGroups = categoryGroupsFor(categoryType);
  const directCenters = costCenterOptions().filter((option) => option.kind === 'direct');
  const indirectCenters = costCenterOptions().filter((option) => option.kind !== 'direct');
  const reasonFor = (field) => suggestion?.reasons?.find((reason) => reason.field === field)?.detail;
  const resolvedScope = scopeOfCostCenter(classification.costCenterId) || '';

  return (
    <fieldset className="space-y-3 rounded-md border border-[var(--color-line)] bg-[var(--color-bg-0)] p-3">
      <legend className="label-mono px-1 text-[var(--color-fg-4)]">{legend}</legend>

      {suggestion && (
        <p className="flex flex-wrap items-center gap-2 text-xs text-[var(--color-fg-3)]">
          <span className={`nx-badge ${CONFIDENCE_BADGE[suggestion.confidence] || CONFIDENCE_BADGE.none}`}>
            {CONFIDENCE_LABEL[suggestion.confidence] || CONFIDENCE_LABEL.none}
          </span>
          Sugerencia automática — revisa y confirma antes de archivar
        </p>
      )}

      {/*
        The reason/error <p> lines are deliberately OUTSIDE FieldLabel —
        FieldLabel nests its children inside <label>, and testing-library's
        (and screen readers') accessible-name computation for a <label>
        strips a nested form control's own text but NOT a nested <p>, so
        keeping them inside would silently fold "Categoría" into
        "CategoríaRegla de clasificación… asigna esta categoría" as the
        field's accessible name.
      */}
      <div>
        <FieldLabel label="Categoría" htmlFor={`${idPrefix}-category`}>
          <select
            id={`${idPrefix}-category`}
            className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-0)] px-3 py-2 text-sm text-[var(--color-fg-1)]"
            value={classification.categoryName}
            onChange={onCategoryChange}
          >
            <option value="">Selecciona una categoría…</option>
            {categoryGroups.map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.options.map((option) => (
                  <option key={option.name} value={option.name}>
                    {option.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </FieldLabel>
        {reasonFor('categoryName') && <p className="mt-1 text-xs text-[var(--color-fg-4)]">{reasonFor('categoryName')}</p>}
        {errors.categoryName && <p className="mt-1 text-xs text-[var(--color-err)]">{errors.categoryName}</p>}
      </div>

      <div>
        <FieldLabel label="Proyecto" htmlFor={`${idPrefix}-project`}>
          <select
            id={`${idPrefix}-project`}
            className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-0)] px-3 py-2 text-sm text-[var(--color-fg-1)]"
            value={classification.projectId}
            onChange={onProjectChange}
          >
            <option value="">Sin proyecto (estructura)</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.displayName || project.name || project.code}
              </option>
            ))}
          </select>
        </FieldLabel>
        {reasonFor('projectId') && <p className="mt-1 text-xs text-[var(--color-fg-4)]">{reasonFor('projectId')}</p>}
        {errors.projectId && <p className="mt-1 text-xs text-[var(--color-err)]">{errors.projectId}</p>}
      </div>

      <div>
        <FieldLabel label="Centro de costo" htmlFor={`${idPrefix}-cost-center`}>
          <select
            id={`${idPrefix}-cost-center`}
            className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-0)] px-3 py-2 text-sm text-[var(--color-fg-1)]"
            value={classification.costCenterId}
            onChange={onCostCenterChange}
          >
            <option value="">Sin centro de costo</option>
            <optgroup label="Directo (obra)">
              {directCenters.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </optgroup>
            <optgroup label="Indirecto / estructura">
              {indirectCenters.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </optgroup>
          </select>
        </FieldLabel>
        {reasonFor('costCenterId') && <p className="mt-1 text-xs text-[var(--color-fg-4)]">{reasonFor('costCenterId')}</p>}
        {errors.costCenterId && <p className="mt-1 text-xs text-[var(--color-err)]">{errors.costCenterId}</p>}
      </div>

      <p className="label-mono text-[var(--color-fg-4)]">
        Destino: <span className="text-[var(--color-fg-1)]">{SCOPE_LABEL[resolvedScope] || 'Sin determinar'}</span>
      </p>
    </fieldset>
  );
};

export default ClassificationFields;
