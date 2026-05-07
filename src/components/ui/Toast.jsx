import { useEffect } from 'react';
import { CheckCircle, XCircle, AlertTriangle, X, Info } from 'lucide-react';

const icons = {
 success: CheckCircle,
 error: XCircle,
 warning: AlertTriangle,
 info: Info
};

const styles = {
 success: 'border-[var(--color-ok)] text-[var(--color-ok)]',
 error: 'border-[var(--color-accent)] text-[var(--color-accent)]',
 warning: 'border-[var(--color-warn)] text-[var(--color-warn)]',
 info: 'border-[var(--color-fg-3)] text-[var(--color-fg-3)]'
};

export const Toast = ({ message, type = 'info', onClose, duration = 3000 }) => {
 const Icon = icons[type];

 useEffect(() => {
 const timer = setTimeout(onClose, duration);
 return () => clearTimeout(timer);
 }, [duration, onClose]);

 return (
 <div className="fixed bottom-4 right-4 z-50 animate-fadeIn">
 <div className={`flex items-center gap-3 px-4 py-3 rounded-lg border bg-[var(--color-bg-1)] min-w-[300px] ${styles[type]}`}>
 <Icon className="w-5 h-5 flex-shrink-0" />
 <p className="text-sm font-medium flex-1 text-[var(--color-fg-1)]">{message}</p>
 <button
 onClick={onClose}
 className="p-1 text-[var(--color-fg-4)] hover:text-[var(--color-fg-3)] transition-colors"
 >
 <X className="w-4 h-4" />
 </button>
 </div>
 </div>
 );
};

export default Toast;
