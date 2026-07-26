/**
 * Screen render helper — mounts a route component inside the same providers
 * `App.jsx` gives it: router, toasts and the shared finance ledger.
 *
 * ErrorBoundary is deliberately NOT part of the stack. In production it turns a
 * render crash into a generic error page (that is how the missing `<Link>`
 * import in Resumen blanked the whole app); in a test it would swallow the very
 * throw the test exists to catch, so a crash must propagate and fail loudly.
 *
 * IMPORTANT — import order. This module pulls in `FinanceLedgerProvider`, which
 * transitively reaches `src/services/firebase.js`, and that module throws unless
 * the Firebase env vars are present. Install the mocks FIRST, then load this
 * helper and the screen dynamically:
 *
 *     import { installFirebaseMocks } from '@/test/firebaseMock';
 *
 *     const store = installFirebaseMocks({ collections: {…}, documents: {…} });
 *     const { renderScreen } = await import('@/test/renderScreen.jsx');
 *     const { default: Screen } = await import('./Screen.jsx');
 */
import { render } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { FinanceLedgerProvider } from '../contexts/FinanceLedgerContext';
import { ToastProvider } from '../contexts/ToastContext';
import { TEST_USER } from './firebaseMock';

/**
 * @param {React.ReactElement} ui the screen element under test
 * @param {{
 *   route?: string,
 *   path?: string,
 *   user?: object|null,
 * }} [options]
 *   `route` seeds the router history (so `useParams`/`useSearchParams` resolve);
 *   `path` registers a route pattern when the screen reads URL params;
 *   `user` is handed to `FinanceLedgerProvider` — the hooks stay idle when null,
 *   which is the cheapest way to assert a screen's loading state.
 * @returns {import('@testing-library/react').RenderResult}
 */
export const renderScreen = (ui, options = {}) => {
  const { route = '/', path, user = TEST_USER, ...renderOptions } = options;

  return render(
    <MemoryRouter initialEntries={[route]}>
      <ToastProvider>
        <FinanceLedgerProvider user={user}>
          {path ? <Routes><Route path={path} element={ui} /></Routes> : ui}
        </FinanceLedgerProvider>
      </ToastProvider>
    </MemoryRouter>,
    renderOptions,
  );
};

export default renderScreen;
