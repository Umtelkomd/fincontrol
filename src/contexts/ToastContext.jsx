import { createContext, useContext, useState, useCallback, useRef } from 'react';
import { CheckCircle, XCircle, AlertTriangle, Info, X } from 'lucide-react';

const ToastContext = createContext(null);

let toastId = 0;

const ICONS = {
 success: CheckCircle,
 error: XCircle,
 warning: AlertTriangle,
 info: Info,
};

const STYLES = {
 success: 'bg-[var(--color-bg-1)] border-[var(--color-ok)] text-[var(--color-ok)]',
 error: 'bg-[var(--color-bg-1)] border-[var(--color-accent)] text-[var(--color-accent)]',
 warning: 'bg-[var(--color-bg-1)] border-[var(--color-warn)] text-[var(--color-warn)]',
 info: 'bg-[var(--color-bg-1)] border-[var(--color-accent)] text-[var(--color-accent)]',
};

const DURATIONS = {
 success: 3000,
 error: 8000,
 warning: 5000,
 info: 4000,
};

export const ToastProvider = ({ children }) => {
 const [toasts, setToasts] = useState([]);
 const timersRef = useRef({});

 const removeToast = useCallback((id) => {
 if (timersRef.current[id]) {
 clearTimeout(timersRef.current[id]);
 delete timersRef.current[id];
 }
 setToasts(prev => prev.filter(t => t.id !== id));
 }, []);

 const showToast = useCallback((message, type = 'success', options = {}) => {
 const id = ++toastId;
 const duration = options.duration || DURATIONS[type] || 3000;
 const persist = options.persist || type === 'error';

 setToasts(prev => [...prev.slice(-4), { id, message, type }]);

 if (!persist) {
 timersRef.current[id] = setTimeout(() => removeToast(id), duration);
 }

 return id;
 }, [removeToast]);

 return (
 <ToastContext.Provider value={{ showToast, removeToast }}>
 {children}
 {/* Toast Container */}
 <div className="fixed bottom-4 right-4 z-[400] flex flex-col gap-2 max-w-[400px]" aria-live="assertive">
 {toasts.map((toast) => {
 const Icon = ICONS[toast.type];
 return (
 <div
 key={toast.id}
 className={`flex items-center gap-3 px-4 py-3 rounded-md border animate-slideInRight ${STYLES[toast.type]}`}
 style={{ boxShadow: '0 8px 32px rgba(0,0,0,0.4)' }}
 >
 <Icon className="w-5 h-5 flex-shrink-0" />
 <p className="text-sm font-medium flex-1">{toast.message}</p>
 <button
 onClick={() => removeToast(toast.id)}
 className="p-1 hover:bg-[var(--color-bg-2)] rounded-lg transition-colors flex-shrink-0"
 >
 <X className="w-3.5 h-3.5 opacity-60" />
 </button>
 </div>
 );
 })}
 </div>
 </ToastContext.Provider>
 );
};

// eslint-disable-next-line react-refresh/only-export-components
export const useToast = () => {
 const ctx = useContext(ToastContext);
 if (!ctx) throw new Error('useToast must be used within ToastProvider');
 return ctx;
};
