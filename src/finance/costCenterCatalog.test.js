/**
 * Cost center catalogue v2 — the ordered, frozen catalogue that replaces the
 * mixed nature/responsibility codes production carried (`CC-002..CC-009`,
 * `CC-NOM` plus free text). See the module doc comment for the full story.
 */
import { describe, expect, it } from 'vitest';

import { COST_SCOPE } from './costScope.js';
import {
  COST_CENTER_CATALOG,
  COST_CENTER_CATALOG_VERSION,
  COST_CENTER_KIND,
  costCenterByCode,
  costCenterFilterKey,
  costCenterFilterOptions,
  costCenterOptions,
  defaultCostCenterForCategory,
  defaultCostCenterForLine,
  matchesCostCenterFilter,
  resolveLegacyCostCenter,
  resolveStoredCostCenter,
  scopeOfCostCenter,
  validateCostCenterAssignment,
} from './costCenterCatalog.js';

const APPROVED = [
  ['CC-100', 'Obra civil (Tiefbau)', 'direct', 'TB'],
  ['CC-110', 'Soplado y fusiones', 'direct', 'BL'],
  ['CC-120', 'NE4 instalación en vivienda', 'direct', 'N4'],
  ['CC-130', 'MDU cableado interior', 'direct', 'MD'],
  ['CC-190', 'Dirección de obra y documentación', 'direct', 'SV'],
  ['CC-200', 'Flota y vehículos', 'indirect', ''],
  ['CC-210', 'Equipos, almacén y herramienta', 'indirect', ''],
  ['CC-220', 'Alojamientos (pool sin obra)', 'indirect', ''],
  ['CC-300', 'Administración y finanzas', 'indirect', ''],
  ['CC-310', 'Dirección general', 'indirect', ''],
  ['CC-320', 'Personas: reclutamiento y formación', 'indirect', ''],
  ['CC-330', 'Oficina, IT y telefonía', 'indirect', ''],
  ['CC-900', 'Fiscal y financiero', 'indirect', ''],
  ['CC-NOM', 'Nómina y seguridad social', 'clearing', ''],
];

describe('COST_CENTER_CATALOG', () => {
  it('is version 2', () => {
    expect(COST_CENTER_CATALOG_VERSION).toBe(2);
  });

  it('exposes the three kinds', () => {
    expect(COST_CENTER_KIND).toEqual({ DIRECT: 'direct', INDIRECT: 'indirect', CLEARING: 'clearing' });
  });

  it('ships exactly the approved 14 entries, in order, with the approved fields', () => {
    expect(COST_CENTER_CATALOG.map((c) => [c.code, c.name, c.kind, c.line])).toEqual(APPROVED);
  });

  it('has unique codes', () => {
    const codes = COST_CENTER_CATALOG.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('is frozen so no screen can mutate the catalogue at runtime', () => {
    expect(Object.isFrozen(COST_CENTER_CATALOG)).toBe(true);
    expect(Object.isFrozen(COST_CENTER_CATALOG[0])).toBe(true);
  });
});

describe('costCenterByCode', () => {
  it('finds an entry by exact code', () => {
    expect(costCenterByCode('CC-110')).toMatchObject({ name: 'Soplado y fusiones', kind: 'direct' });
  });

  it('tolerates case and whitespace', () => {
    expect(costCenterByCode(' cc-nom ')).toMatchObject({ code: 'CC-NOM' });
    expect(costCenterByCode('cc-300')).toMatchObject({ code: 'CC-300' });
  });

  it('returns null for unknown or empty codes', () => {
    expect(costCenterByCode('CC-999')).toBeNull();
    expect(costCenterByCode('')).toBeNull();
    expect(costCenterByCode(null)).toBeNull();
  });
});

describe('scopeOfCostCenter', () => {
  it('resolves a direct center to project', () => {
    expect(scopeOfCostCenter('CC-100')).toBe(COST_SCOPE.PROJECT);
    expect(scopeOfCostCenter('CC-190')).toBe(COST_SCOPE.PROJECT);
  });

  it('resolves an indirect center to overhead', () => {
    expect(scopeOfCostCenter('CC-300')).toBe(COST_SCOPE.OVERHEAD);
  });

  it('resolves the clearing center to overhead', () => {
    expect(scopeOfCostCenter('CC-NOM')).toBe(COST_SCOPE.OVERHEAD);
  });

  it('resolves a legacy code/label through resolveLegacyCostCenter first', () => {
    expect(scopeOfCostCenter('CC-001')).toBe(COST_SCOPE.PROJECT); // -> CC-100, direct
    expect(scopeOfCostCenter('Administrativo')).toBe(COST_SCOPE.OVERHEAD); // -> CC-300, indirect
  });

  it('returns "" for an unresolved value', () => {
    expect(scopeOfCostCenter('CC-007')).toBe('');
    expect(scopeOfCostCenter('')).toBe('');
    expect(scopeOfCostCenter('Contratistas')).toBe('');
  });
});

describe('resolveLegacyCostCenter', () => {
  it('returns a current v2 code unchanged', () => {
    expect(resolveLegacyCostCenter('CC-190')).toEqual({ code: 'CC-190', status: 'current' });
    expect(resolveLegacyCostCenter(' cc-nom ')).toEqual({ code: 'CC-NOM', status: 'current' });
  });

  it('maps every legacy v1 code', () => {
    expect(resolveLegacyCostCenter('CC-001')).toEqual({ code: 'CC-100', status: 'mapped' });
    expect(resolveLegacyCostCenter('CC-002')).toEqual({ code: 'CC-120', status: 'mapped' });
    expect(resolveLegacyCostCenter('CC-003')).toEqual({ code: 'CC-120', status: 'mapped' });
    expect(resolveLegacyCostCenter('CC-004')).toEqual({ code: 'CC-300', status: 'mapped' });
    expect(resolveLegacyCostCenter('CC-005')).toEqual({ code: 'CC-110', status: 'mapped' });
  });

  it('maps every legacy label, accent/case-insensitive', () => {
    expect(resolveLegacyCostCenter('Obra Civil')).toEqual({ code: 'CC-100', status: 'mapped' });
    expect(resolveLegacyCostCenter('instalaciones y reparaciones')).toEqual({ code: 'CC-120', status: 'mapped' });
    expect(resolveLegacyCostCenter('NE4')).toEqual({ code: 'CC-120', status: 'mapped' });
    expect(resolveLegacyCostCenter('Despliegue')).toEqual({ code: 'CC-110', status: 'mapped' });
    expect(resolveLegacyCostCenter('Administrativo')).toEqual({ code: 'CC-300', status: 'mapped' });
    expect(resolveLegacyCostCenter('Gestorías')).toEqual({ code: 'CC-300', status: 'mapped' });
    expect(resolveLegacyCostCenter('GESTORIAS')).toEqual({ code: 'CC-300', status: 'mapped' });
    expect(resolveLegacyCostCenter('Seguros')).toEqual({ code: 'CC-300', status: 'mapped' });
    expect(resolveLegacyCostCenter('Financiero')).toEqual({ code: 'CC-900', status: 'mapped' });
    expect(resolveLegacyCostCenter('nomina y seguridad social')).toEqual({ code: 'CC-NOM', status: 'mapped' });
  });

  it('treats "Sin asignar" and blanks as empty, not unresolved', () => {
    expect(resolveLegacyCostCenter('Sin asignar')).toEqual({ code: '', status: 'empty' });
    expect(resolveLegacyCostCenter('')).toEqual({ code: '', status: 'empty' });
    expect(resolveLegacyCostCenter(null)).toEqual({ code: '', status: 'empty' });
    expect(resolveLegacyCostCenter(undefined)).toEqual({ code: '', status: 'empty' });
  });

  it('never guesses CC-006..CC-009, Contratistas or OPE', () => {
    ['CC-006', 'CC-007', 'CC-008', 'CC-009', 'Contratistas', 'OPE'].forEach((value) => {
      expect(resolveLegacyCostCenter(value)).toEqual({ code: '', status: 'unresolved' });
    });
  });

  /**
   * The budget screen carried a THIRD dictionary of its own (ADM/LOG/FIN/VEN
   * and their CC- prefixed spellings, mapping to the v1 labels). Those four are
   * repo evidence of what the tokens mean, so they resolve here instead of
   * being dropped — `OPE` is deliberately NOT among them: that screen guessed
   * it as "Despliegue" with nothing to back it, and a guess is worse than an
   * honest unresolved bucket.
   */
  it('maps the ADM/LOG/FIN/VEN tokens the budget screen used to resolve on its own', () => {
    expect(resolveLegacyCostCenter('ADM')).toEqual({ code: 'CC-300', status: 'mapped' });
    expect(resolveLegacyCostCenter('CC-ADM')).toEqual({ code: 'CC-300', status: 'mapped' });
    expect(resolveLegacyCostCenter('LOG')).toEqual({ code: 'CC-120', status: 'mapped' });
    expect(resolveLegacyCostCenter('CC-LOG')).toEqual({ code: 'CC-120', status: 'mapped' });
    expect(resolveLegacyCostCenter('FIN')).toEqual({ code: 'CC-900', status: 'mapped' });
    expect(resolveLegacyCostCenter('CC-FIN')).toEqual({ code: 'CC-900', status: 'mapped' });
    expect(resolveLegacyCostCenter('VEN')).toEqual({ code: 'CC-120', status: 'mapped' });
    expect(resolveLegacyCostCenter('CC-VEN')).toEqual({ code: 'CC-120', status: 'mapped' });
  });

  it('keeps OPE and CC-OPE unresolved — their meaning is not recorded anywhere', () => {
    expect(resolveLegacyCostCenter('OPE')).toEqual({ code: '', status: 'unresolved' });
    expect(resolveLegacyCostCenter('CC-OPE')).toEqual({ code: '', status: 'unresolved' });
  });

  it('resolves an unresolved code by the live Firestore doc name', () => {
    expect(resolveLegacyCostCenter('CC-007', { liveName: 'NE4' })).toEqual({ code: 'CC-120', status: 'mapped' });
    expect(resolveLegacyCostCenter('CC-005', { liveName: 'anything' })).toEqual({ code: 'CC-110', status: 'mapped' }); // value already mapped, liveName unused
  });

  it('still reports unresolved when liveName also fails to resolve', () => {
    expect(resolveLegacyCostCenter('CC-008', { liveName: 'Contratistas' })).toEqual({ code: '', status: 'unresolved' });
  });

  it('treats a liveName of "Sin asignar" as empty too', () => {
    expect(resolveLegacyCostCenter('CC-009', { liveName: 'Sin asignar' })).toEqual({ code: '', status: 'empty' });
  });
});

describe('defaultCostCenterForCategory', () => {
  it('defaults every vehicle category to CC-200', () => {
    ['Combustible', 'Cuotas y alquiler de vehículos', 'Mantenimiento, seguro e impuesto de vehículos'].forEach((name) => {
      expect(defaultCostCenterForCategory(name)).toBe('CC-200');
    });
  });

  it('defaults equipment to CC-210 and lodging to CC-220', () => {
    expect(defaultCostCenterForCategory('Equipos y herramienta')).toBe('CC-210');
    expect(defaultCostCenterForCategory('Alojamiento trabajadores')).toBe('CC-220');
  });

  it('defaults the four administration categories to CC-300', () => {
    ['Asesoría y gestoría', 'Seguros de empresa', 'Tarjeta corporativa', 'Otros administrativos'].forEach((name) => {
      expect(defaultCostCenterForCategory(name)).toBe('CC-300');
    });
  });

  it('defaults office to CC-330 and other-personnel to CC-320', () => {
    expect(defaultCostCenterForCategory('Oficina, telefonía y software')).toBe('CC-330');
    expect(defaultCostCenterForCategory('Otros de personal')).toBe('CC-320');
  });

  it('defaults payroll categories to CC-NOM', () => {
    ['Salarios', 'Seguridad social', 'Impuesto de nómina'].forEach((name) => {
      expect(defaultCostCenterForCategory(name)).toBe('CC-NOM');
    });
  });

  it('defaults fiscal/financial categories to CC-900', () => {
    ['IVA', 'Impuesto sobre beneficios', 'Intereses y comisiones bancarias', 'Amortización de préstamos', 'Intereses de préstamos de socios'].forEach(
      (name) => {
        expect(defaultCostCenterForCategory(name)).toBe('CC-900');
      },
    );
  });

  it('gives no default for categories that always require a project', () => {
    ['Materiales', 'Reparaciones', 'Daños a terceros', 'Subcontratas'].forEach((name) => {
      expect(defaultCostCenterForCategory(name)).toBe('');
    });
  });

  it('returns "" for an unknown or legacy category name', () => {
    expect(defaultCostCenterForCategory('Seguros')).toBe('');
    expect(defaultCostCenterForCategory('')).toBe('');
    expect(defaultCostCenterForCategory(undefined)).toBe('');
  });
});

describe('defaultCostCenterForLine', () => {
  it('maps every line to its direct center', () => {
    expect(defaultCostCenterForLine('TB')).toBe('CC-100');
    expect(defaultCostCenterForLine('BL')).toBe('CC-110');
    expect(defaultCostCenterForLine('N4')).toBe('CC-120');
    expect(defaultCostCenterForLine('MD')).toBe('CC-130');
    expect(defaultCostCenterForLine('SV')).toBe('CC-190');
  });

  it('maps OH to the administration center', () => {
    expect(defaultCostCenterForLine('OH')).toBe('CC-300');
  });

  it('tolerates lowercase and whitespace', () => {
    expect(defaultCostCenterForLine(' bl ')).toBe('CC-110');
  });

  it('returns "" for an unknown line', () => {
    expect(defaultCostCenterForLine('XX')).toBe('');
    expect(defaultCostCenterForLine('')).toBe('');
  });
});

describe('costCenterOptions', () => {
  it('returns one row per catalogue entry, in catalogue order', () => {
    const options = costCenterOptions();
    expect(options).toHaveLength(14);
    expect(options[0]).toEqual({ value: 'CC-100', label: 'CC-100 · Obra civil (Tiefbau)', kind: 'direct' });
    expect(options.at(-1)).toEqual({ value: 'CC-NOM', label: 'CC-NOM · Nómina y seguridad social', kind: 'clearing' });
  });

  it('returns a fresh array every call', () => {
    const first = costCenterOptions();
    first.push({ value: 'mutated' });
    expect(costCenterOptions()).toHaveLength(14);
  });
});

describe('validateCostCenterAssignment', () => {
  it('requires a project for a direct center', () => {
    expect(validateCostCenterAssignment({ costCenterId: 'CC-100', projectId: '' })).toEqual({
      valid: false,
      error: 'Un centro de costo de obra requiere un proyecto',
    });
  });

  it('accepts a direct center with a project', () => {
    expect(validateCostCenterAssignment({ costCenterId: 'CC-100', projectId: 'proj-1' })).toEqual({
      valid: true,
      error: null,
    });
  });

  it('forbids a project on an indirect or clearing center', () => {
    expect(validateCostCenterAssignment({ costCenterId: 'CC-300', projectId: 'proj-1' })).toEqual({
      valid: false,
      error: 'Un gasto con proyecto debe ir a un centro de costo de obra',
    });
    expect(validateCostCenterAssignment({ costCenterId: 'CC-NOM', projectId: 'proj-1' })).toEqual({
      valid: false,
      error: 'Un gasto con proyecto debe ir a un centro de costo de obra',
    });
  });

  it('accepts an indirect center with no project', () => {
    expect(validateCostCenterAssignment({ costCenterId: 'CC-300', projectId: '' })).toEqual({ valid: true, error: null });
  });

  it('treats an empty or unresolved center as valid: requiredness is the caller\'s call', () => {
    expect(validateCostCenterAssignment({ costCenterId: '', projectId: '' })).toEqual({ valid: true, error: null });
    expect(validateCostCenterAssignment({ costCenterId: 'CC-007', projectId: 'proj-1' })).toEqual({ valid: true, error: null });
  });
});

/**
 * A stored `costCenterId` is not one kind of value: production holds v2 codes,
 * v1 codes, free-text labels and Firestore doc ids of live cost-center docs,
 * side by side. `planCostCenterMigration` already had to reconcile all four;
 * this is the same resolution, shared, so a screen FILTERING by cost center
 * groups a document exactly where the migration would send it.
 */
describe('resolveStoredCostCenter', () => {
  const live = [
    { id: 'legacyDoc1', code: 'CC-002', name: 'Instalaciones y Reparaciones' },
    { id: 'legacyDoc2', code: 'CC-007', name: 'NE4' },
    { id: 'legacyDoc3', code: 'OPE', name: 'OPE' },
  ];

  it('resolves a v2 code, a v1 code and a label without needing the live docs', () => {
    expect(resolveStoredCostCenter('CC-120', live)).toEqual({ code: 'CC-120', status: 'current' });
    expect(resolveStoredCostCenter('CC-002', live)).toEqual({ code: 'CC-120', status: 'mapped' });
    expect(resolveStoredCostCenter('Instalaciones y Reparaciones', live)).toEqual({ code: 'CC-120', status: 'mapped' });
  });

  it('falls back to the live doc OWN code/name for a value that is a doc id', () => {
    expect(resolveStoredCostCenter('legacyDoc1', live)).toEqual({ code: 'CC-120', status: 'mapped' });
    // CC-007 has no recorded meaning; the doc NAME is what resolves it.
    expect(resolveStoredCostCenter('legacyDoc2', live)).toEqual({ code: 'CC-120', status: 'mapped' });
  });

  it('stays unresolved rather than guessing, with or without a live doc', () => {
    expect(resolveStoredCostCenter('legacyDoc3', live)).toEqual({ code: '', status: 'unresolved' });
    expect(resolveStoredCostCenter('Contratistas', live)).toEqual({ code: '', status: 'unresolved' });
    expect(resolveStoredCostCenter('desconocido', [])).toEqual({ code: '', status: 'unresolved' });
  });

  it('treats blanks and "Sin asignar" as empty, and tolerates a missing list', () => {
    expect(resolveStoredCostCenter('', live)).toEqual({ code: '', status: 'empty' });
    expect(resolveStoredCostCenter('Sin asignar', live)).toEqual({ code: '', status: 'empty' });
    expect(resolveStoredCostCenter('CC-120')).toEqual({ code: 'CC-120', status: 'current' });
  });
});

describe('costCenterFilterKey / matchesCostCenterFilter', () => {
  const live = [
    { id: 'legacyDoc1', code: 'CC-002', name: 'Instalaciones y Reparaciones' },
    { id: 'legacyDoc3', code: 'OPE', name: 'OPE' },
  ];

  it('sends the v2 code, its v1 code and its label to the SAME bucket', () => {
    ['CC-120', 'CC-002', 'CC-003', 'Instalaciones y Reparaciones', 'NE4', 'legacyDoc1'].forEach((stored) => {
      expect(costCenterFilterKey(stored, live)).toBe('CC-120');
    });
  });

  it('gives an unresolved value its own bucket instead of a guessed center', () => {
    expect(costCenterFilterKey('OPE', live)).toBe('OPE');
    expect(costCenterFilterKey('legacyDoc3', live)).toBe('OPE'); // the doc id reaches its own doc code
    expect(costCenterFilterKey('Contratistas', live)).toBe('CONTRATISTAS');
  });

  it('gives a blank or unassigned value no bucket at all', () => {
    expect(costCenterFilterKey('', live)).toBe('');
    expect(costCenterFilterKey('Sin asignar', live)).toBe('');
  });

  it('matches every document when nothing is selected — the "all centers" view', () => {
    expect(matchesCostCenterFilter('CC-002', '', live)).toBe(true);
    expect(matchesCostCenterFilter('', '', live)).toBe(true);
    expect(matchesCostCenterFilter('OPE', '', live)).toBe(true);
  });

  it('matches a selected code through every spelling of it, and nothing else', () => {
    expect(matchesCostCenterFilter('CC-002', 'CC-120', live)).toBe(true);
    expect(matchesCostCenterFilter('Instalaciones y Reparaciones', 'CC-120', live)).toBe(true);
    expect(matchesCostCenterFilter('legacyDoc1', 'CC-120', live)).toBe(true);
    expect(matchesCostCenterFilter('CC-300', 'CC-120', live)).toBe(false);
    expect(matchesCostCenterFilter('', 'CC-120', live)).toBe(false);
    expect(matchesCostCenterFilter('OPE', 'CC-120', live)).toBe(false);
  });

  it('keeps an unresolved bucket filterable on its own', () => {
    expect(matchesCostCenterFilter('OPE', 'OPE', live)).toBe(true);
    expect(matchesCostCenterFilter('legacyDoc3', 'OPE', live)).toBe(true);
    expect(matchesCostCenterFilter('CC-120', 'OPE', live)).toBe(false);
  });
});

describe('costCenterFilterOptions', () => {
  it('offers the whole v2 catalogue, in catalogue order', () => {
    const options = costCenterFilterOptions([]);

    expect(options.slice(0, COST_CENTER_CATALOG.length).map((option) => option.value)).toEqual(
      COST_CENTER_CATALOG.map((entry) => entry.code),
    );
  });

  it('adds a bucket for a live doc that resolves to no v2 code, so nothing visible disappears', () => {
    const options = costCenterFilterOptions([{ id: 'legacyDoc3', code: 'OPE', name: 'OPE' }]);

    expect(options.at(-1)).toEqual({ value: 'OPE', label: 'OPE · OPE', kind: 'unresolved' });
  });

  it('adds nothing for a live doc that already resolves into the catalogue', () => {
    const options = costCenterFilterOptions([
      { id: 'CC-120', code: 'CC-120', name: 'NE4 instalación en vivienda' },
      { id: 'legacyDoc1', code: 'CC-002', name: 'Instalaciones y Reparaciones' },
      { id: 'legacyDoc2', code: 'CC-007', name: 'NE4' },
    ]);

    expect(options).toHaveLength(COST_CENTER_CATALOG.length);
  });

  it('never offers an unassigned doc as a bucket — its documents read as having no center', () => {
    const options = costCenterFilterOptions([{ id: 'none', code: '', name: 'Sin asignar' }]);

    expect(options).toHaveLength(COST_CENTER_CATALOG.length);
  });

  it('offers a duplicated legacy doc once and tolerates a missing list', () => {
    const options = costCenterFilterOptions([
      { id: 'd1', code: 'OPE', name: 'OPE' },
      { id: 'd2', code: 'ope', name: 'OPE' },
    ]);

    expect(options.filter((option) => option.value === 'OPE')).toHaveLength(1);
    expect(costCenterFilterOptions()).toHaveLength(COST_CENTER_CATALOG.length);
  });
});
