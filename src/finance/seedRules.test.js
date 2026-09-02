import { describe, expect, it } from 'vitest';

import { RULE_DIRECTIONS, RULE_FIELDS, RULE_MATCH_TYPES } from './assetSchemas.js';
import { COST_SCOPE, validateClassification } from './costScope.js';
import { buildClassificationPayload, findBestRule } from './ruleEngine.js';
import { ruleSeedKey } from './ruleAuthoring.js';
import {
  SEED_CLASSIFICATION_RULES,
  SEED_DESCRIPTION_RULE_PRIORITY,
  SEED_RULE_PRIORITY,
  seedRuleToDoc,
} from './seedRules.js';
import { TAXONOMY, categoryByName } from './taxonomy.js';

/**
 * The 14 original seeds. Their `name` is the key the migration script and the
 * operator recognise them by, so it never changes — only the target does.
 */
const LEGACY_SEEDS = [
  ['Finanzkasse Stralsund — Impuestos', 'IVA'],
  ['Finanzamt Stralsund — Impuestos', 'IVA'],
  ['AOK Rheinland/Hamburg — Seguridad social', 'Seguridad social'],
  ['BARMER — Seguridad social', 'Seguridad social'],
  ['Hauptzollamt Stralsund — Impuestos', 'Seguridad social'],
  ['Union Tank Eckstein — Combustible', 'Combustible'],
  ['RCI Banque — Leasing vehículos', 'Cuotas y alquiler de vehículos'],
  ['Telefónica Germany — Telefonía', 'Oficina, telefonía y software'],
  ['Telefónica Insurance — Telefonía', 'Seguros de empresa'],
  ['Amazon Payments Europe — Suministros', 'Oficina, telefonía y software'],
  ['Amazon EU — Suministros', 'Oficina, telefonía y software'],
  ['Adyen — Procesador de pagos', 'Materiales'],
  ['Volksbank Vorpommern — Comisiones bancarias', 'Intereses y comisiones bancarias'],
  ['Kinder und Partner — Asesoría', 'Asesoría y gestoría'],
];

/** Counterparty strings as they really arrive from the DATEV import. */
const REAL_COUNTERPARTIES = [
  ['FINANZKASSE STRALSUND', 'IVA', COST_SCOPE.OVERHEAD],
  ['Finanzamt Stralsund', 'IVA', COST_SCOPE.OVERHEAD],
  ['AOK Rheinland/Hamburg', 'Seguridad social', COST_SCOPE.OVERHEAD],
  ['BARMER', 'Seguridad social', COST_SCOPE.OVERHEAD],
  ['Hauptzollamt Stralsund', 'Seguridad social', COST_SCOPE.OVERHEAD],
  ['UNION TANK Eckstein GmbH & Co. KG', 'Combustible', COST_SCOPE.OVERHEAD],
  ['RCI Banque S.A. Niederlassung Deutschland', 'Cuotas y alquiler de vehículos', COST_SCOPE.OVERHEAD],
  ['Telefonica Germany GmbH & Co. OHG', 'Oficina, telefonía y software', COST_SCOPE.OVERHEAD],
  ['Telefonica Insurance S.A.', 'Seguros de empresa', COST_SCOPE.OVERHEAD],
  ['AMAZON PAYMENTS EUROPE S.C.A.', 'Oficina, telefonía y software', COST_SCOPE.OVERHEAD],
  ['Amazon EU S.a.r.l.', 'Oficina, telefonía y software', COST_SCOPE.OVERHEAD],
  ['ADYEN N.V.', 'Materiales', COST_SCOPE.PROJECT],
  ['Volksbank Vorpommern eG', 'Intereses y comisiones bancarias', COST_SCOPE.OVERHEAD],
  ['Kinder und Partner Steuerberater', 'Asesoría y gestoría', COST_SCOPE.OVERHEAD],
  ['Techniker Krankenkasse', 'Seguridad social', COST_SCOPE.OVERHEAD],
  ['TUI BKK', 'Seguridad social', COST_SCOPE.OVERHEAD],
  ['BG ETEM', 'Seguridad social', COST_SCOPE.OVERHEAD],
  ['DAK-Gesundheit', 'Seguridad social', COST_SCOPE.OVERHEAD],
  ['Kreis Lippe', 'Mantenimiento, seguro e impuesto de vehículos', COST_SCOPE.OVERHEAD],
  ['Verti Versicherung AG', 'Mantenimiento, seguro e impuesto de vehículos', COST_SCOPE.OVERHEAD],
  ['ARAL AG', 'Combustible', COST_SCOPE.OVERHEAD],
  ['Sixt GmbH & Co Autovermietung KG', 'Cuotas y alquiler de vehículos', COST_SCOPE.OVERHEAD],
  ['HKL Baumaschinen GmbH', 'Equipos y herramienta', COST_SCOPE.PROJECT],
  ['BAUHAUS GmbH & Co. KG', 'Materiales', COST_SCOPE.PROJECT],
  ['Engelbert Strauss GmbH & Co. KG', 'Otros de personal', COST_SCOPE.OVERHEAD],
  ['DATEV eG', 'Asesoría y gestoría', COST_SCOPE.OVERHEAD],
  ['Deutsche Post AG', 'Oficina, telefonía y software', COST_SCOPE.OVERHEAD],
  ['Bundesanzeiger Verlag GmbH', 'Otros administrativos', COST_SCOPE.OVERHEAD],
  ['NÜRNBERGER Allgemeine Versicherungs-AG', 'Seguros de empresa', COST_SCOPE.OVERHEAD],
  ['Friedrich Epple', 'Alojamiento trabajadores', COST_SCOPE.PROJECT],
  ['Bauunternehmen Markus Schmidt', 'Daños a terceros', COST_SCOPE.PROJECT],
];

const movementFrom = (counterpartyName, overrides = {}) => ({
  id: `mov-${counterpartyName}`,
  direction: 'out',
  amount: 480.25,
  counterpartyName,
  description: 'SEPA Lastschrift',
  postedDate: '2026-06-15',
  status: 'posted',
  ...overrides,
});

const classify = (movement) => {
  const rule = findBestRule(movement, SEED_CLASSIFICATION_RULES);
  return rule ? { rule, payload: buildClassificationPayload(rule, movement) } : { rule: null, payload: {} };
};

describe('seed classification rules catalog', () => {
  it('keeps every original seed under its stable name, retargeted to the v2 catalogue', () => {
    const byName = new Map(SEED_CLASSIFICATION_RULES.map((r) => [r.name, r]));
    for (const [name, categoryName] of LEGACY_SEEDS) {
      expect(byName.get(name), `missing seed "${name}"`).toBeDefined();
      expect(byName.get(name).applyTo.categoryName).toBe(categoryName);
    }
    // The first seed is the one the seedRuleToDoc tests below rely on.
    expect(SEED_CLASSIFICATION_RULES[0].name).toBe('Finanzkasse Stralsund — Impuestos');
  });

  it('has unique names and unique field + pattern keys (the app skips a seed by that key)', () => {
    const names = SEED_CLASSIFICATION_RULES.map((r) => r.name);
    expect(new Set(names).size).toBe(names.length);
    const keys = SEED_CLASSIFICATION_RULES.map(ruleSeedKey);
    expect(keys.every(Boolean)).toBe(true);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('only uses schema values the rule form and the engine understand', () => {
    for (const rule of SEED_CLASSIFICATION_RULES) {
      expect(RULE_FIELDS).toContain(rule.field);
      expect(RULE_MATCH_TYPES).toContain(rule.matchType);
      expect(RULE_DIRECTIONS).toContain(rule.direction);
      expect(rule.active).toBe(true);
      expect(rule.pattern.trim()).not.toBe('');
      expect(rule.name.trim()).not.toBe('');
      if (rule.matchType === 'regex') expect(() => new RegExp(rule.pattern, 'i')).not.toThrow();
    }
  });

  it('only uses category names that exist in the taxonomy', () => {
    for (const rule of SEED_CLASSIFICATION_RULES) {
      expect(categoryByName(rule.applyTo.categoryName), rule.name).not.toBeNull();
    }
  });

  it('takes the cost scope from the category default (none for inbound rules) and never names a project', () => {
    for (const rule of SEED_CLASSIFICATION_RULES) {
      const category = categoryByName(rule.applyTo.categoryName);
      expect(rule.applyTo.costScope, rule.name).toBe(rule.direction === 'in' ? '' : category.defaultScope);
      expect(rule.applyTo.projectId).toBe('');
      expect(rule.applyTo.projectName).toBe('');
      expect(rule.applyTo.costCenterId).toBe('');
    }
  });

  it('sits below the default priority so hand-made rules always win a conflict', () => {
    expect(SEED_RULE_PRIORITY).toBeLessThan(SEED_DESCRIPTION_RULE_PRIORITY);
    for (const rule of SEED_CLASSIFICATION_RULES) {
      expect(rule.priority).toBeLessThan(100);
      expect(rule.priority).toBeGreaterThan(0);
    }
  });

  it('covers every group of the taxonomy that has a recurring counterparty', () => {
    const groups = new Set(SEED_CLASSIFICATION_RULES.map((r) => categoryByName(r.applyTo.categoryName).group));
    TAXONOMY.map((c) => c.group).forEach((group) => expect(groups, group).toContain(group));
  });
});

describe('seed rules through the engine — counterparties', () => {
  it.each(REAL_COUNTERPARTIES)('%s → %s (%s)', (counterpartyName, categoryName, costScope) => {
    const movement = movementFrom(counterpartyName);
    const { rule, payload } = classify(movement);
    expect(rule, `no seed rule matched "${counterpartyName}"`).not.toBeNull();
    expect(payload).toEqual({ categoryName, costScope });
  });

  it('produces a valid overhead classification with no project selected', () => {
    for (const [counterpartyName, , costScope] of REAL_COUNTERPARTIES) {
      if (costScope !== COST_SCOPE.OVERHEAD) continue;
      const movement = movementFrom(counterpartyName);
      const { payload } = classify(movement);
      expect(validateClassification(movement, { ...payload, projectId: '' })).toEqual({ valid: true, error: null });
    }
  });

  it('leaves a project-scoped classification waiting for the Bandeja to pick the obra', () => {
    const movement = movementFrom('BAUHAUS GmbH & Co. KG');
    const { payload } = classify(movement);
    expect(payload.costScope).toBe(COST_SCOPE.PROJECT);
    expect(validateClassification(movement, { ...payload, projectId: '' }).valid).toBe(false);
  });

  it('leaves inbound movements from outbound-only counterparties untouched', () => {
    for (const counterpartyName of ['UNION TANK Eckstein GmbH & Co. KG', 'BAUHAUS GmbH & Co. KG', 'Kinder und Partner Steuerberater']) {
      expect(findBestRule(movementFrom(counterpartyName, { direction: 'in' }), SEED_CLASSIFICATION_RULES)).toBeNull();
    }
  });

  it('never overwrites a movement that already has a destination', () => {
    const movement = movementFrom('FINANZKASSE STRALSUND', { categoryName: 'IVA', projectId: 'proj-1' });
    expect(classify(movement).payload).toEqual({});
  });

  it('matches short brand names as whole words only', () => {
    expect(findBestRule(movementFrom('Projekt Nord GmbH'), SEED_CLASSIFICATION_RULES)).toBeNull();
    expect(findBestRule(movementFrom('Klinikkosten Rostock'), SEED_CLASSIFICATION_RULES)).toBeNull();
    expect(classify(movementFrom('JET Tankstelle Stralsund')).payload.categoryName).toBe('Combustible');
    expect(classify(movementFrom('IKK classic')).payload.categoryName).toBe('Seguridad social');
  });
});

describe('seed rules through the engine — descriptions outrank counterparties', () => {
  const finanzkasse = (description, overrides = {}) =>
    movementFrom('FINANZKASSE STRALSUND', { description, ...overrides });

  it('routes Lohnsteuer to Impuesto de nómina even though the Finanzkasse rule matches too', () => {
    const { rule, payload } = classify(finanzkasse('STEUERNR 082/121/02610 LOHNST DEZ.25'));
    expect(rule.field).toBe('description');
    expect(payload).toEqual({ categoryName: 'Impuesto de nómina', costScope: COST_SCOPE.OVERHEAD });
  });

  it('routes VAT payments to IVA by any of their spellings', () => {
    ['UMS.ST NOV.25', 'Umsatzsteuer Voranmeldung 01/26', 'Teilzahlung 8291210261040 Zeitraum 0126'].forEach((description) => {
      expect(classify(finanzkasse(description)).payload.categoryName).toBe('IVA');
    });
  });

  it('routes trade and corporate tax to Impuesto sobre beneficios', () => {
    expect(classify(movementFrom('Finanzamt Stralsund', { description: 'GEWST 2025 Vorauszahlung' })).payload.categoryName).toBe(
      'Impuesto sobre beneficios',
    );
    expect(classify(movementFrom('Finanzamt Stralsund', { description: 'Körperschaftsteuer 2025' })).payload.categoryName).toBe(
      'Impuesto sobre beneficios',
    );
  });

  it('routes Kfz-Steuer to the vehicle bucket', () => {
    expect(classify(movementFrom('Bundeskasse Trier', { description: 'Kfz-Steuer HST-UM 123' })).payload.categoryName).toBe(
      'Mantenimiento, seguro e impuesto de vehículos',
    );
  });

  it('routes the VISA settlement to Tarjeta corporativa and a plain closing to bank fees', () => {
    expect(classify(movementFrom('Volksbank Vorpommern eG', { description: 'VISA Abrechnung 01.26' })).payload.categoryName).toBe(
      'Tarjeta corporativa',
    );
    expect(classify(movementFrom('Volksbank Vorpommern eG', { description: 'ABSCHLUSS PER 31.03.2026' })).payload.categoryName).toBe(
      'Intereses y comisiones bancarias',
    );
    expect(classify(movementFrom('', { description: 'ABSCHLUSS PER 30.06.2026' })).payload.categoryName).toBe(
      'Intereses y comisiones bancarias',
    );
  });

  it('keeps the VAT charged on bank fees out of the IVA bucket', () => {
    expect(classify(movementFrom('', { description: 'Umsatzsteuer auf EUR 12,50 Abrechnung' })).payload.categoryName).toBe(
      'Intereses y comisiones bancarias',
    );
  });

  it('routes partner loan interest to Intereses de préstamos de socios', () => {
    expect(classify(movementFrom('Jeisson Romero Lesmes', { description: 'Zinsen Darlehn 06/26' })).payload.categoryName).toBe(
      'Intereses de préstamos de socios',
    );
  });

  it('routes third-party damage invoices to Daños a terceros, obra', () => {
    expect(classify(movementFrom('Kossakowski', { description: 'Schaden Glasfaser Einfahrt' })).payload).toEqual({
      categoryName: 'Daños a terceros',
      costScope: COST_SCOPE.PROJECT,
    });
  });

  it('routes lodging descriptions to Alojamiento trabajadores, obra', () => {
    ['Ferienwohnung Seeblick KW 12', 'FeWo Monteure', 'Pension Sonnenhof', 'Monteurwohnung Rossdorf', 'Unterkunft Takak'].forEach(
      (description) => {
        expect(classify(movementFrom('Privat', { description })).payload).toEqual({
          categoryName: 'Alojamiento trabajadores',
          costScope: COST_SCOPE.PROJECT,
        });
      },
    );
    expect(findBestRule(movementFrom('Pensionskasse', { description: 'Pensionskasse Beitrag' }), SEED_CLASSIFICATION_RULES)).toBeNull();
  });

  it('routes lodging counterparties too — on the statement the word sits in the payee, not the purpose line', () => {
    ['Unterkunft Takak', 'Ferienwohnung Burg Lindenfels', 'FeWo Seeblick GbR', 'Pension Sonnenhof'].forEach((counterpartyName) => {
      expect(classify(movementFrom(counterpartyName, { description: 'Rechnungsnr. 602021' })).payload, counterpartyName).toEqual({
        categoryName: 'Alojamiento trabajadores',
        costScope: COST_SCOPE.PROJECT,
      });
    });
    expect(findBestRule(movementFrom('Pensionskasse Nord', { description: 'Rechnungsnr. 602021' }), SEED_CLASSIFICATION_RULES)).toBeNull();
  });

  it('routes Sonderpreis purchases to Materiales whether the store is in the payee or the purpose line', () => {
    expect(classify(movementFrom('SONDERPREIS GERHARD WEISS')).payload).toEqual({
      categoryName: 'Materiales',
      costScope: COST_SCOPE.PROJECT,
    });
    expect(classify(movementFrom('Privat', { description: 'SONDERPREIS BAUMARKT Stralsund 12.03.26' })).payload).toEqual({
      categoryName: 'Materiales',
      costScope: COST_SCOPE.PROJECT,
    });
  });
});

describe('seed rules through the engine — inbound money', () => {
  it('stamps an own-account transfer as internal in both directions', () => {
    const out = movementFrom('UMTELKOMD GmbH', { description: 'Umbuchung Konto 2' });
    expect(classify(out).payload).toEqual({ categoryName: 'Transferencia interna', kind: 'transfer' });
    const inbound = movementFrom('UMTELKOMD GmbH', { direction: 'in' });
    expect(classify(inbound).payload).toEqual({ categoryName: 'Transferencia interna', kind: 'transfer' });
    expect(classify(movementFrom('Volksbank', { description: 'interne Umbuchung Tagesgeld' })).payload.categoryName).toBe(
      'Transferencia interna',
    );
  });

  it('files client collections under Facturación obra', () => {
    ['INSYTE DEUTSCHLAND GMBH', 'CAIXABANK S.A.', 'MONCOBRA S.A.'].forEach((counterpartyName) => {
      expect(classify(movementFrom(counterpartyName, { direction: 'in', amount: 12000 })).payload).toEqual({
        categoryName: 'Facturación obra',
      });
    });
  });

  it('files a partner contribution from Jeisson as Aportes y préstamos de socios recibidos', () => {
    expect(classify(movementFrom('JEISSON ANDRES ROMERO LESMES', { direction: 'in', amount: 8000 })).payload).toEqual({
      categoryName: 'Aportes y préstamos de socios recibidos',
    });
  });

  it('files small homeowner invoices under Servicios particulares, and only small ones', () => {
    const small = movementFrom('Max Mustermann', { direction: 'in', amount: 350, description: 'Rechnungs-Nr 2025-014 Hausanschluss' });
    expect(classify(small).payload).toEqual({ categoryName: 'Servicios particulares' });
    [
      'RE NR 2025-021',
      'R-NR. 2025-214/20.05.26 /24.04.26/Crosmann',
      'RG-NR 2025-212',
      'Re.Nr.2025-217 vom 20.05.2026',
      'Rechnung 2026-003 Hausanschluss',
      'RECHNUNGS-NR: 2025-179',
      'Rechnungs-Nr.: 2025-226',
      '2025-148 19.01.2026 Hoppe',
      '2025-169',
      '  2025-144',
    ].forEach((description) => {
      const spelled = movementFrom('Erika Musterfrau', { direction: 'in', amount: 120, description });
      expect(classify(spelled).payload, description).toEqual({ categoryName: 'Servicios particulares' });
    });
    expect(findBestRule(movementFrom('Erika Musterfrau', { direction: 'in', amount: 120, description: 'Gutschrift 2025' }), SEED_CLASSIFICATION_RULES)).toBeNull();
    // A client invoice reference is not a homeowner invoice number.
    expect(findBestRule(movementFrom('Privat', { direction: 'in', amount: 300, description: 'R.UMT-2026-0043' }), SEED_CLASSIFICATION_RULES)).toBeNull();
    expect(findBestRule(movementFrom('Privat', { direction: 'in', amount: 300, description: 'Zahlung 2026-0043 Projekt' }), SEED_CLASSIFICATION_RULES)).toBeNull();
    const large = movementFrom('Max Mustermann', { direction: 'in', amount: 2000, description: 'Rechnung 2025-014' });
    expect(findBestRule(large, SEED_CLASSIFICATION_RULES)).toBeNull();
  });

  it('lets a client counterparty rule beat the homeowner fallback', () => {
    const insyte = movementFrom('INSYTE DEUTSCHLAND GMBH', { direction: 'in', amount: 300, description: 'Rechnung 2025-099' });
    expect(classify(insyte).payload.categoryName).toBe('Facturación obra');
  });

  it('puts a bounced Finanzkasse debit back into IVA', () => {
    const bounced = movementFrom('FINANZKASSE STRALSUND', {
      direction: 'in',
      description: 'RETURN/REFUND, Retoure SEPA Lastschrift vom 10.02.2026, Lastschriftwiderspruch',
    });
    expect(classify(bounced).payload).toEqual({ categoryName: 'IVA' });
  });

  it('treats tax office refunds as financial income', () => {
    expect(classify(movementFrom('Finanzamt Stralsund', { direction: 'in', description: 'ERSTATT UST 2025' })).payload).toEqual({
      categoryName: 'Devoluciones e ingresos financieros',
    });
    expect(
      classify(movementFrom('Amt Recknitz-Trebeltal', { direction: 'in', description: 'Guthabenerstattung Gewst 2024' })).payload,
    ).toEqual({ categoryName: 'Devoluciones e ingresos financieros' });
  });

  it('keeps Krankenkasse reimbursements and the Hauptzollamt overpayment in Seguridad social', () => {
    expect(classify(movementFrom('BARMER', { direction: 'in', description: 'Erstattung nach AAG 02/2026' })).payload).toEqual({
      categoryName: 'Seguridad social',
    });
    expect(classify(movementFrom('TUI BKK', { direction: 'in', description: 'STORNIERUNG BEITRAGSFESTSETZUNG' })).payload).toEqual({
      categoryName: 'Seguridad social',
    });
    expect(
      classify(movementFrom('Hauptzollamt Stralsund', { direction: 'in', description: 'Ueberzahlung Bitte an BARMER zahlen' })).payload,
    ).toEqual({ categoryName: 'Seguridad social' });
  });
});

describe('seedRuleToDoc', () => {
  const clock = new Date('2026-07-26T08:30:00.000Z');

  it('shapes a seed entry exactly like the document createRule writes', () => {
    const [taxRule] = SEED_CLASSIFICATION_RULES;
    const doc = seedRuleToDoc(taxRule, 'jromero@umtelkomd.com', clock);

    expect(doc).toEqual({
      name: taxRule.name,
      field: 'counterpartyName',
      matchType: 'contains',
      pattern: taxRule.pattern,
      direction: 'out',
      amountMin: null,
      amountMax: null,
      applyTo: {
        categoryName: 'IVA',
        costCenterId: '',
        projectId: '',
        projectName: '',
        costScope: COST_SCOPE.OVERHEAD,
      },
      active: true,
      priority: taxRule.priority,
      notes: taxRule.notes,
      hits: 0,
      lastHitAt: '',
      createdAt: '2026-07-26T08:30:00.000Z',
      updatedAt: '2026-07-26T08:30:00.000Z',
      createdBy: 'jromero@umtelkomd.com',
    });
  });

  it('carries an amount ceiling and a regex match type through untouched', () => {
    const homeowner = SEED_CLASSIFICATION_RULES.find((r) => r.amountMax != null);
    const doc = seedRuleToDoc(homeowner, 'jromero@umtelkomd.com', clock);
    expect(doc.amountMax).toBe(400);
    expect(doc.matchType).toBe('regex');
    expect(doc.direction).toBe('in');
  });

  it('defaults the author to an empty string when no user email is given', () => {
    expect(seedRuleToDoc(SEED_CLASSIFICATION_RULES[0], undefined, clock).createdBy).toBe('');
    expect(seedRuleToDoc(SEED_CLASSIFICATION_RULES[0], null, clock).createdBy).toBe('');
  });

  it('trims text and falls back to the hook defaults for invalid enum values', () => {
    const doc = seedRuleToDoc({
      name: '  Manual rule  ',
      field: 'iban',
      matchType: 'fuzzy',
      pattern: '  ADYEN  ',
      direction: 'sideways',
      applyTo: { categoryName: '  Otros administrativos  ', costScope: 'structural' },
      notes: '  note  ',
    }, 'bsandoval@umtelkomd.com', clock);

    expect(doc.name).toBe('Manual rule');
    expect(doc.pattern).toBe('ADYEN');
    expect(doc.notes).toBe('note');
    expect(doc.field).toBe('counterpartyName');
    expect(doc.matchType).toBe('contains');
    expect(doc.direction).toBe('both');
    expect(doc.priority).toBe(100);
    expect(doc.active).toBe(true);
    expect(doc.applyTo).toEqual({
      categoryName: 'Otros administrativos',
      costCenterId: '',
      projectId: '',
      projectName: '',
      costScope: '',
    });
  });

  it('keeps priority a non-negative integer and honours an explicit inactive flag', () => {
    expect(seedRuleToDoc({ priority: 12.9 }, '', clock).priority).toBe(12);
    expect(seedRuleToDoc({ priority: -5 }, '', clock).priority).toBe(0);
    expect(seedRuleToDoc({ priority: 'nope' }, '', clock).priority).toBe(100);
    expect(seedRuleToDoc({ active: false }, '', clock).active).toBe(false);
  });

  it('stamps both timestamps from the same clock and stays serializable', () => {
    const doc = seedRuleToDoc(SEED_CLASSIFICATION_RULES[0], 'jromero@umtelkomd.com', clock);
    expect(doc.createdAt).toBe(doc.updatedAt);
    expect(() => JSON.stringify(doc)).not.toThrow();
    expect(seedRuleToDoc(SEED_CLASSIFICATION_RULES[0], '').createdAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    );
  });

  it('never mutates the source catalog', () => {
    const snapshot = JSON.stringify(SEED_CLASSIFICATION_RULES);
    const doc = seedRuleToDoc(SEED_CLASSIFICATION_RULES[0], 'jromero@umtelkomd.com', clock);
    doc.applyTo.categoryName = 'mutated';
    doc.priority = 999;
    expect(JSON.stringify(SEED_CLASSIFICATION_RULES)).toBe(snapshot);
  });
});
