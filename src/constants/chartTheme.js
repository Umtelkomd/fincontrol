/**
 * Nothing Design System — Recharts Theme
 * Monochrome palette for all chart components.
 */
export const CHART_THEME = {
  grid: '#1F1F1F',
  axis: '#555555',
  axisFont: { fontFamily: "'Space Mono', monospace", fontSize: 11, fill: '#888888' },
  tooltip: {
    bg: '#1C1C1C',
    border: '#2E2E2E',
    text: '#D4D4D4',
    label: '#888888',
  },
  // Monochrome bar/area fills — ordered by brightness
  bars: ['#D4D4D4', '#888888', '#555555', '#444444', '#2E2E2E'],
  // Line chart strokes
  lines: ['#D4D4D4', '#555555', '#888888', '#444444'],
  // Status-specific (use sparingly)
  accent: '#5B9BF6',
  negative: '#C45A5A',
  success: '#5A9E6B',
  warning: '#C4A24E',
  neutral: '#888888',
};

// Replaces the old COLORS array from config.js for chart usage
export const CHART_COLORS = CHART_THEME.bars;
