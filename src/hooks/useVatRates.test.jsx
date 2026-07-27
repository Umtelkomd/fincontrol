/**
 * useVatRates — the `settings/vatRates` singleton behind the category VAT map.
 *
 * Two behaviours matter beyond plumbing: the document seeds itself from
 * DEFAULT_CATEGORY_VAT_RATES the first time it is read (so a fresh install is
 * not blank), and a rate that is not a finite number in [0, 1] is refused rather
 * than stored — 19 instead of 0.19 would multiply every project cost by ~16%.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { installFirebaseMocks, TEST_USER } from '@/test/firebaseMock';

const store = installFirebaseMocks({ documents: {} });

const firestore = await import('firebase/firestore');
const { useVatRates } = await import('./useVatRates.js');
const { DEFAULT_CATEGORY_VAT_RATES } = await import('../finance/vatRates.js');

const lastSetDocPayload = () => {
  const calls = firestore.setDoc.mock.calls;
  return calls[calls.length - 1]?.[1];
};

beforeEach(() => {
  store.documents = {};
  firestore.setDoc.mockClear();
});

describe('useVatRates — reading', () => {
  it('seeds the document from the defaults when it does not exist yet', async () => {
    const { result } = renderHook(() => useVatRates(TEST_USER));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.categoryRates).toEqual(DEFAULT_CATEGORY_VAT_RATES);
    await waitFor(() => expect(firestore.setDoc).toHaveBeenCalled());
    expect(lastSetDocPayload().rates).toEqual(DEFAULT_CATEGORY_VAT_RATES);
  });

  it('reads the persisted map once the document exists', async () => {
    store.documents.vatRates = { rates: { Subcontratos: 0, Materiales: 0.19 } };

    const { result } = renderHook(() => useVatRates(TEST_USER));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.categoryRates).toEqual({ Subcontratos: 0, Materiales: 0.19 });
    expect(firestore.setDoc).not.toHaveBeenCalled();
  });

  it('drops stored values that are not usable rates instead of trusting them', async () => {
    store.documents.vatRates = {
      rates: { Materiales: 0.19, Subcontratos: 19, Equipos: '0.19', Otros: null },
    };

    const { result } = renderHook(() => useVatRates(TEST_USER));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.categoryRates).toEqual({ Materiales: 0.19 });
  });

  it('stays idle without a user', () => {
    const { result } = renderHook(() => useVatRates(null));

    expect(result.current.categoryRates).toEqual(DEFAULT_CATEGORY_VAT_RATES);
    expect(firestore.setDoc).not.toHaveBeenCalled();
  });
});

describe('useVatRates — saveRate', () => {
  const renderReady = async () => {
    store.documents.vatRates = { rates: { Materiales: 0.19 } };
    const { result } = renderHook(() => useVatRates(TEST_USER));
    await waitFor(() => expect(result.current.loading).toBe(false));
    firestore.setDoc.mockClear();
    return result;
  };

  it('persists a valid rate merged into the existing map', async () => {
    const result = await renderReady();

    let outcome;
    await act(async () => {
      outcome = await result.current.saveRate('Subcontratos', 0.19);
    });

    expect(outcome.success).toBe(true);
    expect(lastSetDocPayload().rates).toEqual({ Materiales: 0.19, Subcontratos: 0.19 });
  });

  it('accepts a numeric string from a number input', async () => {
    const result = await renderReady();

    await act(async () => {
      await result.current.saveRate('Subcontratos', '0.07');
    });

    expect(lastSetDocPayload().rates.Subcontratos).toBe(0.07);
  });

  it('refuses a percentage typed as 19 instead of 0.19', async () => {
    const result = await renderReady();

    let outcome;
    await act(async () => {
      outcome = await result.current.saveRate('Subcontratos', 19);
    });

    expect(outcome).toEqual({ success: false, error: 'invalid-rate' });
    expect(firestore.setDoc).not.toHaveBeenCalled();
  });

  it.each([
    ['a blank input', ''],
    ['whitespace', '   '],
    ['null', null],
    ['undefined', undefined],
    ['a negative rate', -0.01],
    ['a rate above 1', 1.5],
    ['a non-numeric string', 'diecinueve'],
  ])('refuses %s', async (_label, value) => {
    const result = await renderReady();

    let outcome;
    await act(async () => {
      outcome = await result.current.saveRate('Subcontratos', value);
    });

    expect(outcome).toEqual({ success: false, error: 'invalid-rate' });
    expect(firestore.setDoc).not.toHaveBeenCalled();
  });

  it('refuses a blank category name', async () => {
    const result = await renderReady();

    let outcome;
    await act(async () => {
      outcome = await result.current.saveRate('   ', 0.19);
    });

    expect(outcome).toEqual({ success: false, error: 'invalid-category' });
    expect(firestore.setDoc).not.toHaveBeenCalled();
  });
});

describe('useVatRates — clearRate', () => {
  it('removes the entry so the category reads as unconfigured again', async () => {
    store.documents.vatRates = { rates: { Materiales: 0.19, Subcontratos: 0 } };
    const { result } = renderHook(() => useVatRates(TEST_USER));
    await waitFor(() => expect(result.current.loading).toBe(false));
    firestore.setDoc.mockClear();

    let outcome;
    await act(async () => {
      outcome = await result.current.clearRate('Subcontratos');
    });

    expect(outcome.success).toBe(true);
    expect(lastSetDocPayload().rates).toEqual({ Materiales: 0.19 });
  });
});
