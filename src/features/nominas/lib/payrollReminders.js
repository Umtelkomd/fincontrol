/**
 * Due-date reminders — pure logic for escalating SV + Lohnsteuer reminders.
 *
 * Severity escalates as the real parsed Fälligkeit approaches:
 *   info — more than 7 banking days away
 *   warn — 3 to 7 banking days away
 *   err  — fewer than 3 banking days away, or overdue
 *
 * buildDueReminders maps the open SV (Krankenkassen) + LSt obligations to a
 * sanitizer-safe reminder descriptor. Net wages are excluded (no statutory
 * deadline reminder). The hook turns these into createNotification calls and is
 * responsible for dedup (relatedEntity + dueDate + severity).
 */

import { bankingDaysBetween } from './bankingCalendar.js';

const REMINDER_KINDS = new Set(['krankenkasse', 'tax']);
const TERMINAL = new Set(['settled', 'cancelled', 'void', 'paid']);

const KIND_LABEL = {
  krankenkasse: 'Seguridad social (KK)',
  tax: 'Lohnsteuer',
};

/**
 * Escalation tier for a due date relative to today, counted in banking days.
 * @param {string} dueIso
 * @param {string} todayIso
 * @returns {'info'|'warn'|'err'}
 */
export const reminderSeverityForDueDate = (dueIso, todayIso) => {
  const days = bankingDaysBetween(todayIso, dueIso);
  if (days < 3) return 'err'; // includes overdue (negative)
  if (days <= 7) return 'warn';
  return 'info';
};

/**
 * Build reminder descriptors for the open SV + LSt obligations.
 * @param {Array<object>} payrollPayables
 * @param {string} todayIso
 * @returns {Array<{
 *   payableId:string, payrollKind:string, payrollPeriodId:string,
 *   dueDate:string, severity:string, title:string, message:string
 * }>}
 */
export const buildDueReminders = (payrollPayables, todayIso) => {
  return (payrollPayables || [])
    .filter((p) => REMINDER_KINDS.has(p.payrollKind))
    .filter((p) => !TERMINAL.has(p.status))
    .filter((p) => Boolean(p.dueDate))
    .map((p) => {
      const severity = reminderSeverityForDueDate(p.dueDate, todayIso);
      const label = KIND_LABEL[p.payrollKind] || p.payrollKind;
      const vendor = p.vendor || p.counterpartyName || label;
      return {
        payableId: p.id || '',
        payrollKind: p.payrollKind,
        payrollPeriodId: p.payrollPeriodId || '',
        dueDate: p.dueDate,
        severity,
        title: `Vencimiento ${label}`,
        message: `${vendor} vence el ${p.dueDate}.`,
      };
    });
};

export default { reminderSeverityForDueDate, buildDueReminders };
