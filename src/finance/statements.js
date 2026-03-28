import { clampMoney } from './utils';

const SHORT_MONTH_NAMES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

const KEYWORDS = {
  financing: ['prestamo', 'préstamo', 'loan', 'credito', 'crédito', 'leasing', 'interes', 'interés', 'financi', 'cuota bancaria', 'amortizacion', 'amortización', 'bank fee', 'comision bancaria', 'comisión bancaria'],
  investing: ['equipo', 'equipo ', 'capex', 'activo fijo', 'maquina', 'máquina', 'vehiculo', 'vehículo', 'herramienta', 'hardware', 'mobiliario', 'inversion', 'inversión'],
  payroll: ['nomina', 'nómina', 'salario', 'sueldo', 'seguridad social', 'ss ', 'payroll', 'personal', 'empleado'],
  rentFacilities: ['alquiler', 'rent', 'oficina', 'nave', 'electricidad', 'agua', 'internet', 'telefono', 'teléfono', 'luz', 'facility'],
  vehiclesTravel: ['combustible', 'gasolina', 'diesel', 'diésel', 'parking', 'peaje', 'viaje', 'hotel', 'vuelo', 'taxi', 'uber', 'kilometraje', 'vehiculo', 'vehículo'],
  services: ['asesor', 'gestor', 'abogado', 'consult', 'software', 'saas', 'suscrip', 'hosting', 'marketing', 'publicidad', 'freelance', 'servicio', 'mantenimiento', 'licencia'],
  taxes: ['iva', 'impuesto', 'hacienda', 'tribut', 'retencion', 'retención', 'tasa'],
  directCosts: ['material', 'compra', 'proveedor', 'subcontrata', 'subcontrat', 'proyecto', 'obra'],
  reimbursements: ['reembolso', 'refund', 'devolucion', 'devolución', 'bonificacion', 'bonificación'],
};

const CF_SECTIONS = {
  operating: 'Operación',
  investing: 'Inversión',
  financing: 'Financiación',
};

const monthKeyFromIso = (isoDate) => {
  if (!isoDate || typeof isoDate !== 'string') return null;
  return isoDate.slice(0, 7);
};

const compareMonthKey = (left, right) => left.localeCompare(right);

const formatMonthLabel = (monthKey) => {
  const [year, month] = monthKey.split('-');
  return `${SHORT_MONTH_NAMES[Number(month) - 1]} ${String(year).slice(2)}`;
};

const toSearchText = (movement) => {
  return [
    movement.kind,
    movement.description,
    movement.counterpartyName,
    movement.projectName,
    movement.costCenterId,
    movement.documentNumber,
    movement.raw?.category,
    movement.raw?.costCenter,
    movement.raw?.description,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
};

const includesAny = (text, keywords) => keywords.some((keyword) => text.includes(keyword));

const classifyExpenseLine = (movement, text) => {
  if (includesAny(text, KEYWORDS.investing)) {
    return { includeInPnl: false, lineKey: 'capex', lineLabel: 'Capex pagado' };
  }
  if (includesAny(text, KEYWORDS.financing)) {
    return { includeInPnl: true, lineKey: 'financial', lineLabel: 'Resultado financiero', section: 'belowOperating' };
  }
  if (includesAny(text, KEYWORDS.directCosts) && movement.projectName && movement.projectName !== 'Sin proyecto') {
    return { includeInPnl: true, lineKey: 'directCosts', lineLabel: 'Costes directos', section: 'grossMargin' };
  }
  if (includesAny(text, KEYWORDS.payroll)) {
    return { includeInPnl: true, lineKey: 'payroll', lineLabel: 'Personal', section: 'operatingExpenses' };
  }
  if (includesAny(text, KEYWORDS.rentFacilities)) {
    return { includeInPnl: true, lineKey: 'rentFacilities', lineLabel: 'Oficina y estructura', section: 'operatingExpenses' };
  }
  if (includesAny(text, KEYWORDS.vehiclesTravel)) {
    return { includeInPnl: true, lineKey: 'vehiclesTravel', lineLabel: 'Vehículos y viajes', section: 'operatingExpenses' };
  }
  if (includesAny(text, KEYWORDS.services)) {
    return { includeInPnl: true, lineKey: 'services', lineLabel: 'Servicios externos y software', section: 'operatingExpenses' };
  }
  if (includesAny(text, KEYWORDS.taxes)) {
    return { includeInPnl: true, lineKey: 'taxes', lineLabel: 'Impuestos y tasas', section: 'operatingExpenses' };
  }

  return { includeInPnl: true, lineKey: 'otherOperating', lineLabel: 'Otros gastos operativos', section: 'operatingExpenses' };
};

export const classifyCashFlowMovement = (movement) => {
  const text = toSearchText(movement);
  const direction = movement.direction === 'out' ? 'out' : 'in';

  if (direction === 'in') {
    if (includesAny(text, KEYWORDS.financing)) {
      return {
        sectionKey: 'financing',
        sectionLabel: CF_SECTIONS.financing,
        lineKey: 'financingIn',
        lineLabel: 'Entradas financieras',
      };
    }
    if (includesAny(text, KEYWORDS.investing)) {
      return {
        sectionKey: 'investing',
        sectionLabel: CF_SECTIONS.investing,
        lineKey: 'assetDisposals',
        lineLabel: 'Recuperación de inversiones',
      };
    }

    return {
      sectionKey: 'operating',
      sectionLabel: CF_SECTIONS.operating,
      lineKey: includesAny(text, KEYWORDS.reimbursements) ? 'otherOperatingIn' : 'collections',
      lineLabel: includesAny(text, KEYWORDS.reimbursements) ? 'Otros cobros operativos' : 'Cobros operativos',
    };
  }

  if (includesAny(text, KEYWORDS.investing)) {
    return {
      sectionKey: 'investing',
      sectionLabel: CF_SECTIONS.investing,
      lineKey: 'capex',
      lineLabel: 'Capex e inversión',
    };
  }
  if (includesAny(text, KEYWORDS.financing)) {
    return {
      sectionKey: 'financing',
      sectionLabel: CF_SECTIONS.financing,
      lineKey: 'debtService',
      lineLabel: 'Servicio de deuda e intereses',
    };
  }

  return {
    sectionKey: 'operating',
    sectionLabel: CF_SECTIONS.operating,
    lineKey: 'operatingPayments',
    lineLabel: 'Pagos operativos',
  };
};

export const classifyProfitLossMovement = (movement) => {
  const text = toSearchText(movement);
  const direction = movement.direction === 'out' ? 'out' : 'in';

  if (direction === 'in') {
    if (includesAny(text, KEYWORDS.financing)) {
      return {
        includeInPnl: true,
        lineKey: 'financialIncome',
        lineLabel: 'Ingresos financieros',
        section: 'belowOperating',
      };
    }

    return {
      includeInPnl: true,
      lineKey: includesAny(text, KEYWORDS.reimbursements) ? 'otherIncome' : 'operatingRevenue',
      lineLabel: includesAny(text, KEYWORDS.reimbursements) ? 'Otros ingresos' : 'Ingresos operativos',
      section: 'revenue',
    };
  }

  return classifyExpenseLine(movement, text);
};

export const buildCashFlowStatement = (movements, openingBalance, openingDate, monthKeys = []) => {
  const orderedMonthKeys = Array.from(new Set(monthKeys.filter(Boolean))).sort(compareMonthKey);
  if (orderedMonthKeys.length === 0) return [];

  const relevantMovements = movements
    .filter((movement) => {
      const key = monthKeyFromIso(movement.postedDate);
      return key && compareMonthKey(key, orderedMonthKeys[orderedMonthKeys.length - 1]) <= 0;
    })
    .sort((left, right) => (left.postedDate || '').localeCompare(right.postedDate || ''));

  let runningBalance = clampMoney(
    openingBalance +
      relevantMovements
        .filter((movement) => {
          const key = monthKeyFromIso(movement.postedDate);
          return (
            movement.postedDate &&
            movement.postedDate > openingDate &&
            key &&
            compareMonthKey(key, orderedMonthKeys[0]) < 0
          );
        })
        .reduce((sum, movement) => sum + (movement.direction === 'in' ? movement.amount : -movement.amount), 0),
  );

  return orderedMonthKeys.map((monthKey) => {
    const monthRows = relevantMovements.filter((movement) => monthKeyFromIso(movement.postedDate) === monthKey);
    const opening = runningBalance;
    const sectionTotals = {
      operating: 0,
      investing: 0,
      financing: 0,
    };
    const lineMap = new Map();

    monthRows.forEach((movement) => {
      const classification = classifyCashFlowMovement(movement);
      const signedAmount = movement.direction === 'in' ? movement.amount : -movement.amount;
      sectionTotals[classification.sectionKey] += signedAmount;
      const lineKey = `${classification.sectionKey}:${classification.lineKey}`;
      const current = lineMap.get(lineKey) || {
        ...classification,
        amount: 0,
      };
      current.amount += signedAmount;
      lineMap.set(lineKey, current);
    });

    const operating = clampMoney(sectionTotals.operating);
    const investing = clampMoney(sectionTotals.investing);
    const financing = clampMoney(sectionTotals.financing);
    const netChange = clampMoney(operating + investing + financing);
    const closing = clampMoney(opening + netChange);
    runningBalance = closing;

    return {
      key: monthKey,
      label: formatMonthLabel(monthKey),
      openingBalance: clampMoney(opening),
      operating,
      investing,
      financing,
      netChange,
      closingBalance: closing,
      lines: Array.from(lineMap.values())
        .map((line) => ({ ...line, amount: clampMoney(line.amount) }))
        .sort((left, right) => right.amount - left.amount),
    };
  });
};

export const buildCashFlowSectionSummary = (movements) => {
  const sectionMap = new Map();

  movements.forEach((movement) => {
    const classification = classifyCashFlowMovement(movement);
    const signedAmount = movement.direction === 'in' ? movement.amount : -movement.amount;
    const sectionKey = classification.sectionKey;
    const currentSection = sectionMap.get(sectionKey) || {
      sectionKey,
      sectionLabel: classification.sectionLabel,
      total: 0,
      lines: new Map(),
    };
    currentSection.total += signedAmount;

    const currentLine = currentSection.lines.get(classification.lineKey) || {
      lineKey: classification.lineKey,
      lineLabel: classification.lineLabel,
      amount: 0,
    };
    currentLine.amount += signedAmount;
    currentSection.lines.set(classification.lineKey, currentLine);
    sectionMap.set(sectionKey, currentSection);
  });

  return Array.from(sectionMap.values()).map((section) => ({
    sectionKey: section.sectionKey,
    sectionLabel: section.sectionLabel,
    total: clampMoney(section.total),
    lines: Array.from(section.lines.values())
      .map((line) => ({ ...line, amount: clampMoney(line.amount) }))
      .sort((left, right) => Math.abs(right.amount) - Math.abs(left.amount)),
  }));
};

const buildEmptyPnlBucket = () => ({
  operatingRevenue: 0,
  otherIncome: 0,
  directCosts: 0,
  payroll: 0,
  services: 0,
  rentFacilities: 0,
  vehiclesTravel: 0,
  taxes: 0,
  otherOperating: 0,
  financialIncome: 0,
  financial: 0,
  capexExcluded: 0,
});

const finalizePnlBucket = (bucket) => {
  const revenue = clampMoney(bucket.operatingRevenue + bucket.otherIncome);
  const grossProfit = clampMoney(revenue - bucket.directCosts);
  const operatingExpenses = clampMoney(
    bucket.payroll +
      bucket.services +
      bucket.rentFacilities +
      bucket.vehiclesTravel +
      bucket.taxes +
      bucket.otherOperating,
  );
  const operatingResult = clampMoney(grossProfit - operatingExpenses);
  const financialResult = clampMoney(bucket.financialIncome - bucket.financial);
  const netResult = clampMoney(operatingResult + financialResult);

  return {
    ...bucket,
    revenue,
    grossProfit,
    operatingExpenses,
    operatingResult,
    financialResult,
    netResult,
  };
};

export const buildProfitLossSummary = (movements) => {
  const bucket = buildEmptyPnlBucket();

  movements.forEach((movement) => {
    const classification = classifyProfitLossMovement(movement);
    if (!classification.includeInPnl) {
      bucket.capexExcluded += movement.amount;
      return;
    }
    bucket[classification.lineKey] += movement.amount;
  });

  return finalizePnlBucket(
    Object.fromEntries(Object.entries(bucket).map(([key, value]) => [key, clampMoney(value)])),
  );
};

export const buildProfitLossByMonth = (movements, monthKeys = []) => {
  const orderedMonthKeys = Array.from(new Set(monthKeys.filter(Boolean))).sort(compareMonthKey);
  return orderedMonthKeys.map((monthKey) => {
    const monthMovements = movements.filter((movement) => monthKeyFromIso(movement.postedDate) === monthKey);
    return {
      key: monthKey,
      label: formatMonthLabel(monthKey),
      ...buildProfitLossSummary(monthMovements),
    };
  });
};

export const getMonthKey = monthKeyFromIso;
export const getMonthLabel = formatMonthLabel;
