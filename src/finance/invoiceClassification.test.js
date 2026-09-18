/**
 * Invoice classification suggester — turns a confirmed invoice header, its
 * PDF text, the known projects/rules/history into a suggested
 * category+project+cost center with a visible reason per field, and the
 * validation the confirm step enforces before an obligation is created.
 */
import { describe, expect, it } from 'vitest';

import { buildClassificationFields, suggestInvoiceClassification, validateInvoiceClassification } from './invoiceClassification.js';

const PROJECT_RSD = { id: 'proj-rsd', code: 'QFF', name: 'Roßdorf' }; // legacy code -> INS-RSD-BL1 (BL line)
const PROJECT_WRZ = { id: 'proj-wrz', code: 'INS-WRZ-N41', name: 'Würzburg' };

const rule = (overrides = {}) => ({
  id: 'rule-1',
  pattern: 'OBI',
  matchType: 'contains',
  field: 'counterpartyName',
  direction: 'both',
  active: true,
  priority: 100,
  applyTo: { categoryName: '', costCenterId: '', projectId: '', projectName: '', costScope: '' },
  ...overrides,
});

const historyRow = (overrides = {}) => ({
  counterpartyName: '',
  categoryName: '',
  projectId: '',
  projectName: '',
  costCenterId: '',
  ...overrides,
});

const header = (overrides = {}) => ({
  counterpartyName: 'Proveedor Desconocido',
  invoiceNumber: 'F-2026-001',
  grossAmount: 119,
  ...overrides,
});

const reasonFor = (reasons, field) => reasons.filter((r) => r.field === field);

describe('suggestInvoiceClassification — project from PDF text', () => {
  it('resolves a structured/legacy code hit as the project, high confidence', () => {
    const result = suggestInvoiceClassification({
      header: header({ counterpartyName: 'Ferretería Genérica GmbH' }),
      text: 'Rechnung fuer Projekt QFF, Lieferung Material',
      direction: 'payable',
      projects: [PROJECT_RSD],
      rules: [],
      history: [],
    });

    expect(result.projectId).toBe('proj-rsd');
    expect(result.projectName).toBe('Roßdorf');
    expect(result.confidence).toBe('high');
    expect(reasonFor(result.reasons, 'projectId')).toEqual([
      expect.objectContaining({ field: 'projectId', source: 'pdf-text', detail: expect.any(String) }),
    ]);
    // No category evidence at all for a payable with no rule/history/fallback.
    expect(result.categoryName).toBe('');
    // Cost center is derived from the project's line (BL -> CC-110), never guessed.
    expect(result.costCenterId).toBe('CC-110');
    expect(result.costScope).toBe('project');
    expect(reasonFor(result.reasons, 'costCenterId')).toEqual([
      expect.objectContaining({ field: 'costCenterId', source: 'project-line' }),
    ]);
  });

  it('resolves a legacy alias hit (not the stored code itself) as the project', () => {
    const result = suggestInvoiceClassification({
      header: header(),
      text: 'Baustelle Würzburg, Ausbauarbeiten',
      direction: 'payable',
      projects: [PROJECT_WRZ],
      rules: [],
      history: [],
    });

    expect(result.projectId).toBe('proj-wrz');
    expect(result.projectName).toBe('Würzburg');
    expect(reasonFor(result.reasons, 'projectId')[0]).toMatchObject({ source: 'pdf-text' });
  });

  it('lowers confidence and says so when ≥2 distinct projects are mentioned, keeping the first', () => {
    const text = 'Würzburg Ausbau, dann QFF Nacharbeit';
    const result = suggestInvoiceClassification({
      header: header(),
      text,
      direction: 'payable',
      projects: [PROJECT_WRZ, PROJECT_RSD],
      rules: [],
      history: [],
    });

    // "Würzburg" occurs first in the text.
    expect(result.projectId).toBe('proj-wrz');
    expect(result.confidence).not.toBe('high');
    const projectReason = reasonFor(result.reasons, 'projectId')[0];
    expect(projectReason.source).toBe('pdf-text');
    expect(projectReason.detail.toLowerCase()).toMatch(/varios|ambig/);
  });
});

describe('suggestInvoiceClassification — counterparty history', () => {
  const history = [
    historyRow({ counterpartyName: 'Baumarkt Meyer GmbH', categoryName: 'Materiales', projectId: 'proj-rsd', projectName: 'Roßdorf', costCenterId: 'CC-110' }),
    historyRow({ counterpartyName: 'Baumarkt Meyer S.L.', categoryName: 'Materiales', projectId: 'proj-rsd', projectName: 'Roßdorf', costCenterId: 'CC-110' }),
    historyRow({ counterpartyName: 'Baumarkt Meyer', categoryName: 'Equipos y herramienta', projectId: 'proj-rsd', projectName: 'Roßdorf', costCenterId: '' }),
  ];

  it('takes the most frequent non-empty value per field, accent/case/legal-suffix tolerant matching', () => {
    const result = suggestInvoiceClassification({
      header: header({ counterpartyName: '  baumarkt meyer gmbh  ' }),
      text: '',
      direction: 'payable',
      projects: [PROJECT_RSD],
      rules: [],
      history,
    });

    expect(result.categoryName).toBe('Materiales'); // 2 of 3 rows
    expect(result.projectId).toBe('proj-rsd'); // 3 of 3 rows
    expect(result.projectName).toBe('Roßdorf');
    expect(result.costCenterId).toBe('CC-110'); // 2 of 3 rows (one row has no center)
    expect(result.costScope).toBe('project');
    expect(reasonFor(result.reasons, 'categoryName')[0]).toMatchObject({ source: 'history' });
    expect(reasonFor(result.reasons, 'projectId')[0]).toMatchObject({ source: 'history' });
    expect(reasonFor(result.reasons, 'costCenterId')[0]).toMatchObject({ source: 'history' });
  });

  it('marks a single matching row as low confidence', () => {
    const result = suggestInvoiceClassification({
      header: header({ counterpartyName: 'Ferretería Única S.L.' }),
      text: '',
      direction: 'payable',
      projects: [],
      rules: [],
      history: [historyRow({ counterpartyName: 'Ferretería Única', categoryName: 'Materiales' })],
    });

    expect(result.categoryName).toBe('Materiales');
    expect(result.confidence).toBe('low');
  });

  it('finds no match for an unrelated counterparty', () => {
    const result = suggestInvoiceClassification({
      header: header({ counterpartyName: 'Otro Proveedor GmbH' }),
      text: '',
      direction: 'payable',
      projects: [],
      rules: [],
      history,
    });

    expect(result.categoryName).toBe('');
    expect(result.projectId).toBe('');
  });
});

describe('suggestInvoiceClassification — classification rules', () => {
  it('applies the best matching rule when no PDF text or history resolved the field', () => {
    const result = suggestInvoiceClassification({
      header: header({ counterpartyName: 'OBI Baumarkt Stralsund' }),
      text: '',
      direction: 'payable',
      projects: [],
      rules: [rule({ applyTo: { categoryName: 'Materiales', costCenterId: '', projectId: '', projectName: '', costScope: '' } })],
      history: [],
    });

    expect(result.categoryName).toBe('Materiales');
    expect(reasonFor(result.reasons, 'categoryName')[0]).toMatchObject({ source: 'rule' });
    // Materiales has no indirect default (it always requires a project) — never guessed.
    expect(result.costCenterId).toBe('');
    // costScope still derives from the category's own defaultScope.
    expect(result.costScope).toBe('project');
  });

  it('adapts direction to the rule engine convention: out for payable, in for receivable', () => {
    const directionalRule = rule({
      pattern: 'OBI',
      direction: 'in',
      applyTo: { categoryName: 'Servicios particulares', costCenterId: '', projectId: '', projectName: '', costScope: '' },
    });

    const asPayable = suggestInvoiceClassification({
      header: header({ counterpartyName: 'OBI Baumarkt' }),
      text: '',
      direction: 'payable',
      projects: [],
      rules: [directionalRule],
      history: [],
    });
    expect(asPayable.categoryName).toBe('');

    const asReceivable = suggestInvoiceClassification({
      header: header({ counterpartyName: 'OBI Baumarkt' }),
      text: '',
      direction: 'receivable',
      projects: [],
      rules: [directionalRule],
      history: [],
    });
    expect(asReceivable.categoryName).toBe('Servicios particulares');
  });
});

describe('suggestInvoiceClassification — category fallback for receivables', () => {
  it('defaults an unresolved receivable to Facturación obra, low confidence', () => {
    const result = suggestInvoiceClassification({
      header: header({ counterpartyName: 'Cliente Nuevo GmbH' }),
      text: '',
      direction: 'receivable',
      projects: [],
      rules: [],
      history: [],
    });

    expect(result.categoryName).toBe('Facturación obra');
    expect(result.confidence).toBe('low');
    expect(reasonFor(result.reasons, 'categoryName')[0]).toMatchObject({ source: 'category-default' });
  });

  it('never applies the fallback to a payable', () => {
    const result = suggestInvoiceClassification({
      header: header({ counterpartyName: 'Cliente Nuevo GmbH' }),
      text: '',
      direction: 'payable',
      projects: [],
      rules: [],
      history: [],
    });

    expect(result.categoryName).toBe('');
    expect(result.confidence).toBe('none');
  });
});

describe('suggestInvoiceClassification — precedence between sources', () => {
  it('lets history win over a rule for the same field, even at low confidence', () => {
    const result = suggestInvoiceClassification({
      header: header({ counterpartyName: 'Ferretería Ejemplo GmbH' }),
      text: '',
      direction: 'payable',
      projects: [],
      rules: [rule({ pattern: 'Ferreteria', applyTo: { categoryName: 'Materiales', costCenterId: '', projectId: '', projectName: '', costScope: '' } })],
      history: [historyRow({ counterpartyName: 'Ferretería Ejemplo GmbH', categoryName: 'Equipos y herramienta' })],
    });

    expect(result.categoryName).toBe('Equipos y herramienta');
    expect(reasonFor(result.reasons, 'categoryName')[0]).toMatchObject({ source: 'history' });
    // No project anywhere -> the category-derived default (CC-210) still applies.
    expect(result.costCenterId).toBe('CC-210');
    expect(reasonFor(result.reasons, 'costCenterId')[0]).toMatchObject({ source: 'category-default' });
  });

  it('lets a PDF-text project mention win over history for the project field', () => {
    const result = suggestInvoiceClassification({
      header: header({ counterpartyName: 'Baumarkt Meyer GmbH' }),
      text: 'Baustelle Würzburg, Ausbau',
      direction: 'payable',
      projects: [PROJECT_WRZ, PROJECT_RSD],
      rules: [],
      history: [historyRow({ counterpartyName: 'Baumarkt Meyer GmbH', projectId: 'proj-rsd', projectName: 'Roßdorf' })],
    });

    expect(result.projectId).toBe('proj-wrz');
    expect(reasonFor(result.reasons, 'projectId')[0]).toMatchObject({ source: 'pdf-text' });
  });
});

describe('suggestInvoiceClassification — unresolved legacy cost center is dropped', () => {
  it('falls back to the project-line default instead of an unresolvable stored center', () => {
    const history = [
      historyRow({ counterpartyName: 'Constructora XYZ GmbH', categoryName: 'Materiales', projectId: 'proj-rsd', projectName: 'Roßdorf', costCenterId: 'CC-007' }),
      historyRow({ counterpartyName: 'Constructora XYZ GmbH', categoryName: 'Materiales', projectId: 'proj-rsd', projectName: 'Roßdorf', costCenterId: 'CC-007' }),
    ];

    const result = suggestInvoiceClassification({
      header: header({ counterpartyName: 'Constructora XYZ GmbH' }),
      text: '',
      direction: 'payable',
      projects: [PROJECT_RSD],
      rules: [],
      history,
    });

    // CC-007 has no recorded meaning (resolveLegacyCostCenter -> unresolved) and is
    // dropped; QFF's line (BL) still gives a valid direct default: CC-110.
    expect(result.costCenterId).toBe('CC-110');
    expect(reasonFor(result.reasons, 'costCenterId')[0]).toMatchObject({ source: 'project-line' });
  });
});

describe('suggestInvoiceClassification — never guesses', () => {
  it('returns empty fields and confidence "none" with nothing to go on', () => {
    const result = suggestInvoiceClassification({
      header: header(),
      text: '',
      direction: 'payable',
      projects: [],
      rules: [],
      history: [],
    });

    expect(result).toEqual({
      categoryName: '',
      projectId: '',
      projectName: '',
      costCenterId: '',
      costScope: '',
      confidence: 'none',
      reasons: [],
    });
  });
});

describe('validateInvoiceClassification', () => {
  it('requires a category', () => {
    expect(validateInvoiceClassification({ direction: 'payable', categoryName: '', costCenterId: 'CC-110', projectId: 'proj-1' }).errors.categoryName)
      .toBeTruthy();
  });

  it('requires an expense category for a payable', () => {
    const result = validateInvoiceClassification({
      direction: 'payable',
      categoryName: 'Facturación obra', // income category
      costCenterId: 'CC-110',
      projectId: 'proj-1',
    });
    expect(result.valid).toBe(false);
    expect(result.errors.categoryName).toBeTruthy();
  });

  it('requires an income category for a receivable', () => {
    const result = validateInvoiceClassification({
      direction: 'receivable',
      categoryName: 'Materiales', // expense category
    });
    expect(result.valid).toBe(false);
    expect(result.errors.categoryName).toBeTruthy();
  });

  it('requires a cost center for a payable', () => {
    const result = validateInvoiceClassification({ direction: 'payable', categoryName: 'Materiales', costCenterId: '', projectId: 'proj-1' });
    expect(result.valid).toBe(false);
    expect(result.errors.costCenterId).toBeTruthy();
  });

  it('rejects a direct cost center on a payable with no project', () => {
    const result = validateInvoiceClassification({ direction: 'payable', categoryName: 'Materiales', costCenterId: 'CC-100', projectId: '' });
    expect(result.valid).toBe(false);
    expect(result.errors.costCenterId).toBeTruthy();
  });

  it('accepts a fully valid payable', () => {
    expect(validateInvoiceClassification({ direction: 'payable', categoryName: 'Materiales', costCenterId: 'CC-100', projectId: 'proj-1' }))
      .toEqual({ valid: true, errors: {} });
  });

  it('requires a project when the receivable category is Facturación obra', () => {
    const result = validateInvoiceClassification({ direction: 'receivable', categoryName: 'Facturación obra', projectId: '' });
    expect(result.valid).toBe(false);
    expect(result.errors.projectId).toBeTruthy();
  });

  it('does not require a project for a non-obra receivable', () => {
    expect(validateInvoiceClassification({ direction: 'receivable', categoryName: 'Servicios particulares', projectId: '' }))
      .toEqual({ valid: true, errors: {} });
  });

  it('leaves the cost center optional for a receivable', () => {
    expect(validateInvoiceClassification({ direction: 'receivable', categoryName: 'Facturación obra', projectId: 'proj-1', costCenterId: '' }))
      .toEqual({ valid: true, errors: {} });
  });
});

describe('buildClassificationFields', () => {
  it('builds the exact persisted shape, resolving the project display name', () => {
    const fields = buildClassificationFields(
      { categoryName: 'Materiales', projectId: 'proj-rsd', costCenterId: 'CC-110' },
      [{ id: 'proj-rsd', code: 'QFF', name: 'Roßdorf', displayName: 'QFF (Roßdorf)' }],
    );

    expect(fields).toEqual({
      categoryName: 'Materiales',
      projectId: 'proj-rsd',
      projectName: 'QFF (Roßdorf)',
      costCenterId: 'CC-110',
      costScope: 'project',
    });
  });

  it('falls back to the category defaultScope when the cost center does not resolve a scope', () => {
    const fields = buildClassificationFields({ categoryName: 'Salarios', projectId: '', costCenterId: '' }, []);
    expect(fields.costScope).toBe('overhead');
    expect(fields.projectName).toBe('');
  });

  it('leaves projectName empty when the project is not found in the list', () => {
    const fields = buildClassificationFields({ categoryName: 'Materiales', projectId: 'ghost', costCenterId: '' }, []);
    expect(fields.projectName).toBe('');
  });
});
