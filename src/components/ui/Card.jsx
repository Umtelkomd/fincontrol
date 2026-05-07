import { formatCurrency } from '../../utils/formatters';

const Card = ({ title, amount, icon, subtext, alert, trend }) => {
 const Icon = icon;
 const isNegative = amount < 0;

 const trendSymbol = trend === 'up' ? '↑' : trend === 'down' ? '↓' : null;
 const trendColor =
 trend === 'up' ? 'text-[var(--color-ok)]' : trend === 'down' ? 'text-[var(--color-err)]' : '';

 return (
 <div
 className={`px-5 py-4 border transition-colors ${
 alert
 ? 'border-l-2 border-l-[var(--color-accent)] border-[var(--color-line)] bg-[var(--color-bg-1)]'
 : 'border-[var(--color-line)] bg-[var(--color-bg-1)] hover:border-[var(--color-line-s)]'
 } rounded-md`}
 >
 <div className="flex items-start justify-between">
 <div className="flex-1 min-w-0">
 <p className="label-mono text-[var(--color-fg-3)] mb-2">
 {title}
 </p>
 <p
 className={`font-mono text-[22px] tabular-nums tracking-tight ${
 isNegative ? 'text-[var(--color-err)]' : 'text-[var(--color-fg-1)]'
 }`}
 >
 {formatCurrency(amount)}
 </p>
 {(subtext || trendSymbol) && (
 <div className="flex items-center gap-1.5 mt-2">
 {trendSymbol && (
 <span className={`font-mono text-[11px] ${trendColor}`}>{trendSymbol}</span>
 )}
 {subtext && (
 <p className="font-mono text-[11px] text-[var(--color-fg-4)]">{subtext}</p>
 )}
 </div>
 )}
 </div>
 <Icon size={16} className="text-[var(--color-fg-4)] flex-shrink-0 mt-0.5" />
 </div>

 {alert && (
 <div className="mt-3 pt-3 border-t border-[var(--color-line)]">
 <p className="label-mono text-[var(--color-err)]">
 [ATENCION]
 </p>
 </div>
 )}
 </div>
 );
};

export default Card;
