/**
 * Category mapping for Budget vs Actual.
 * Maps transaction categories → Budget category names (as defined in budget lines).
 *
 * Sources:
 * - 2025 static: EGR-*, ING-*, EGR-CXP
 * - 2026 Firebase: Spanish names from categories.js
 */
export const CATEGORY_MAPPING = {
  // ─── Expense groups ────────────────────────────────────────────
  'Administrativo': [
    'EGR-ADM', 'EGR-CXP', 'EGR-GES', 'Gestión',
    'Facturas Telefonos', 'Telefonos', 'Miscelaneos Oficina',
  ],
  'Subcontratos': [
    'EGR-SUB', 'Subcontratos',
  ],
  'Salarios': [
    'EGR-MO', 'Nómina', 'Nomina', 'Salarios',
  ],
  'Vivienda': [
    'EGR-ARR', 'Alquiler', 'Vivienda',
  ],
  'Seguros': [
    'EGR-SEG', 'Seguros',
  ],
  'Reparaciones': [
    'Reparaciones',
  ],
  'Cuotas vehiculos': [
    'EGR-TRN', 'Cuotas vehiculos', 'Alquiler vehiculo', 'Vehiculos',
  ],
  'Combustible': [
    'EGR-GAS', 'Gasolina', 'Combustible', 'Transporte/Combustible',
  ],
  'Materiales': [
    'EGR-MAT', 'Materiales',
  ],
  'Impuestos': [
    'EGR-FIN', 'EGR-IMP', 'Impuestos', 'Impuestos Vehiculos',
    'Intereses Bancos', 'Intereses prestamos',
  ],
  'Equipos': [
    'EGR-EQP', 'EGR-HERR', 'Equipos', 'Equipos Alquileres',
  ],
  'Servicios': [
    'EGR-SRV',
  ],
  'Otros': [
    'EGR-OTR', 'Otros',
  ],
};

/**
 * Income category mapping — separate to avoid key collision.
 */
export const INCOME_CATEGORY_MAPPING = {
  'Ingresos Servicios': [
    'ING-FAC', 'ING-SRV', 'Servicios',
  ],
  'SP': [
    'ING-OTR', 'SP',
  ],
  'Consultoria': [
    'Consultoria',
  ],
  'Por Venta': [
    'Por Venta',
  ],
};

/**
 * Reverse lookup maps (direction-aware)
 * txToBudgetMap: expense category → budget category  
 * incToBudgetMap: income category → budget category
 */
export const txToBudgetMap = (() => {
  const map = new Map();
  for (const [budgetCat, txCats] of Object.entries(CATEGORY_MAPPING)) {
    for (const txCat of txCats) {
      map.set(txCat, budgetCat);
    }
  }
  return map;
})();

export const incToBudgetMap = (() => {
  const map = new Map();
  for (const [budgetCat, txCats] of Object.entries(INCOME_CATEGORY_MAPPING)) {
    for (const txCat of txCats) {
      map.set(txCat, budgetCat);
    }
  }
  return map;
})();
