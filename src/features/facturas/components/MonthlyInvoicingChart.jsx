/**
 * Monthly invoicing vs. cash chart for the Facturas view.
 *
 * `cobrado`/`pagado` are realized cash (from postedMovements); `facturado`/
 * `recibido` are invoice-issued totals (from receivables/payables) — an
 * invoice issued this month can be collected or paid in a later one, so the
 * two pairs intentionally diverge. See buildMonthlySeries for the exact math.
 */
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { buildMonthlySeries } from '../../../finance/monthlySeries';
import { formatCurrency } from '../../../utils/formatters';

const isAllZero = (series) =>
  series.every((row) => row.cobrado === 0 && row.pagado === 0 && row.facturado === 0 && row.recibido === 0);

const MonthlyInvoicingChart = ({ movements = [], receivables = [], payables = [] }) => {
  const series = buildMonthlySeries({ movements, receivables, payables, months: 12 });
  const empty = series.length === 0 || isAllZero(series);

  return (
    <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-bg-1)] p-4">
      <p className="label-mono text-[var(--color-fg-3)]">
        Últimos 12 meses · facturado vs. cobrado vs. pagado
      </p>
      {empty ? (
        <p className="mt-6 py-8 text-center label-mono text-[var(--color-fg-3)]">Sin datos</p>
      ) : (
        <div className="mt-4">
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={series}>
              <CartesianGrid stroke="var(--color-line)" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fill: 'var(--color-fg-4)', fontSize: 11 }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                tick={{ fill: 'var(--color-fg-4)', fontSize: 11 }}
                tickFormatter={(value) => `${Math.round(value / 1000)}k`}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                formatter={(value) => formatCurrency(value)}
                contentStyle={{
                  backgroundColor: 'var(--color-bg-2)',
                  color: 'var(--color-fg-1)',
                  border: '1px solid var(--color-line)',
                  borderRadius: 6,
                }}
              />
              <Legend />
              <Bar dataKey="cobrado" fill="var(--color-ok)" radius={0} name="Cobrado" />
              <Bar dataKey="pagado" fill="var(--color-fg-3)" radius={0} name="Pagado" />
              <Line
                type="monotone"
                dataKey="facturado"
                stroke="var(--color-accent)"
                strokeWidth={2.5}
                dot={{ r: 3 }}
                name="Facturado"
              />
              <Line
                type="monotone"
                dataKey="recibido"
                stroke="var(--color-info)"
                strokeWidth={2}
                strokeDasharray="4 4"
                dot={{ r: 3 }}
                name="Recibido"
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
};

export default MonthlyInvoicingChart;
