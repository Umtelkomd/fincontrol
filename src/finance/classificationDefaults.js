/**
 * classificationDefaults — the one cost-center default rule shared by every
 * classification surface: the invoice intake wizard (T5, InvoiceIntakePanel)
 * and the bank-movement categorize form (T6, CategorizeModal). Extracted here
 * instead of duplicated in both components, per the design doc's project
 * present ⇒ direct center (from the project's line); no project ⇒ indirect
 * center (from the category) rule (see costCenterCatalog.js's module doc).
 *
 * Pure: no React, no Firebase, no Date.now() — no I/O of any kind.
 */
import { defaultCostCenterForCategory } from './costCenterCatalog.js';
import { defaultCostCenterForProject } from './projectCode.js';

/**
 * defaultCostCenterFor — the cost center a project/category combination
 * defaults to, never a guess: '' when neither resolves to one.
 *
 * @param {{ projectId?: string, project?: object, categoryName?: string }} params
 *   `project` is the resolved project doc for `projectId` (only its `code`
 *   matters, via defaultCostCenterForProject); when omitted a bare
 *   `{ id: projectId }` is used, which resolves to '' unless the project has
 *   no other line evidence — callers that HAVE the project doc should pass it.
 * @returns {string} a v2 cost center code, or ''
 */
export const defaultCostCenterFor = ({ projectId, project, categoryName } = {}) => {
  const id = String(projectId || '').trim();
  if (id) return defaultCostCenterForProject(project || { id });
  return defaultCostCenterForCategory(categoryName);
};
