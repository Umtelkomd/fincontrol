/**
 * Configuración → IVA.
 *
 * The point of this panel is the thing an unset rate hides: rate 0 and "nobody
 * decided yet" produce the same number, so the screen has to say which one it
 * is — per row and as a count at the top — or the owner never learns that
 * Subcontratos is silently costing 19% too much (or too little).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { installFirebaseMocks } from '@/test/firebaseMock';
import { ledgerFixtures } from '@/test/fixtures';

const store = installFirebaseMocks(ledgerFixtures());

const firestore = await import('firebase/firestore');
const { renderScreen } = await import('@/test/renderScreen.jsx');
const { default: VatRates } = await import('./VatRates.jsx');
const { EXPENSE_CATEGORIES, INCOME_CATEGORIES } = await import('../../constants/categories.js');
const { DEFAULT_CATEGORY_VAT_RATES, categoriesMissingVatRate } = await import(
  '../../finance/vatRates.js'
);

const USER = { uid: 'test-uid', email: 'jromero@umtelkomd.com' };

const MISSING_WITH_DEFAULTS = categoriesMissingVatRate(
  [...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES],
  DEFAULT_CATEGORY_VAT_RATES,
);

/**
 * `useCategories` seeds `settings/categories` when the document is absent — as
 * it is under the fixtures — and only clears its loading flag after that write
 * resolves, one microtask later. Every assertion waits for the panel to be past
 * that gate.
 */
const renderPanel = async () => {
  renderScreen(<VatRates user={USER} />);
  await screen.findByRole('heading', { name: 'IVA por categoría' });
};

beforeEach(() => {
  const pristine = ledgerFixtures();
  Object.assign(store.collections, pristine.collections);
  store.documents = { ...pristine.documents };
  vi.clearAllMocks();
});

describe('VatRates — orientation', () => {
  it('renders the heading and warns that this never touches cash', async () => {
    await renderPanel();

    expect(screen.getByRole('heading', { name: 'IVA por categoría' })).toBeInTheDocument();
    expect(screen.getByText(/no altera la caja/i)).toBeInTheDocument();
  });

  it('explains that Subcontratos hangs on §13b reverse charge', async () => {
    await renderPanel();

    const explainer = screen.getByText(/13b/i);
    expect(explainer).toHaveTextContent('Steuerschuldnerschaft des Leistungsempfängers');
    expect(explainer).toHaveTextContent('19');
  });

  it('counts the categories nobody has decided on yet', async () => {
    await renderPanel();

    expect(
      screen.getByText(`${MISSING_WITH_DEFAULTS.length} categorías sin configurar`),
    ).toBeInTheDocument();
  });

  it('reports a fully configured map instead of a zero count', async () => {
    store.documents.vatRates = {
      rates: [...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES].reduce(
        (acc, name) => ({ ...acc, [name]: 0 }),
        {},
      ),
    };

    await renderPanel();

    expect(screen.getByText('Todas las categorías tienen IVA configurado')).toBeInTheDocument();
  });
});

describe('VatRates — rows', () => {
  it('shows the seeded rate for a category German law settles', async () => {
    await renderPanel();

    expect(screen.getByLabelText('IVA de Salarios')).toHaveValue('0');
    expect(screen.getByLabelText('IVA de Seguros')).toHaveValue('0');
  });

  it('flags an unconfigured category and leaves a deliberate 0 unflagged', async () => {
    await renderPanel();

    // The status flag, not the select's "Sin configurar" option, which shares
    // the wording because it is the same state expressed as a choice.
    const flagIn = (name) =>
      within(screen.getByLabelText(`IVA de ${name}`).closest('li')).queryByText('Sin configurar', {
        selector: 'p',
      });

    expect(flagIn('Subcontratos')).toBeInTheDocument();
    expect(flagIn('Salarios')).toBeNull();
  });

  it('renders exactly one row per category name, even for names in both lists', async () => {
    await renderPanel();

    [...new Set([...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES])].forEach((name) => {
      expect(screen.getByLabelText(`IVA de ${name}`)).toBeInTheDocument();
    });

    // "Otros" is an expense and an income category; one stored rate means one control.
    expect(screen.getAllByLabelText('IVA de Otros')).toHaveLength(1);
  });
});

describe('VatRates — editing', () => {
  it('persists the chosen rate as a fraction, not a percentage', async () => {
    store.documents.vatRates = { rates: { ...DEFAULT_CATEGORY_VAT_RATES } };

    await renderPanel();

    fireEvent.change(screen.getByLabelText('IVA de Subcontratos'), { target: { value: '0.19' } });

    await waitFor(() => expect(firestore.setDoc).toHaveBeenCalled());
    const payload = firestore.setDoc.mock.calls.at(-1)[1];
    expect(payload.rates.Subcontratos).toBe(0.19);
    expect(payload.rates.Salarios).toBe(0);
  });

  it('clears a rate back to unconfigured', async () => {
    store.documents.vatRates = { rates: { ...DEFAULT_CATEGORY_VAT_RATES, Subcontratos: 0.19 } };

    await renderPanel();

    fireEvent.change(screen.getByLabelText('IVA de Subcontratos'), { target: { value: '' } });

    await waitFor(() => expect(firestore.setDoc).toHaveBeenCalled());
    expect(firestore.setDoc.mock.calls.at(-1)[1].rates).not.toHaveProperty('Subcontratos');
  });
});
