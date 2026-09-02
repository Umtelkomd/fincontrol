/**
 * Flat category name lists, derived from the versioned taxonomy.
 *
 * Kept for the screens that still take `string[]` (TransactionFormModal,
 * CanonicalRecordModal, CXP/CXC forms). The catalogue itself — groups, types,
 * default scopes, legacy mapping — lives in `src/finance/taxonomy.js`; nothing
 * is declared here any more.
 */
import { EXPENSE_CATEGORY_NAMES, INCOME_CATEGORY_NAMES } from '../finance/taxonomy.js';

// Categorías de gastos
export const EXPENSE_CATEGORIES = [...EXPENSE_CATEGORY_NAMES];

// Categorías de ingresos
export const INCOME_CATEGORIES = [...INCOME_CATEGORY_NAMES];
