// Centros de Costo predefinidos — derived from the cost center catalogue v2
// (see src/finance/costCenterCatalog.js for the full rationale). `id` mirrors
// the catalogue `code` (v2 rule: the Firestore doc id equals the code), and
// `type`/`budget`/`responsible` keep the exact shape CostCenters.jsx's
// `handleLoadPredefined` writes to Firestore. Budgets are not modeled per
// center yet — seeded at 0 and edited from the settings screen.
import { COST_CENTER_CATALOG } from '../finance/costCenterCatalog.js';

export const COST_CENTERS = COST_CENTER_CATALOG.map((entry) => ({
  id: entry.code,
  name: entry.name,
  type: 'Costos',
  budget: 0,
  spent: 0,
  responsible: 'Por Asignar',
}));

// Centros de Ingresos (vacío por defecto)
export const INCOME_CENTERS = [];

// Generar nuevo ID
export const generateCostCenterId = (centers) => {
  const maxNum = centers.reduce((max, cc) => {
    const num = parseInt(cc.id.replace('CC-', ''));
    return num > max ? num : max;
  }, 0);
  return `CC-${String(maxNum + 1).padStart(3, '0')}`;
};
