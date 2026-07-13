/**
 * F1 — weekly production bridge CSV (ops week).
 *
 * Template columns:
 *   kind,week,project_code,project_id,counterparty,amount,description,document_number,due_date,crew
 *
 * kind:
 *   clear — mark matching open CXP as opsCleared for that week
 *   cxc   — create CXC draft (receivable) for client billing
 */

const REQUIRED = ['kind', 'week', 'counterparty', 'amount'];

export const OPS_WEEK_CSV_TEMPLATE = [
  'kind,week,project_code,project_id,counterparty,amount,description,document_number,due_date,crew',
  'clear,2026-W29,PROY-004,,Melgarejo,5000,Producción validada KW29,,,Melgarejo',
  'cxc,2026-W29,PROY-004,,Insyte,15000,Leistungsnachweis KW29,LN-2026-W29,2026-08-20,',
].join('\n');

const normalizeHeader = (h) =>
  String(h || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');

/** Minimal CSV split supporting quoted fields. */
export function parseCsv(text) {
  const lines = String(text || '')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return { headers: [], rows: [] };

  const splitLine = (line) => {
    const cells = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === ',' && !inQuotes) {
        cells.push(cur.trim());
        cur = '';
      } else {
        cur += ch;
      }
    }
    cells.push(cur.trim());
    return cells;
  };

  const headers = splitLine(lines[0]).map(normalizeHeader);
  const rows = lines.slice(1).map((line, index) => {
    const cells = splitLine(line);
    const obj = { _line: index + 2 };
    headers.forEach((h, i) => {
      obj[h] = cells[i] ?? '';
    });
    return obj;
  });
  return { headers, rows };
}

export function parseOpsWeekCsv(text) {
  const { headers, rows } = parseCsv(text);
  const missing = REQUIRED.filter((h) => !headers.includes(h));
  if (missing.length) {
    return {
      ok: false,
      error: `CSV incompleto. Faltan columnas: ${missing.join(', ')}`,
      rows: [],
    };
  }

  const parsed = [];
  const errors = [];

  rows.forEach((row) => {
    const kind = String(row.kind || '')
      .trim()
      .toLowerCase();
    if (kind !== 'clear' && kind !== 'cxc') {
      errors.push(`L${row._line}: kind debe ser clear o cxc (recibido "${row.kind}")`);
      return;
    }
    const amount = Number(String(row.amount).replace(',', '.'));
    if (!Number.isFinite(amount) || amount <= 0) {
      errors.push(`L${row._line}: amount inválido`);
      return;
    }
    const week = String(row.week || '').trim();
    if (!/^\d{4}-W\d{2}$/i.test(week)) {
      errors.push(`L${row._line}: week debe ser YYYY-Www (ej. 2026-W29)`);
      return;
    }
    const counterparty = String(row.counterparty || '').trim();
    if (!counterparty) {
      errors.push(`L${row._line}: counterparty vacío`);
      return;
    }

    parsed.push({
      kind,
      week: week.toUpperCase(),
      projectCode: String(row.project_code || '').trim(),
      projectId: String(row.project_id || '').trim(),
      counterparty,
      amount,
      description: String(row.description || '').trim(),
      documentNumber: String(row.document_number || '').trim(),
      dueDate: String(row.due_date || '').trim(),
      crew: String(row.crew || '').trim(),
      line: row._line,
    });
  });

  if (!parsed.length) {
    return { ok: false, error: errors[0] || 'Sin filas válidas', rows: [], errors };
  }

  return { ok: true, rows: parsed, errors };
}

const norm = (s) =>
  String(s || '')
    .trim()
    .toLowerCase();

/**
 * Match a clear-row to open payables.
 * Score: counterparty name + optional project id/code + optional amount tolerance.
 */
export function matchClearRowsToPayables(clearRows, payables, projects = []) {
  const projectByCode = new Map();
  projects.forEach((p) => {
    const code = norm(p.code || p.codigo);
    if (code) projectByCode.set(code, p);
  });

  return clearRows.map((row) => {
    const targetProjectId =
      row.projectId ||
      projectByCode.get(norm(row.projectCode))?.id ||
      '';

    const open = (payables || []).filter((p) => {
      if (p.status === 'cancelled' || p.status === 'settled') return false;
      if ((Number(p.openAmount) || 0) <= 0.01) return false;
      if (p.payrollPeriodId || p.payrollKind) return false;
      return true;
    });

    const candidates = open
      .map((p) => {
        let score = 0;
        if (norm(p.counterpartyName) === norm(row.counterparty) || norm(p.vendor) === norm(row.counterparty)) {
          score += 50;
        } else if (
          norm(p.counterpartyName).includes(norm(row.counterparty)) ||
          norm(row.counterparty).includes(norm(p.counterpartyName))
        ) {
          score += 30;
        } else {
          return { payable: p, score: 0 };
        }
        if (targetProjectId && p.projectId === targetProjectId) score += 30;
        else if (row.projectCode && norm(p.projectName).includes(norm(row.projectCode))) score += 15;
        const openAmt = Number(p.openAmount) || 0;
        if (Math.abs(openAmt - row.amount) < 0.5) score += 20;
        else if (Math.abs(openAmt - row.amount) / Math.max(openAmt, row.amount) < 0.05) score += 10;
        if (row.week && String(p.productionWeekRef || '').toUpperCase() === row.week) score += 10;
        return { payable: p, score };
      })
      .filter((c) => c.score >= 50)
      .sort((a, b) => b.score - a.score);

    const best = candidates[0] || null;
    return {
      row,
      match: best,
      candidates: candidates.slice(0, 5),
      alreadyCleared: Boolean(best?.payable?.opsCleared),
    };
  });
}

/**
 * Build receivable payloads for cxc rows (not yet written).
 */
export function buildCxcDraftsFromRows(cxcRows, projects = []) {
  const projectByCode = new Map();
  projects.forEach((p) => {
    const code = norm(p.code || p.codigo);
    if (code) projectByCode.set(code, p);
  });

  return cxcRows.map((row) => {
    const project =
      (row.projectId && projects.find((p) => p.id === row.projectId)) ||
      projectByCode.get(norm(row.projectCode)) ||
      null;
    return {
      row,
      payload: {
        client: row.counterparty,
        amount: row.amount,
        projectId: row.projectId || project?.id || '',
        projectName:
          project?.displayName ||
          project?.name ||
          row.projectCode ||
          '',
        description: row.description || `Producción ${row.week}`,
        documentNumber: row.documentNumber || `DRAFT-${row.week}-${row.line}`,
        issueDate: new Date().toISOString().slice(0, 10),
        dueDate: row.dueDate || '',
        notes: `ops-week import ${row.week}${row.crew ? ` · crew ${row.crew}` : ''}`,
        productionWeekRef: row.week,
        source: 'ops-week-import',
      },
    };
  });
}
