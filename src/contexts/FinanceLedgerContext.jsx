import { createContext, useContext, useMemo } from 'react';
import { useFinanceLedger } from '../hooks/useFinanceLedger';

/**
 * FinanceLedgerContext — single shared instance of useFinanceLedger.
 *
 * Wrap the authenticated app shell with <FinanceLedgerProvider user={user}>.
 * All components that previously called useFinanceLedger(user) directly should
 * now call useFinanceLedgerContext() to reuse the single set of Firestore
 * listeners instead of opening their own.
 *
 * Components that call useTreasuryMetrics with filter options (from/to/projectId/
 * payrollByProject) should pass `ledger: useFinanceLedgerContext()` to the hook
 * so the hook skips its internal useFinanceLedger instantiation.
 */

const FinanceLedgerContext = createContext(null);

export const FinanceLedgerProvider = ({ user, children }) => {
  const ledger = useFinanceLedger(user);

  // Stable reference: useMemo ensures the context value only changes when the
  // ledger object reference changes (which it already memoizes internally).
  const value = useMemo(() => ledger, [ledger]);

  return (
    <FinanceLedgerContext.Provider value={value}>
      {children}
    </FinanceLedgerContext.Provider>
  );
};

/**
 * useFinanceLedgerContext — consume the shared ledger.
 * Throws a descriptive error when called outside the provider so misconfiguration
 * is caught immediately in development.
 */
export const useFinanceLedgerContext = () => {
  const ctx = useContext(FinanceLedgerContext);
  if (ctx === null) {
    throw new Error(
      'useFinanceLedgerContext must be used inside <FinanceLedgerProvider>. ' +
      'Wrap the authenticated app shell with FinanceLedgerProvider.',
    );
  }
  return ctx;
};
