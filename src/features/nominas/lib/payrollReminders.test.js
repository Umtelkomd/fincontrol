import { describe, expect, it } from 'vitest';
import { reminderSeverityForDueDate, buildDueReminders } from './payrollReminders.js';

// ─── reminderSeverityForDueDate (escalation by banking days to due) ───────────

describe('reminderSeverityForDueDate', () => {
  it('returns info when more than 7 banking days away', () => {
    // 2026-04-13 (Mon) → 2026-04-28 (Tue) is 11 banking days.
    expect(reminderSeverityForDueDate('2026-04-28', '2026-04-13')).toBe('info');
  });

  it('returns warn when between 3 and 7 banking days away', () => {
    // 2026-04-22 (Wed) → 2026-04-28 (Tue) is 4 banking days.
    expect(reminderSeverityForDueDate('2026-04-28', '2026-04-22')).toBe('warn');
  });

  it('returns err when fewer than 3 banking days away', () => {
    // 2026-04-27 (Mon) → 2026-04-28 (Tue) is 1 banking day.
    expect(reminderSeverityForDueDate('2026-04-28', '2026-04-27')).toBe('err');
  });

  it('returns err when overdue', () => {
    expect(reminderSeverityForDueDate('2026-04-28', '2026-05-02')).toBe('err');
  });
});

// ─── buildDueReminders ────────────────────────────────────────────────────────

describe('buildDueReminders', () => {
  const payables = [
    { id: 'kk1', payrollKind: 'krankenkasse', payrollPeriodId: 'P1', dueDate: '2026-04-28', amount: 7721.08, status: 'issued', vendor: 'BARMER' },
    { id: 'tax1', payrollKind: 'tax', payrollPeriodId: 'P1', dueDate: '2026-05-11', amount: 3742.93, status: 'issued', vendor: 'Finanzamt' },
    { id: 'wages1', payrollKind: 'wages', payrollPeriodId: 'P1', dueDate: '2026-04-30', amount: 21065.46, status: 'issued', vendor: 'Sueldos netos' },
  ];

  it('emits one reminder per SV + LSt obligation (not net wages)', () => {
    const reminders = buildDueReminders(payables, '2026-04-22');
    const kinds = reminders.map((r) => r.payrollKind).sort();
    expect(kinds).toEqual(['krankenkasse', 'tax']);
  });

  it('carries relatedEntity-ready fields and the correct severity', () => {
    const reminders = buildDueReminders(payables, '2026-04-27');
    const kk = reminders.find((r) => r.payrollKind === 'krankenkasse');
    expect(kk.payableId).toBe('kk1');
    expect(kk.payrollPeriodId).toBe('P1');
    expect(kk.dueDate).toBe('2026-04-28');
    expect(kk.severity).toBe('err'); // 1 banking day away
    expect(typeof kk.title).toBe('string');
    expect(typeof kk.message).toBe('string');
  });

  it('skips obligations that are already settled or cancelled', () => {
    const settled = payables.map((p) =>
      p.payrollKind === 'krankenkasse' ? { ...p, status: 'settled' } : p,
    );
    const reminders = buildDueReminders(settled, '2026-04-22');
    expect(reminders.find((r) => r.payrollKind === 'krankenkasse')).toBeUndefined();
    expect(reminders.find((r) => r.payrollKind === 'tax')).toBeDefined();
  });

  it('skips obligations with no due date', () => {
    const noDate = payables.map((p) =>
      p.payrollKind === 'tax' ? { ...p, dueDate: null } : p,
    );
    const reminders = buildDueReminders(noDate, '2026-04-22');
    expect(reminders.find((r) => r.payrollKind === 'tax')).toBeUndefined();
  });
});
