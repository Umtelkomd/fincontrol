import { describe, expect, it } from 'vitest';
import {
  derivePeriodStatus,
  statusLabel,
  statusBadgeTone,
  periodStatusTransition,
} from './payrollStatus.js';

// ─── derivePeriodStatus ───────────────────────────────────────────────────────

describe('derivePeriodStatus', () => {
  it('returns borrador when there are no obligations', () => {
    expect(derivePeriodStatus([])).toBe('borrador');
  });

  it('returns cargada when all obligations are issued (none settled)', () => {
    const obs = [{ liveStatus: 'issued' }, { liveStatus: 'issued' }, { liveStatus: 'overdue' }];
    expect(derivePeriodStatus(obs)).toBe('cargada');
  });

  it('returns pagada when every obligation is settled', () => {
    const obs = [{ liveStatus: 'settled' }, { liveStatus: 'settled' }];
    expect(derivePeriodStatus(obs)).toBe('pagada');
  });

  it('treats cancelled as terminal alongside settled for pagada', () => {
    const obs = [{ liveStatus: 'settled' }, { liveStatus: 'cancelled' }];
    expect(derivePeriodStatus(obs)).toBe('pagada');
  });

  it('returns cancelada (not pagada) when every obligation is cancelled and none settled', () => {
    const obs = [{ liveStatus: 'cancelled' }, { liveStatus: 'cancelled' }];
    expect(derivePeriodStatus(obs)).toBe('cancelada');
  });

  it('returns parcial when some are settled and some are still open', () => {
    const obs = [{ liveStatus: 'settled' }, { liveStatus: 'issued' }];
    expect(derivePeriodStatus(obs)).toBe('parcial');
  });

  it('returns parcial when any obligation is partial', () => {
    const obs = [{ liveStatus: 'partial' }, { liveStatus: 'issued' }];
    expect(derivePeriodStatus(obs)).toBe('parcial');
  });
});

// ─── statusLabel / statusBadgeTone ────────────────────────────────────────────

describe('statusLabel', () => {
  it('maps each status to its Spanish label', () => {
    expect(statusLabel('borrador')).toBe('Borrador');
    expect(statusLabel('cargada')).toBe('Cargada');
    expect(statusLabel('parcial')).toBe('Parcial');
    expect(statusLabel('pagada')).toBe('Pagada');
  });
});

describe('statusBadgeTone', () => {
  it('maps each status to a nexus Badge tone', () => {
    expect(statusBadgeTone('borrador')).toBe('neutral');
    expect(statusBadgeTone('cargada')).toBe('info');
    expect(statusBadgeTone('parcial')).toBe('warn');
    expect(statusBadgeTone('pagada')).toBe('ok');
  });
});

// ─── periodStatusTransition ───────────────────────────────────────────────────

describe('periodStatusTransition', () => {
  it('produces a stable audit detail string', () => {
    expect(periodStatusTransition('cargada', 'parcial')).toBe(
      'Estado del período: Cargada → Parcial',
    );
  });
});
