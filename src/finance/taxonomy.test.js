/**
 * Category taxonomy v2 — the grouped catalogue that replaced the flat,
 * duplicated lists (approved 2026-09-02).
 *
 * What this file guards:
 *   - the catalogue itself (29 categories, 9 groups, unique ids and names)
 *   - every legacy name resolves to a v2 name
 *   - the split renames (Seguros / Impuestos / Administrativo / Intereses
 *     Bancos) decide from the real counterparties and descriptions the 2026
 *     ledger contains
 *   - refunds and reversals land in the bucket of the payment they undo
 *   - resolving a v2 name is a no-op, so the migration is idempotent
 */
import { describe, expect, it } from 'vitest';

import {
  CATEGORY_GROUPS,
  EXPENSE_CATEGORY_NAMES,
  INCOME_CATEGORY_NAMES,
  INTERNAL_CATEGORY_NAMES,
  LEGACY_CATEGORY_MAP,
  TAXONOMY,
  TAXONOMY_VERSION,
  categoryByName,
  categoryOptions,
  groupOfCategory,
  resolveLegacyCategory,
} from './taxonomy.js';

const GROUP_ORDER = [
  'ingresos',
  'personal',
  'subcontratas',
  'obra',
  'vehiculos',
  'estructura',
  'impuestos',
  'financiero',
  'interno',
];

/** The exact catalogue Jarl approved, in report order. */
const APPROVED = [
  ['facturacion-obra', 'Facturación obra', 'ingresos', 'income', ''],
  ['servicios-particulares', 'Servicios particulares', 'ingresos', 'income', ''],
  ['devoluciones-financieros', 'Devoluciones e ingresos financieros', 'ingresos', 'income', ''],
  ['otros-ingresos', 'Otros ingresos', 'ingresos', 'income', ''],
  ['salarios', 'Salarios', 'personal', 'expense', 'overhead'],
  ['seguridad-social', 'Seguridad social', 'personal', 'expense', 'overhead'],
  ['impuesto-nomina', 'Impuesto de nómina', 'personal', 'expense', 'overhead'],
  ['alojamiento', 'Alojamiento trabajadores', 'personal', 'expense', 'project'],
  ['otros-personal', 'Otros de personal', 'personal', 'expense', 'overhead'],
  ['subcontratas', 'Subcontratas', 'subcontratas', 'expense', 'project'],
  ['materiales', 'Materiales', 'obra', 'expense', 'project'],
  ['equipos', 'Equipos y herramienta', 'obra', 'expense', 'project'],
  ['reparaciones', 'Reparaciones', 'obra', 'expense', 'project'],
  ['danos-terceros', 'Daños a terceros', 'obra', 'expense', 'project'],
  ['combustible', 'Combustible', 'vehiculos', 'expense', 'overhead'],
  ['cuotas-alquiler-vehiculos', 'Cuotas y alquiler de vehículos', 'vehiculos', 'expense', 'overhead'],
  ['mantenimiento-vehiculos', 'Mantenimiento, seguro e impuesto de vehículos', 'vehiculos', 'expense', 'overhead'],
  ['asesoria', 'Asesoría y gestoría', 'estructura', 'expense', 'overhead'],
  ['oficina', 'Oficina, telefonía y software', 'estructura', 'expense', 'overhead'],
  ['seguros-empresa', 'Seguros de empresa', 'estructura', 'expense', 'overhead'],
  ['tarjeta-corporativa', 'Tarjeta corporativa', 'estructura', 'expense', 'overhead'],
  ['otros-administrativos', 'Otros administrativos', 'estructura', 'expense', 'overhead'],
  ['iva', 'IVA', 'impuestos', 'expense', 'overhead'],
  ['impuesto-beneficios', 'Impuesto sobre beneficios', 'impuestos', 'expense', 'overhead'],
  ['intereses-comisiones', 'Intereses y comisiones bancarias', 'financiero', 'expense', 'overhead'],
  ['amortizacion-prestamos', 'Amortización de préstamos', 'financiero', 'expense', 'overhead'],
  ['intereses-socios', 'Intereses de préstamos de socios', 'financiero', 'expense', 'overhead'],
  ['aportes-socios', 'Aportes y préstamos de socios recibidos', 'financiero', 'income', ''],
  ['transferencia-interna', 'Transferencia interna', 'interno', 'internal', ''],
];

/** §2a — every legacy name the 2025/2026 data can carry, and where it goes. */
const SIMPLE_RENAMES = [
  ['Subcontratos', 'Subcontratas'],
  ['Factura CXP', 'Subcontratas'],
  ['Salarios', 'Salarios'],
  ['Vivienda', 'Alojamiento trabajadores'],
  ['Combustible', 'Combustible'],
  ['Transporte/Combustible', 'Combustible'],
  ['Cuotas vehiculos', 'Cuotas y alquiler de vehículos'],
  ['Alquiler vehiculo', 'Cuotas y alquiler de vehículos'],
  ['Vehiculos', 'Cuotas y alquiler de vehículos'],
  ['Impuestos Vehiculos', 'Mantenimiento, seguro e impuesto de vehículos'],
  ['Inpuestos Vehiculos', 'Mantenimiento, seguro e impuesto de vehículos'],
  ['Equipos', 'Equipos y herramienta'],
  ['Equipos Alquileres', 'Equipos y herramienta'],
  ['Materiales', 'Materiales'],
  ['Reparaciones', 'Reparaciones'],
  ['Facturas Telefonos', 'Oficina, telefonía y software'],
  ['Miscelaneos Oficina', 'Oficina, telefonía y software'],
  ['Intereses prestamos', 'Intereses de préstamos de socios'],
  ['Servicios', 'Facturación obra'],
  ['Ingresos Servicios', 'Facturación obra'],
  ['SP', 'Servicios particulares'],
  ['Factura CXC', 'Servicios particulares'],
  ['Por Venta', 'Otros ingresos'],
  ['Consultoria', 'Otros ingresos'],
  ['Consultoría', 'Otros ingresos'],
  ['Financiero', 'Devoluciones e ingresos financieros'],
];

const out = (overrides) => ({ direction: 'out', ...overrides });
const inbound = (overrides) => ({ direction: 'in', ...overrides });

describe('TAXONOMY catalogue', () => {
  it('is version 2', () => {
    expect(TAXONOMY_VERSION).toBe(2);
  });

  it('ships the 9 groups in report order', () => {
    expect(CATEGORY_GROUPS.map((group) => group.id)).toEqual(GROUP_ORDER);
    CATEGORY_GROUPS.forEach((group) => expect(group.label).toBeTruthy());
    expect(CATEGORY_GROUPS.find((group) => group.id === 'vehiculos').label).toBe('Vehículos');
  });

  it('ships exactly the approved 29 categories, in order, with the approved fields', () => {
    expect(TAXONOMY.map((c) => [c.id, c.name, c.group, c.type, c.defaultScope])).toEqual(APPROVED);
  });

  it('has unique ids and unique names', () => {
    const ids = TAXONOMY.map((c) => c.id);
    const names = TAXONOMY.map((c) => c.name);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(names).size).toBe(names.length);
  });

  it('only uses declared groups and types', () => {
    TAXONOMY.forEach((category) => {
      expect(GROUP_ORDER).toContain(category.group);
      expect(['income', 'expense', 'internal']).toContain(category.type);
      expect(['', 'overhead', 'project']).toContain(category.defaultScope);
    });
  });

  it('splits the name lists by type without overlap', () => {
    expect(EXPENSE_CATEGORY_NAMES).toEqual(TAXONOMY.filter((c) => c.type === 'expense').map((c) => c.name));
    expect(INCOME_CATEGORY_NAMES).toEqual(TAXONOMY.filter((c) => c.type === 'income').map((c) => c.name));
    expect(INTERNAL_CATEGORY_NAMES).toEqual(['Transferencia interna']);
    expect(EXPENSE_CATEGORY_NAMES.length + INCOME_CATEGORY_NAMES.length + INTERNAL_CATEGORY_NAMES.length).toBe(29);
    expect(EXPENSE_CATEGORY_NAMES.filter((name) => INCOME_CATEGORY_NAMES.includes(name))).toEqual([]);
  });

  it('is frozen so no screen can mutate the catalogue at runtime', () => {
    expect(Object.isFrozen(TAXONOMY)).toBe(true);
    expect(Object.isFrozen(TAXONOMY[0])).toBe(true);
    expect(Object.isFrozen(CATEGORY_GROUPS)).toBe(true);
  });
});

describe('categoryByName', () => {
  it('finds a v2 category by its exact name', () => {
    expect(categoryByName('IVA')).toMatchObject({ id: 'iva', group: 'impuestos' });
    expect(categoryByName('Daños a terceros')).toMatchObject({ id: 'danos-terceros' });
  });

  it('tolerates whitespace, case and missing accents', () => {
    expect(categoryByName('  salarios ')).toMatchObject({ id: 'salarios' });
    expect(categoryByName('Impuesto de nomina')).toMatchObject({ id: 'impuesto-nomina' });
  });

  it('returns null for legacy and unknown names', () => {
    expect(categoryByName('Subcontratos')).toBeNull();
    expect(categoryByName('Seguros')).toBeNull();
    expect(categoryByName('')).toBeNull();
    expect(categoryByName(null)).toBeNull();
  });
});

describe('categoryOptions', () => {
  it('returns one option per category, in taxonomy order, with its group label', () => {
    const options = categoryOptions();
    expect(options).toHaveLength(29);
    expect(options[0]).toEqual({
      name: 'Facturación obra',
      type: 'income',
      group: 'ingresos',
      groupLabel: 'Ingresos',
    });
    expect(options.at(-1)).toEqual({
      name: 'Transferencia interna',
      type: 'internal',
      group: 'interno',
      groupLabel: 'Interno',
    });
  });

  it('returns a fresh array every call', () => {
    const first = categoryOptions();
    first.push({ name: 'mutated' });
    expect(categoryOptions()).toHaveLength(29);
  });
});

describe('LEGACY_CATEGORY_MAP', () => {
  it('maps every §2a legacy name that is not already a v2 name', () => {
    SIMPLE_RENAMES.forEach(([legacy, next]) => {
      if (categoryByName(legacy)) return; // unchanged names are not legacy
      expect(LEGACY_CATEGORY_MAP[legacy], legacy).toBe(next);
    });
  });

  it('gives the split categories their "otherwise" target', () => {
    expect(LEGACY_CATEGORY_MAP.Seguros).toBe('Seguridad social');
    expect(LEGACY_CATEGORY_MAP.Impuestos).toBe('IVA');
    expect(LEGACY_CATEGORY_MAP.Administrativo).toBe('Otros administrativos');
    expect(LEGACY_CATEGORY_MAP['Intereses Bancos']).toBe('Intereses y comisiones bancarias');
  });

  it('only ever points at v2 names', () => {
    Object.values(LEGACY_CATEGORY_MAP).forEach((name) => {
      expect(categoryByName(name), name).not.toBeNull();
    });
  });

  it('does not carry "Otros": that one is resolved by direction or type', () => {
    expect(LEGACY_CATEGORY_MAP).not.toHaveProperty('Otros');
  });
});

describe('resolveLegacyCategory — simple renames (§2a)', () => {
  it.each(SIMPLE_RENAMES)('%s → %s', (legacy, next) => {
    expect(resolveLegacyCategory({ categoryName: legacy })).toBe(next);
  });

  it('resolves "Otros" by movement direction', () => {
    expect(resolveLegacyCategory({ categoryName: 'Otros', direction: 'in' })).toBe('Otros ingresos');
    expect(resolveLegacyCategory({ categoryName: 'Otros', direction: 'out' })).toBe('Otros administrativos');
  });

  it('resolves "Otros" by document type when there is no direction', () => {
    expect(resolveLegacyCategory({ categoryName: 'Otros', type: 'income' })).toBe('Otros ingresos');
    expect(resolveLegacyCategory({ categoryName: 'Otros', type: 'expense' })).toBe('Otros administrativos');
  });

  it('refuses to guess "Otros" with neither direction nor type', () => {
    expect(resolveLegacyCategory({ categoryName: 'Otros' })).toBeNull();
  });

  it('is idempotent: a v2 name comes back unchanged', () => {
    TAXONOMY.forEach((category) => {
      expect(resolveLegacyCategory({ categoryName: category.name, direction: 'out' })).toBe(category.name);
      expect(resolveLegacyCategory({ categoryName: category.name, direction: 'in' })).toBe(category.name);
    });
  });

  it('keeps a v2 name even when the movement text would trigger a split rule', () => {
    expect(
      resolveLegacyCategory(
        out({ categoryName: 'Otros administrativos', counterpartyName: 'Kinder und Partner', description: 'Honorar' }),
      ),
    ).toBe('Otros administrativos');
  });

  it('returns null for unknown or empty names', () => {
    expect(resolveLegacyCategory({ categoryName: 'Comida de perro' })).toBeNull();
    expect(resolveLegacyCategory({ categoryName: '' })).toBeNull();
    expect(resolveLegacyCategory({})).toBeNull();
    expect(resolveLegacyCategory()).toBeNull();
  });

  it('tolerates spacing, case and accents on the legacy name', () => {
    expect(resolveLegacyCategory({ categoryName: ' subcontratos ' })).toBe('Subcontratas');
    expect(resolveLegacyCategory({ categoryName: 'CONSULTORÍA' })).toBe('Otros ingresos');
  });
});

describe('resolveLegacyCategory — Seguros split (§2b)', () => {
  it('sends company insurers to Seguros de empresa', () => {
    ['NÜRNBERGER Allgemeine Versicherungs-AG', 'Nuernberger Versicherung', 'Gothaer Allgemeine', 'Telefonica Insurance S.A.'].forEach(
      (counterpartyName) => {
        expect(resolveLegacyCategory(out({ categoryName: 'Seguros', counterpartyName }))).toBe('Seguros de empresa');
      },
    );
  });

  it('sends every Krankenkasse and the BG to Seguridad social', () => {
    ['AOK Rheinland/Hamburg', 'BARMER', 'Techniker Krankenkasse', 'TUI BKK', 'BG ETEM', 'IKK classic', 'DAK-Gesundheit'].forEach(
      (counterpartyName) => {
        expect(resolveLegacyCategory(out({ categoryName: 'Seguros', counterpartyName }))).toBe('Seguridad social');
      },
    );
  });

  it('defaults to Seguridad social when the counterparty is unknown', () => {
    expect(resolveLegacyCategory(out({ categoryName: 'Seguros' }))).toBe('Seguridad social');
  });
});

describe('resolveLegacyCategory — Impuestos split (§2b)', () => {
  it('routes Lohnsteuer to Impuesto de nómina', () => {
    expect(
      resolveLegacyCategory(
        out({ categoryName: 'Impuestos', counterpartyName: 'FINANZKASSE STRALSUND', description: 'STEUERNR 082/121/02610 LOHNST DEZ.25' }),
      ),
    ).toBe('Impuesto de nómina');
    expect(
      resolveLegacyCategory(out({ categoryName: 'Impuestos', counterpartyName: 'Finanzamt Stralsund', description: 'Lohnsteuer 01/26' })),
    ).toBe('Impuesto de nómina');
  });

  it('routes the Hauptzollamt to Seguridad social (it enforces Krankenkasse arrears)', () => {
    expect(
      resolveLegacyCategory(
        out({ categoryName: 'Impuestos', counterpartyName: 'Hauptzollamt Stralsund', description: 'Ueberzahlung Beitraege Bitte an BARMER zahlen' }),
      ),
    ).toBe('Seguridad social');
  });

  it('keeps a Finanzamt VOA settlement in IVA — the company pays no profit tax today', () => {
    expect(
      resolveLegacyCategory(
        out({
          categoryName: 'Impuestos',
          counterpartyName: 'Finanzamt Stralsund',
          description: 'Restzahlung 4082/121/02610 - EH 06a VOA 05.06.2026',
        }),
      ),
    ).toBe('IVA');
  });

  it('routes trade and corporate tax to Impuesto sobre beneficios', () => {
    ['GEWST 2025 Vorauszahlung', 'Gewerbesteuer 2024', 'KÖRPERSCH.ST 2025', 'KOERPERSCHAFTSTEUER', 'KST 2025'].forEach(
      (description) => {
        expect(
          resolveLegacyCategory(out({ categoryName: 'Impuestos', counterpartyName: 'Finanzamt Stralsund', description })),
        ).toBe('Impuesto sobre beneficios');
      },
    );
  });

  it('routes vehicle tax to the vehicle bucket', () => {
    expect(
      resolveLegacyCategory(out({ categoryName: 'Impuestos', counterpartyName: 'Bundeskasse Trier', description: 'Kfz-Steuer HST-UM 123' })),
    ).toBe('Mantenimiento, seguro e impuesto de vehículos');
  });

  it('routes everything else to IVA', () => {
    ['UMS.ST NOV.25', 'Umsatzsteuer Voranmeldung', 'Teilzahlung 8291210261040', 'Restzahlung 8291210261040 Zeitraum 0126'].forEach(
      (description) => {
        expect(
          resolveLegacyCategory(out({ categoryName: 'Impuestos', counterpartyName: 'FINANZKASSE STRALSUND', description })),
        ).toBe('IVA');
      },
    );
    expect(resolveLegacyCategory(out({ categoryName: 'Impuestos' }))).toBe('IVA');
  });

  it('checks Lohnsteuer before the Hauptzollamt so a Zoll-collected wage tax stays payroll tax', () => {
    expect(
      resolveLegacyCategory(out({ categoryName: 'Impuestos', counterpartyName: 'Hauptzollamt Stralsund', description: 'LOHNST 03/26' })),
    ).toBe('Impuesto de nómina');
  });
});

describe('resolveLegacyCategory — Administrativo split (§2b)', () => {
  it('routes the tax advisor and DATEV to Asesoría y gestoría', () => {
    ['Kinder und Partner Steuerberater', 'Schomerus & Partner', 'Steuerberatung Müller', 'DATEV eG'].forEach((counterpartyName) => {
      expect(resolveLegacyCategory(out({ categoryName: 'Administrativo', counterpartyName }))).toBe('Asesoría y gestoría');
    });
  });

  it('routes the company card settlement to Tarjeta corporativa', () => {
    ['Kreditkartenkto 123', 'Firmenkarte Abrechnung'].forEach((counterpartyName) => {
      expect(resolveLegacyCategory(out({ categoryName: 'Administrativo', counterpartyName }))).toBe('Tarjeta corporativa');
    });
  });

  it('routes workwear and safety gear to Otros de personal', () => {
    ['Arbeitsschutzhelden GmbH', 'Engelbert Strauss GmbH & Co. KG'].forEach((counterpartyName) => {
      expect(resolveLegacyCategory(out({ categoryName: 'Administrativo', counterpartyName }))).toBe('Otros de personal');
    });
  });

  it('routes an Adyen charge to Materiales only when the description names OBI', () => {
    expect(
      resolveLegacyCategory(out({ categoryName: 'Administrativo', counterpartyName: 'ADYEN N.V.', description: 'OBI Stralsund 1234' })),
    ).toBe('Materiales');
    expect(
      resolveLegacyCategory(out({ categoryName: 'Administrativo', counterpartyName: 'ADYEN N.V.', description: 'Kartenzahlung' })),
    ).toBe('Otros administrativos');
  });

  it('defaults to Otros administrativos', () => {
    expect(resolveLegacyCategory(out({ categoryName: 'Administrativo', counterpartyName: 'IHK zu Rostock' }))).toBe(
      'Otros administrativos',
    );
  });
});

describe('resolveLegacyCategory — Intereses Bancos split (§2b)', () => {
  it('routes partner loan interest to Intereses de préstamos de socios', () => {
    expect(
      resolveLegacyCategory(out({ categoryName: 'Intereses Bancos', counterpartyName: 'Jeisson Romero Lesmes', description: 'Zinsen Darlehn' })),
    ).toBe('Intereses de préstamos de socios');
    expect(
      resolveLegacyCategory(out({ categoryName: 'Intereses Bancos', counterpartyName: 'Beatriz Lesmes Sandoval', description: 'Rueckzahlung' })),
    ).toBe('Intereses de préstamos de socios');
  });

  it('routes the VISA settlement to Tarjeta corporativa', () => {
    expect(
      resolveLegacyCategory(out({ categoryName: 'Intereses Bancos', counterpartyName: 'Volksbank Vorpommern eG', description: 'VISA Abrechnung 01.26' })),
    ).toBe('Tarjeta corporativa');
    expect(
      resolveLegacyCategory(out({ categoryName: 'Intereses Bancos', description: 'KKV 1234 VISA' })),
    ).toBe('Tarjeta corporativa');
    expect(
      resolveLegacyCategory(out({ categoryName: 'Intereses Bancos', description: 'Kreditkarte Jahresgebuehr' })),
    ).toBe('Tarjeta corporativa');
  });

  it('routes plain bank charges to Intereses y comisiones bancarias', () => {
    expect(
      resolveLegacyCategory(out({ categoryName: 'Intereses Bancos', counterpartyName: 'Volksbank Vorpommern eG', description: 'ABSCHLUSS PER 31.03.2026' })),
    ).toBe('Intereses y comisiones bancarias');
    expect(resolveLegacyCategory(out({ categoryName: 'Intereses Bancos' }))).toBe('Intereses y comisiones bancarias');
  });
});

describe('resolveLegacyCategory — refunds and reversals (§2c)', () => {
  it('puts a bounced Finanzkasse debit back in the bucket the debit had', () => {
    const bounced = 'RETURN/REFUND, Retoure SEPA Lastschrift vom 10.02.2026, Lastschriftwiderspruch UMS.ST DEZ.25';
    expect(
      resolveLegacyCategory(inbound({ categoryName: 'Impuestos', counterpartyName: 'FINANZKASSE STRALSUND', description: bounced })),
    ).toBe('IVA');
    expect(
      resolveLegacyCategory(
        inbound({ categoryName: 'Financiero', counterpartyName: 'FINANZKASSE STRALSUND', description: `${bounced} LOHNST JAN.26` }),
      ),
    ).toBe('Impuesto de nómina');
  });

  it('puts a bounced Krankenkasse debit back into Seguridad social', () => {
    expect(
      resolveLegacyCategory(
        inbound({ categoryName: 'Otros', counterpartyName: 'BARMER', description: 'RETURN/REFUND, Retoure SEPA Lastschrift, Lastschriftwiderspruch' }),
      ),
    ).toBe('Seguridad social');
  });

  it('treats a tax office refund as financial income', () => {
    expect(
      resolveLegacyCategory(inbound({ categoryName: 'Impuestos', counterpartyName: 'Finanzamt Stralsund', description: 'ERSTATT UST 2025' })),
    ).toBe('Devoluciones e ingresos financieros');
    expect(
      resolveLegacyCategory(inbound({ categoryName: 'Otros', counterpartyName: 'Amt Recknitz-Trebeltal', description: 'Guthabenerstattung Gewst 2024' })),
    ).toBe('Devoluciones e ingresos financieros');
    expect(
      resolveLegacyCategory(inbound({ categoryName: 'Financiero', counterpartyName: 'Hauptzollamt Stralsund', description: 'Erstattung Ueberzahlung' })),
    ).toBe('Devoluciones e ingresos financieros');
  });

  it('keeps an AAG reimbursement and a contribution reversal in Seguridad social', () => {
    expect(
      resolveLegacyCategory(inbound({ categoryName: 'Seguros', counterpartyName: 'Techniker Krankenkasse', description: 'Erstattung nach AAG 02/2026' })),
    ).toBe('Seguridad social');
    expect(
      resolveLegacyCategory(inbound({ categoryName: 'Seguros', counterpartyName: 'TUI BKK', description: 'STORNIERUNG BEITRAGSFESTSETZUNG' })),
    ).toBe('Seguridad social');
  });

  it('treats any other Krankenkasse refund as financial income', () => {
    expect(
      resolveLegacyCategory(inbound({ categoryName: 'Seguros', counterpartyName: 'AOK Rheinland/Hamburg', description: 'Erstattung Beitrag' })),
    ).toBe('Devoluciones e ingresos financieros');
  });

  it('never applies refund rules to an outflow', () => {
    expect(
      resolveLegacyCategory(out({ categoryName: 'Impuestos', counterpartyName: 'Finanzamt Stralsund', description: 'ERSTATT Korrektur' })),
    ).toBe('IVA');
  });
});

describe('groupOfCategory', () => {
  it('returns the group of a v2 category', () => {
    expect(groupOfCategory('Salarios')).toBe('personal');
    expect(groupOfCategory('Intereses y comisiones bancarias')).toBe('financiero');
    expect(groupOfCategory('Aportes y préstamos de socios recibidos')).toBe('financiero');
    expect(groupOfCategory('Devoluciones e ingresos financieros')).toBe('ingresos');
    expect(groupOfCategory('Transferencia interna')).toBe('interno');
  });

  it('rolls legacy names up through the legacy map so 2025 data keeps reporting', () => {
    expect(groupOfCategory('Subcontratos')).toBe('subcontratas');
    expect(groupOfCategory('Vivienda')).toBe('personal');
    expect(groupOfCategory('Intereses Bancos')).toBe('financiero');
    expect(groupOfCategory('Intereses prestamos')).toBe('financiero');
    expect(groupOfCategory('Seguros')).toBe('personal');
    expect(groupOfCategory('Impuestos')).toBe('impuestos');
    expect(groupOfCategory('Servicios')).toBe('ingresos');
    expect(groupOfCategory('Financiero')).toBe('ingresos');
  });

  it('resolves "Otros" only with a direction or type', () => {
    expect(groupOfCategory('Otros')).toBeNull();
    expect(groupOfCategory('Otros', { direction: 'in' })).toBe('ingresos');
    expect(groupOfCategory('Otros', { type: 'expense' })).toBe('estructura');
  });

  it('returns null for unknown names', () => {
    expect(groupOfCategory('Comida de perro')).toBeNull();
    expect(groupOfCategory('')).toBeNull();
    expect(groupOfCategory(undefined)).toBeNull();
  });
});
