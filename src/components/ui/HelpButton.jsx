import { useState, useRef, useEffect } from 'react';
import { HelpCircle, X } from 'lucide-react';

const HelpButton = ({ title, children, size = 16 }) => {
 const [open, setOpen] = useState(false);
 const ref = useRef(null);

 useEffect(() => {
 if (!open) return;
 const handler = (e) => {
 if (ref.current && !ref.current.contains(e.target)) setOpen(false);
 };
 document.addEventListener('mousedown', handler);
 return () => document.removeEventListener('mousedown', handler);
 }, [open]);

 return (
 <span className="relative inline-flex" ref={ref}>
 <button
 type="button"
 onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
 className="inline-flex items-center justify-center text-[var(--color-fg-4)] hover:text-[var(--color-fg-3)] transition-colors"
 title="Ayuda"
 >
 <HelpCircle size={size} />
 </button>
 {open && (
 <div className="absolute right-0 top-full z-[300] mt-2 w-[320px] max-h-[400px] overflow-y-auto rounded-md border border-[var(--color-line-s)] bg-[var(--color-bg-1)] p-4 animate-fadeIn">
 <div className="flex items-start justify-between gap-2 mb-3">
 <h4 className="label-mono text-[var(--color-fg-1)]">{title}</h4>
 <button onClick={() => setOpen(false)} className="shrink-0 text-[var(--color-fg-4)] hover:text-[var(--color-fg-3)]">
 <X size={14} />
 </button>
 </div>
 <div className="text-[13px] leading-relaxed text-[var(--color-fg-3)] space-y-2">
 {children}
 </div>
 </div>
 )}
 </span>
 );
};

export default HelpButton;
