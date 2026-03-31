// HMR NEXUS Color Palette for Charts
export const COLORS = [
  '#3b82f6', // Primary Blue
  '#10b981', // Success Green
  '#f59e0b', // Warning Amber
  '#ef4444', // Error Red
  '#8b5cf6', // Purple
  '#06b6d4', // Cyan
  '#ec4899', // Pink
  '#84cc16', // Lime
];

export const ADMIN_EMAIL = 'jromero@umtelkomd.com';

// Role assignments by email
export const USER_ROLES = {
  'jromero@umtelkomd.com': 'admin',
  'bsandoval@umtelkomd.com': 'manager',
};

// Permissions per role
export const ROLE_PERMISSIONS = {
  admin: ['dashboard', 'transactions', 'cxp', 'cxc', 'reports', 'cashflow', 'settings', 'budget', 'audit', 'backup'],
  manager: ['dashboard', 'transactions', 'cxp', 'cxc', 'reports'],
  editor: ['dashboard', 'transactions'],
};
export const ALERT_THRESHOLDS = {
  overdueDays: 15,
  cxpLimit: 15000,
  cxcLimit: 15000
};

// German VAT (Umsatzsteuer) rates
// VAT is collected on behalf of Finanzamt — it is NOT company revenue or expense
export const TAX_RATES = {
  STANDARD: 0.19,   // 19% regular VAT (Regelsteuersatz) — default for most transactions
  REDUCED: 0.07,     // 7% reduced VAT (ermäßigter Steuersatz) — food, books, cultural events, etc.
  ZERO: 0,           // 0% VAT exempt (steuerfrei) — certain financial services, exports outside EU
};

// Labels for display
export const TAX_RATE_LABELS = {
  0.19: '19% Std.',
  0.07: '7% Red.',
  0: '0% Ex.',
};

export const FINANCIAL_CONSTANTS = {
  // Initial bank balance is NET of VAT — the opening balance reflects only net amounts
  // since all bank transactions in Dec 2025 already had VAT separated at source.
  INITIAL_BANK_BALANCE_NET: 28450.00,
  INITIAL_BANK_BALANCE: 28450.00, // Alias for backward compat
  IVA_BALANCE_DEC2025: 7332.94,
  ESTIMATED_TAX_RATE: 0.25,
  DAYS_PER_MONTH: 30,
  RUNWAY_SAFE_MONTHS: 6,
  RUNWAY_WARNING_MONTHS: 3,
  CASH_CYCLE_WARNING_DAYS: 45,
  MARGIN_WARNING_PERCENT: 20,
  DISCREPANCY_THRESHOLD_PERCENT: 5,
  DISCREPANCY_SMALL_AMOUNT: 100,
  PROJECTION_MONTHS: 3,
};
