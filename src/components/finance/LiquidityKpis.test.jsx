/**
 * LiquidityKpis — the three numbers every cockpit shares.
 *
 * Caja / Posición neta / Runway used to be rendered by three screens with
 * three label sets ("Caja actual", "Liquidez proyectada", "Cobertura de caja")
 * and one of them printed "-0.3 meses". This component is the single place
 * those labels and their copy live.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import LiquidityKpis from './LiquidityKpis.jsx';

const metricsFixture = (overrides = {}) => ({
  currentCash: 52000,
  netPosition: 58000,
  runwayMonths: 4.2,
  cashSource: 'anchors',
  cashMeta: { anchor: { date: '2026-05-31' }, lastMovementDate: '2026-08-28' },
  ...overrides,
});

describe('LiquidityKpis', () => {
  it('renders the three shared labels with the same values every screen shows', () => {
    render(<LiquidityKpis metrics={metricsFixture()} forecast={{ weeksToNegative: null }} />);

    expect(screen.getByText('Caja')).toBeInTheDocument();
    expect(screen.getByText('52.000,00')).toBeInTheDocument();
    expect(screen.getByText('Posición neta')).toBeInTheDocument();
    expect(screen.getByText('58.000,00')).toBeInTheDocument();
    expect(screen.getByText('Runway')).toBeInTheDocument();
    expect(screen.getByText('4,2 meses')).toBeInTheDocument();
  });

  it('states the anchor the cash figure is reconciled to', () => {
    render(<LiquidityKpis metrics={metricsFixture()} />);

    expect(screen.getByText('Conciliado al 31/05/2026 · últ. mov. 28/08/2026')).toBeInTheDocument();
  });

  it('warns instead of pretending when no anchor exists', () => {
    render(<LiquidityKpis metrics={metricsFixture({ cashSource: 'legacy', cashMeta: { anchor: null } })} />);

    expect(screen.getByText(/^Sin conciliar/)).toBeInTheDocument();
  });

  it('prefers the forecast wall over the average-burn months', () => {
    render(<LiquidityKpis metrics={metricsFixture()} forecast={{ weeksToNegative: 6 }} />);

    expect(screen.getByText('6 sem.')).toBeInTheDocument();
    expect(screen.queryByText('4,2 meses')).not.toBeInTheDocument();
  });

  it('never prints negative months when the cash is below zero', () => {
    render(
      <LiquidityKpis
        metrics={metricsFixture({ currentCash: -1200, netPosition: -900, runwayMonths: -0.3 })}
        forecast={{ weeksToNegative: 0 }}
      />,
    );

    expect(screen.getByText('Bajo cero')).toBeInTheDocument();
    expect(screen.getByText('La caja ya está en negativo')).toBeInTheDocument();
    expect(screen.queryByText(/-0,3|−0,3|0 sem\./)).not.toBeInTheDocument();
  });

  it('accepts an explicit cashMeta for callers that hold it apart from the metrics', () => {
    render(
      <LiquidityKpis
        metrics={metricsFixture({ cashMeta: undefined })}
        cashMeta={{ anchor: { date: '2026-06-30' }, lastMovementDate: '2026-07-01' }}
      />,
    );

    expect(screen.getByText('Conciliado al 30/06/2026 · últ. mov. 01/07/2026')).toBeInTheDocument();
  });
});
