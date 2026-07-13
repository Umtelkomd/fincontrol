import { describe, expect, it } from 'vitest';
import {
  buildCxcDraftsFromRows,
  matchClearRowsToPayables,
  OPS_WEEK_CSV_TEMPLATE,
  parseOpsWeekCsv,
} from './opsWeekImport';

describe('parseOpsWeekCsv', () => {
  it('parses the template', () => {
    const result = parseOpsWeekCsv(OPS_WEEK_CSV_TEMPLATE);
    expect(result.ok).toBe(true);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].kind).toBe('clear');
    expect(result.rows[1].kind).toBe('cxc');
  });

  it('rejects bad kind', () => {
    const csv = 'kind,week,project_code,project_id,counterparty,amount,description,document_number,due_date,crew\nbad,2026-W01,,,X,10,,,,';
    const result = parseOpsWeekCsv(csv);
    expect(result.ok).toBe(false);
  });
});

describe('matchClearRowsToPayables', () => {
  it('matches by vendor name and amount', () => {
    const matches = matchClearRowsToPayables(
      [{ kind: 'clear', week: '2026-W29', counterparty: 'Melgarejo', amount: 5000, projectCode: '', projectId: '' }],
      [
        {
          id: '1',
          counterpartyName: 'Melgarejo',
          openAmount: 5000,
          status: 'issued',
          projectId: 'p1',
        },
      ],
    );
    expect(matches[0].match?.payable.id).toBe('1');
  });
});

describe('buildCxcDraftsFromRows', () => {
  it('builds receivable payloads with sourceKey', () => {
    const drafts = buildCxcDraftsFromRows(
      [
        {
          kind: 'cxc',
          week: '2026-W29',
          counterparty: 'Insyte',
          amount: 15000,
          projectCode: 'NE4',
          projectId: '',
          description: 'LN',
          documentNumber: 'WO-1',
          dueDate: '2026-08-01',
          crew: '',
          lumenWorkOrderId: 'wo-uuid',
          line: 2,
        },
      ],
      [{ id: 'px', code: 'NE4', name: 'NE4' }],
    );
    expect(drafts[0].payload.client).toBe('Insyte');
    expect(drafts[0].payload.projectId).toBe('px');
    expect(drafts[0].payload.amount).toBe(15000);
    expect(drafts[0].payload.sourceKey).toBe('lumen:cxc:wo-uuid');
  });
});
