import { formatIsoDate, toNumber } from './cfoMetrics.js';

const DEFAULT_WINDOW_MONTHS = 5;
const MIN_INTERNAL_RATE = 30;
const MIN_QUOTE_RATE = 35;
const HIGH_VOLUME_DIRECT_COSTS = 85000;

const UNKNOWN_LABELS = new Set([
  '',
  'sin asignar',
  'sin proyecto',
  'sin categoria',
  'sin categoría',
  'uncategorized',
  'unknown',
  'n/a',
]);

const OVERHEAD_PROJECT_CODES = ['amd-001', 'overhead'];
const OVERHEAD_COST_CENTERS = ['cc-004', 'administrativo', 'cc-006', 'seguros', 'gestorias', 'gestoría', 'gestoria'];
const DIRECT_COST_CENTERS = [
  'cc-001',
  'obra civil',
  'cc-002',
  'instalaciones',
  'reparaciones',
  'cc-003',
  'ne4',
  'cc-005',
  'despliegue',
  'cc-008',
  'contratistas',
];

const DIRECT_CATEGORY_PATTERNS = [
  'subcontrato',
  'subcontratos',
  'material',
  'materiales',
  'reparacion',
  'reparaciones',
  'herramienta',
  'obra civil',
  'instalacion',
  'instalaciones',
];

const OVERHEAD_CATEGORY_PATTERNS = [
  'software',
  'hosting',
  'buro',
  'oficina',
  'contabilidad',
  'gestoria',
  'seguros',
  'administrativo',
  'marketing',
  'telefonia',
];

const VAT_TAX_PATTERNS = [
  'umsatzsteuer',
  'ums.st',
  'ums st',
  'ust.',
  ' ust ',
  'mehrwertsteuer',
  'mwst',
  'vat',
  'iva',
  'finanzkasse',
  'finanzamt',
  'steuernr',
];

const PAYROLL_RELATED_PATTERNS = [
  'barmer',
  'aok',
  'krankenkasse',
  'bkk',
  'beitrag',
  'beitraege',
  'beiträge',
  'sozialversicherung',
  'sv beitrag',
  'lohnsteuer',
  'kirchensteuer',
];

const FINANCING_TRANSFER_PATTERNS = [
  'darlehen',
  'tilgung',
  'kredit',
  'zinsen',
  'intereses prestamos',
  'intereses bancos',
  'bankgebuhr',
  'bankgebühr',
  'interne umbuchung',
  'umbuchung',
  'visa abrechnung',
  'kartenabrechnung',
];

const OVERHEAD_PAYROLL_NAMES = [
  'lesmes linares',
  'sandoval',
  'romero lesmes',
  'horstmann',
  'jeisson andres romero',
  'juan de dios lesmes',
  'beatriz',
  'isabelle',
];

const DIRECT_PAYROLL_NAMES = [
  'lesmes correa',
  'herrera romero',
  'pizarro zapata',
  'pizarro calfual',
  'agudelo grajales',
  'jorge alexander herrera',
  'santamaria losada',
  'juan felipe santamaria',
  'oscar gomez',
  'kevin',
  'raul',
  'yenkenet',
  'ledier',
  'dario',
  'matos gutierrez',
  'agudelo',
];

const DIRECT_VENDOR_PATTERNS = [
  'mqh telecomunicaciones',
  'erick angel',
  'movitrantel',
  'lozartico',
  'jorge lider',
  'jakob aras',
  'union tank',
  'uta ',
  'andres yenkenet',
  'shiny homes',
  'joseph cristopher',
  'fractalkom',
  'raul garcia',
  'umtelkomd espana',
  'algus telecom',
  'michel alexander',
  'incerval',
  'bauunternehmen',
  'dz bank',
  'europcar',
  'mohamad srour',
  'osman tekelioglu',
  'otto bitter',
  'ferienwohnung',
  'wilhelm bilger',
  'mario bierfreund',
  'jhon jairo rivera',
];

const DIRECT_WORK_HINT_PATTERNS = [
  'projekt ',
  'proyecto ',
  'rossdorf',
  'roßdorf',
  'fbx',
  'ne3',
  'ne4',
  'glasfaser',
  'einblas',
  'spleiss',
  'spleiß',
  'sanierungsarbeiten',
  'europcar',
  'tank',
  'diesel',
  'hotel',
  'ferienwohnung',
];

const OVERHEAD_VENDOR_PATTERNS = [
  'kinder und partner',
  'schomerus',
  'telefonica',
  'verti versicherung',
  'nurnberger',
  'nürnberger',
  'beatriz mercedes sandoval',
  'bg etem',
  'amazon payments',
  'datev',
];

const OVERHEAD_ADMIN_HINT_PATTERNS = [
  'bueromiete',
  'büromiete',
  'buchhaltung',
  'steuerberater',
  'versicherung',
  'haftpflicht',
  'telefon',
];

const roundMoney = (value) => Math.round((Number(value) || 0) * 100) / 100;
const roundPct = (value) => Math.round((Number(value) || 0) * 10) / 10;
const roundMultiplier = (value) => Math.round((Number(value) || 0) * 100) / 100;
const ceilToFive = (value) => Math.ceil((Number(value) || 0) / 5) * 5;
const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

export const normalizeBurdenText = (value) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ß/g, 'ss')
    .toLowerCase()
    .trim();

const hasAny = (text, patterns) => patterns.some((pattern) => text.includes(normalizeBurdenText(pattern)));
const hasUsefulValue = (value) => !UNKNOWN_LABELS.has(normalizeBurdenText(value));

const getMonthKey = (value) => {
  const iso = formatIsoDate(value);
  return iso ? iso.slice(0, 7) : null;
};

const sortMonthKeys = (keys) => [...keys].sort((left, right) => left.localeCompare(right));

const addMoney = (bucket, key, amount) => {
  bucket[key] = roundMoney((bucket[key] || 0) + amount);
};

const buildRefs = (snapshot = {}) => {
  const projectsById = new Map();
  const costCentersById = new Map();

  for (const project of snapshot.projects || []) {
    if (!project?.id) continue;
    projectsById.set(project.id, project);
  }

  for (const costCenter of snapshot.costCenters || []) {
    if (!costCenter?.id) continue;
    costCentersById.set(costCenter.id, costCenter);
    if (costCenter.code) costCentersById.set(costCenter.code, costCenter);
  }

  return { projectsById, costCentersById };
};

const projectLabels = (movement, refs) => {
  const project = refs.projectsById.get(movement?.projectId);
  return [
    movement?.projectId,
    movement?.projectName,
    movement?.project,
    project?.code,
    project?.name,
    project?.displayName,
  ].filter(Boolean);
};

const costCenterLabels = (movement, refs) => {
  const costCenter = refs.costCentersById.get(movement?.costCenterId);
  return [
    movement?.costCenterId,
    movement?.costCenterName,
    movement?.costCenter,
    costCenter?.code,
    costCenter?.name,
  ].filter(Boolean);
};

const movementSearchText = (movement, refs) =>
  normalizeBurdenText([
    movement?.categoryName,
    movement?.category,
    movement?.classification,
    movement?.counterpartyName,
    movement?.vendor,
    movement?.description,
    movement?.documentNumber,
    movement?.kind,
    ...projectLabels(movement, refs),
    ...costCenterLabels(movement, refs),
  ].filter(Boolean).join(' '));

const isUsableBankOutflow = (movement) => {
  if (!movement) return false;
  if (movement.direction !== 'out') return false;
  const status = normalizeBurdenText(movement.status || 'posted');
  return status !== 'void' && status !== 'cancelled';
};

const isExplicitOverheadProject = (movement, refs) =>
  projectLabels(movement, refs)
    .map(normalizeBurdenText)
    .some((label) => hasUsefulValue(label) && hasAny(label, OVERHEAD_PROJECT_CODES));

const hasDirectProject = (movement, refs) =>
  projectLabels(movement, refs)
    .map(normalizeBurdenText)
    .some((label) => hasUsefulValue(label) && !hasAny(label, OVERHEAD_PROJECT_CODES));

const hasOverheadCostCenter = (movement, refs) =>
  costCenterLabels(movement, refs)
    .map(normalizeBurdenText)
    .some((label) => hasUsefulValue(label) && hasAny(label, OVERHEAD_COST_CENTERS));

const hasDirectCostCenter = (movement, refs) =>
  costCenterLabels(movement, refs)
    .map(normalizeBurdenText)
    .some((label) => hasUsefulValue(label) && hasAny(label, DIRECT_COST_CENTERS));

const classifyPayrollPerson = (text) => {
  if (hasAny(text, OVERHEAD_PAYROLL_NAMES)) return 'overhead';
  if (hasAny(text, DIRECT_PAYROLL_NAMES)) return 'direct';
  return null;
};

export const computePayrollBurdenSplit = (payrollPeriods = [], options = {}) => {
  const asOfMonth = getMonthKey(options.asOfDate || new Date());
  const sorted = [...(payrollPeriods || [])]
    .filter((period) => period?.period && (!asOfMonth || period.period < asOfMonth))
    .sort((left, right) => String(right.period).localeCompare(String(left.period)));

  const latest = sorted[0] || (payrollPeriods || []).find((period) => period?.lines?.length);
  if (!latest?.lines?.length) {
    return {
      period: null,
      overheadPayroll: 0,
      directPayroll: 0,
      totalPayroll: 0,
      overheadShare: 0,
      directShare: 0,
      hasData: false,
    };
  }

  let overheadPayroll = 0;
  let directPayroll = 0;

  for (const line of latest.lines || []) {
    const amount = roundMoney(
      toNumber(
        line?.employerCost ??
          line?.gesamtkosten ??
          line?.totalCost ??
          line?.cost ??
          line?.grossAmount ??
          line?.netto ??
          line?.net,
      ),
    );
    if (amount <= 0) continue;

    const text = normalizeBurdenText([
      line?.employeeName,
      line?.fullName,
      line?.name,
      line?.role,
      line?.costCenterId,
      line?.projectId,
    ].filter(Boolean).join(' '));
    if (classifyPayrollPerson(text) === 'overhead') overheadPayroll += amount;
    else directPayroll += amount;
  }

  const totalPayroll = roundMoney(overheadPayroll + directPayroll);
  return {
    period: latest.period || null,
    overheadPayroll: roundMoney(overheadPayroll),
    directPayroll: roundMoney(directPayroll),
    totalPayroll,
    overheadShare: totalPayroll > 0 ? overheadPayroll / totalPayroll : 0,
    directShare: totalPayroll > 0 ? directPayroll / totalPayroll : 0,
    hasData: totalPayroll > 0,
  };
};

export const classifyOverheadMovement = (movement, refs, payrollSplit) => {
  const amount = roundMoney(Math.abs(toNumber(movement?.amount)));
  if (amount <= 0 || !isUsableBankOutflow(movement)) {
    return { bucket: 'ignored', amount: 0, reason: 'Movimiento no usable para carga operativa' };
  }

  const text = movementSearchText(movement, refs);
  const payrollPersonBucket = classifyPayrollPerson(text);
  const isSalary = hasAny(text, ['salario', 'salarios', 'salary', 'lohn', 'gehalt']);

  if (hasAny(text, PAYROLL_RELATED_PATTERNS) && payrollSplit?.hasData) {
    return {
      bucket: 'split',
      reason: `Nómina social/fiscal repartida por split ${payrollSplit.period}`,
      allocations: [
        { bucket: 'overhead', amount: roundMoney(amount * payrollSplit.overheadShare) },
        { bucket: 'direct', amount: roundMoney(amount * payrollSplit.directShare) },
      ],
    };
  }

  if (isSalary && payrollPersonBucket) {
    return {
      bucket: payrollPersonBucket,
      amount,
      reason: payrollPersonBucket === 'overhead' ? 'Nómina admin/gerencia' : 'Nómina campo/directa',
    };
  }

  if (hasAny(text, VAT_TAX_PATTERNS)) {
    return { bucket: 'excluded', amount, reason: 'IVA/impuestos excluidos del coste operativo cargable' };
  }

  if (hasAny(text, FINANCING_TRANSFER_PATTERNS)) {
    return { bucket: 'excluded', amount, reason: 'Financiación, intereses o transferencia no operativa' };
  }

  if (
    isExplicitOverheadProject(movement, refs) ||
    hasOverheadCostCenter(movement, refs) ||
    hasAny(text, OVERHEAD_CATEGORY_PATTERNS) ||
    hasAny(text, OVERHEAD_VENDOR_PATTERNS) ||
    hasAny(text, OVERHEAD_ADMIN_HINT_PATTERNS)
  ) {
    return { bucket: 'overhead', amount, reason: 'Proyecto, centro, proveedor o categoría overhead/admin' };
  }

  if (isSalary) {
    return { bucket: 'direct', amount, reason: 'Nómina sin marca admin: tratada como campo/directa' };
  }

  if (
    hasDirectProject(movement, refs) ||
    hasDirectCostCenter(movement, refs) ||
    hasAny(text, DIRECT_CATEGORY_PATTERNS) ||
    hasAny(text, DIRECT_VENDOR_PATTERNS) ||
    hasAny(text, DIRECT_WORK_HINT_PATTERNS)
  ) {
    return { bucket: 'direct', amount, reason: 'Proyecto, centro, proveedor o señal directa de obra' };
  }

  return { bucket: 'unknown', amount, reason: 'Movimiento sin regla de overhead/directo' };
};

const getCompleteMonths = (movements, asOfDate, windowMonths) => {
  const currentMonth = getMonthKey(asOfDate || new Date());
  const months = new Set();
  for (const movement of movements || []) {
    const month = getMonthKey(movement?.postedDate || movement?.valueDate || movement?.date);
    if (!month) continue;
    if (currentMonth && month >= currentMonth) continue;
    months.add(month);
  }
  return sortMonthKeys(months).slice(-windowMonths);
};

const emptyMonthRow = (month) => ({
  id: month,
  month,
  direct: 0,
  overhead: 0,
  unknown: 0,
  excluded: 0,
  ignored: 0,
  baseRatePct: 0,
  bufferedRatePct: 0,
});

export const summarizeOverheadBurdenRate = (snapshot = {}, options = {}) => {
  const windowMonths = options.windowMonths || DEFAULT_WINDOW_MONTHS;
  const asOfDate = formatIsoDate(options.asOfDate || new Date());
  const refs = buildRefs(snapshot);
  const payrollSplit = computePayrollBurdenSplit(snapshot.payrollPeriods || [], { asOfDate });
  const candidateMovements = (snapshot.bankMovements || []).filter(isUsableBankOutflow);
  const months = getCompleteMonths(candidateMovements, asOfDate, windowMonths);
  const monthSet = new Set(months);

  const totals = {
    direct: 0,
    overhead: 0,
    unknown: 0,
    excluded: 0,
    ignored: 0,
  };
  const counts = {
    direct: 0,
    overhead: 0,
    unknown: 0,
    excluded: 0,
    ignored: 0,
    split: 0,
  };
  const byReason = {};
  const byMonthMap = new Map(months.map((month) => [month, emptyMonthRow(month)]));

  const addAllocation = (monthRow, bucket, amount) => {
    if (!bucket || amount <= 0) return;
    addMoney(totals, bucket, amount);
    if (monthRow) addMoney(monthRow, bucket, amount);
  };

  for (const movement of candidateMovements) {
    const month = getMonthKey(movement?.postedDate || movement?.valueDate || movement?.date);
    if (!monthSet.has(month)) continue;

    const monthRow = byMonthMap.get(month);
    const classification = classifyOverheadMovement(movement, refs, payrollSplit);
    counts[classification.bucket] = (counts[classification.bucket] || 0) + 1;
    byReason[classification.reason] = (byReason[classification.reason] || 0) + 1;

    if (classification.bucket === 'split') {
      for (const allocation of classification.allocations || []) {
        addAllocation(monthRow, allocation.bucket, allocation.amount);
      }
    } else {
      addAllocation(monthRow, classification.bucket, classification.amount);
    }
  }

  const monthCount = Math.max(1, months.length);
  const baseRatePct = totals.direct > 0 ? (totals.overhead / totals.direct) * 100 : 0;
  const unknownRatePct = totals.direct > 0 ? (totals.unknown / totals.direct) * 100 : 0;
  const bufferedRatePct = totals.direct > 0 ? baseRatePct + unknownRatePct : 0;
  const unknownSharePct = (totals.direct + totals.overhead + totals.unknown) > 0
    ? (totals.unknown / (totals.direct + totals.overhead + totals.unknown)) * 100
    : 0;
  const avgDirectMonthly = roundMoney(totals.direct / monthCount);
  const avgOverheadMonthly = roundMoney(totals.overhead / monthCount);
  const avgUnknownMonthly = roundMoney(totals.unknown / monthCount);
  const quoteFloor = avgDirectMonthly >= HIGH_VOLUME_DIRECT_COSTS ? MIN_INTERNAL_RATE : MIN_QUOTE_RATE;
  const unknownBufferWeight = unknownSharePct > 15 ? 1 : unknownSharePct > 7 ? 0.5 : 0.25;
  const recommendationBasisRatePct = baseRatePct + (unknownRatePct * unknownBufferWeight);
  const recommendedQuoteRatePct = totals.direct > 0
    ? clamp(Math.max(quoteFloor, ceilToFive(recommendationBasisRatePct)), quoteFloor, 45)
    : 0;
  const internalRatePct = totals.direct > 0
    ? clamp(Math.max(MIN_INTERNAL_RATE, Math.ceil(recommendationBasisRatePct)), MIN_INTERNAL_RATE, 45)
    : 0;

  const byMonth = [...byMonthMap.values()].map((row) => ({
    ...row,
    direct: roundMoney(row.direct),
    overhead: roundMoney(row.overhead),
    unknown: roundMoney(row.unknown),
    excluded: roundMoney(row.excluded),
    ignored: roundMoney(row.ignored),
    baseRatePct: row.direct > 0 ? roundPct((row.overhead / row.direct) * 100) : 0,
    bufferedRatePct: row.direct > 0 ? roundPct(((row.overhead + row.unknown) / row.direct) * 100) : 0,
  }));

  const dataQuality = unknownSharePct > 15
    ? 'low'
    : unknownSharePct > 7
      ? 'medium'
      : 'high';

  return {
    asOfDate,
    windowMonths,
    months,
    hasData: totals.direct > 0 || totals.overhead > 0 || totals.unknown > 0,
    totals: Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, roundMoney(value)])),
    averages: {
      directMonthly: avgDirectMonthly,
      overheadMonthly: avgOverheadMonthly,
      unknownMonthly: avgUnknownMonthly,
    },
    rates: {
      baseRatePct: roundPct(baseRatePct),
      bufferedRatePct: roundPct(bufferedRatePct),
      recommendationBasisRatePct: roundPct(recommendationBasisRatePct),
      unknownBufferWeight,
      internalRatePct,
      recommendedQuoteRatePct,
      directCostMultiplier: roundMultiplier(1 + recommendedQuoteRatePct / 100),
      unknownSharePct: roundPct(unknownSharePct),
    },
    payrollSplit: {
      ...payrollSplit,
      overheadSharePct: roundPct(payrollSplit.overheadShare * 100),
      directSharePct: roundPct(payrollSplit.directShare * 100),
    },
    byMonth,
    counts,
    byReason,
    dataQuality,
    guidance: {
      highVolumeThreshold: HIGH_VOLUME_DIRECT_COSTS,
      quoteFloor,
      note: 'Carga cotizable = costes directos × (1 + recommendedQuoteRatePct/100). No incluye utilidad/margen.',
    },
  };
};

export default summarizeOverheadBurdenRate;
