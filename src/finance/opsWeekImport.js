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

import { canonicalizeProjectCode, projectCodesMatch } from './projectCodeAliases.js';
import {
  cxcSourceKey,
  cxpSourceKey,
  resolveProjectIdByCode,
  sourceKeyFromOpsRow,
} from './lumenContract.js';

const REQUIRED = ['kind', 'week', 'counterparty', 'amount'];

export const OPS_WEEK_CSV_TEMPLATE = [
  'kind,week,project_code,project_id,counterparty,amount,description,document_number,due_date,crew,source_key,lumen_work_order_id,lumen_cycle_id',
  'clear,2026-W29,QFF,,Melgarejo,5000,Ciclo publicado,,,Melgarejo,lumen:cxp:cycle-abc,,abc',
  'cxc,2026-W29,NE4,,Insyte,15000,client_accepted WO-1,WO-1,,,lumen:cxc:wo-wo1,wo1,',
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
      sourceKey: String(row.source_key || '').trim(),
      lumenWorkOrderId: String(row.lumen_work_order_id || '').trim(),
      lumenCycleId: String(row.lumen_cycle_id || '').trim(),
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
 * Project codes are compared via Lumen↔FinControl alias map.
 */
export function matchClearRowsToPayables(clearRows, payables, projects = []) {
  const projectByCode = new Map();
  projects.forEach((p) => {
    const code = canonicalizeProjectCode(p.code || p.codigo || p.name || p.displayName || '');
    if (code) projectByCode.set(code, p);
  });

  return clearRows.map((row) => {
    const rowCanon = canonicalizeProjectCode(row.projectCode);
    const targetProjectId =
      row.projectId ||
      (rowCanon ? projectByCode.get(rowCanon)?.id : '') ||
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
        else if (row.projectCode && projectCodesMatch(row.projectCode, p.projectName)) score += 25;
        else if (row.projectCode && projectCodesMatch(row.projectCode, p.projectId)) score += 15;
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
  return cxcRows.map((row) => {
    const resolved = resolveProjectIdByCode(projects, row.projectCode);
    const sourceKey =
      sourceKeyFromOpsRow({
        kind: 'cxc',
        source_key: row.sourceKey,
        lumen_work_order_id: row.lumenWorkOrderId,
      }) ||
      (row.documentNumber ? cxcSourceKey(row.documentNumber) : '') ||
      `lumen:cxc:line-${row.week}-${row.line}`;

    return {
      row,
      payload: {
        client: row.counterparty,
        amount: row.amount,
        projectId: row.projectId || resolved.projectId || '',
        projectName: resolved.projectName || row.projectCode || '',
        projectCode: resolved.projectCode || canonicalizeProjectCode(row.projectCode),
        description: row.description || `Producción ${row.week}`,
        documentNumber: row.documentNumber || `DRAFT-${row.week}-${row.line}`,
        issueDate: new Date().toISOString().slice(0, 10),
        dueDate: row.dueDate || '',
        notes: `ops-week import ${row.week}${row.crew ? ` · crew ${row.crew}` : ''}`,
        productionWeekRef: row.week,
        source: 'lumen',
        sourceSystem: 'lumen',
        sourceKey,
        lumenWorkOrderId: row.lumenWorkOrderId || '',
        lumenOrderNumber: row.documentNumber || '',
      },
    };
  });
}

/** Build CXP upsert payloads from clear rows (cycle close). */
export function buildCxpDraftsFromClearRows(clearRows, projects = []) {
  return clearRows.map((row) => {
    const resolved = resolveProjectIdByCode(projects, row.projectCode);
    const sourceKey =
      sourceKeyFromOpsRow({
        kind: 'clear',
        source_key: row.sourceKey,
        lumen_cycle_id: row.lumenCycleId,
      }) ||
      (row.lumenCycleId ? cxpSourceKey(row.lumenCycleId) : '') ||
      `lumen:cxp:line-${row.week}-${row.line}`;

    return {
      row,
      payload: {
        vendor: row.counterparty,
        amount: row.amount,
        projectId: row.projectId || resolved.projectId || '',
        projectName: resolved.projectName || row.projectCode || '',
        projectCode: resolved.projectCode || canonicalizeProjectCode(row.projectCode),
        description: row.description || `Ciclo ${row.week}`,
        documentNumber: row.documentNumber || '',
        dueDate: row.dueDate || '',
        productionWeekRef: row.week,
        source: 'lumen',
        sourceSystem: 'lumen',
        sourceKey,
        lumenCycleId: row.lumenCycleId || '',
        opsGateRequired: true,
        opsCleared: true,
      },
    };
  });
}
