import { useState } from 'react';
import { X, AlertTriangle } from 'lucide-react';

const ConfirmModal = ({
 isOpen,
 onClose,
 onConfirm,
 title,
 message,
 confirmText = 'Eliminar',
 cancelText = 'Cancelar',
 variant = 'danger',
 details = [],
 confirmKeyword = '',
 confirmKeywordLabel = 'Confirmación',
 confirmKeywordPlaceholder = '',
 warning = '',
}) => {
 const [confirmationValue, setConfirmationValue] = useState('');

 if (!isOpen) return null;

 const requiresKeyword = Boolean(confirmKeyword);
 const keywordMatches = !requiresKeyword || confirmationValue.trim().toUpperCase() === confirmKeyword.trim().toUpperCase();

 const handleClose = () => {
 setConfirmationValue('');
 onClose();
 };

 const handleConfirm = async () => {
 if (!keywordMatches) return;
 const shouldClose = await onConfirm();
 if (shouldClose !== false) {
 handleClose();
 }
 };

 const variantStyles = {
 danger: {
 icon: 'text-[var(--color-accent)]',
 button: 'border border-[var(--color-accent)] text-[var(--color-accent)] hover:bg-transparent'
 },
 warning: {
 icon: 'text-[var(--color-warn)]',
 button: 'border border-[var(--color-warn)] text-[var(--color-warn)] hover:bg-transparent'
 }
 };

 const style = variantStyles[variant] || variantStyles.danger;

 return (
 <div className="fixed inset-0 z-[200] flex items-center justify-center bg-[rgba(7,8,10,0.86)] backdrop-blur-sm p-4 animate-fadeIn" role="dialog" aria-modal="true">
 <div className="bg-[var(--color-bg-1)] border border-[var(--color-line-s)] rounded-md w-full max-w-md overflow-hidden animate-scaleIn">
 <div className="px-6 py-4 border-b border-[var(--color-line)] flex justify-between items-center">
 <h3 className="font-mono text-[13px] uppercase tracking-[0.06em] text-[var(--color-fg-1)]">{title}</h3>
 <button onClick={handleClose} className="text-[var(--color-fg-4)] hover:text-[var(--color-fg-3)] transition-colors" aria-label="Cerrar">
 <X size={20} />
 </button>
 </div>

 <div className="p-6">
 <div className="flex items-start gap-4">
 <div className="flex-shrink-0">
 <AlertTriangle className={style.icon} size={24} />
 </div>
 <div className="flex-1">
 <p className="text-[var(--color-fg-3)] text-sm leading-relaxed">{message}</p>

 {details.length > 0 && (
 <div className="mt-4 space-y-2 rounded-lg border border-[var(--color-line)] bg-[var(--color-bg-2)] p-3">
 {details.map((detail) => (
 <div key={`${detail.label}-${detail.value}`} className="flex items-center justify-between gap-3 text-[12px]">
 <span className="label-mono text-[var(--color-fg-4)]">{detail.label}</span>
 <span className={`text-right font-mono ${detail.emphasis ? 'text-[var(--color-fg-1)]' : 'text-[var(--color-fg-3)]'}`}>
 {detail.value}
 </span>
 </div>
 ))}
 </div>
 )}

 {warning && (
 <p className="mt-4 rounded-lg border border-[var(--color-warn)] px-3 py-2 text-[12px] leading-relaxed text-[var(--color-warn)]">
 {warning}
 </p>
 )}

 {requiresKeyword && (
 <label className="mt-4 block">
 <span className="mb-1.5 block label-mono text-[var(--color-fg-4)]">
 {confirmKeywordLabel}: escribe <span className="text-[var(--color-fg-1)]">{confirmKeyword}</span>
 </span>
 <input
 type="text"
 value={confirmationValue}
 onChange={(event) => setConfirmationValue(event.target.value)}
 placeholder={confirmKeywordPlaceholder || confirmKeyword}
 className="w-full rounded-lg border border-[var(--color-line-s)] bg-transparent px-3 py-2.5 text-sm font-mono text-[var(--color-fg-1)] focus:outline-none focus:border-[var(--color-fg-1)]"
 />
 </label>
 )}
 </div>
 </div>

 <div className="flex gap-3 mt-6">
 <button
 onClick={handleClose}
 className="flex-1 px-4 py-2.5 border border-[var(--color-line-s)] text-[var(--color-fg-3)] font-mono text-[13px] uppercase tracking-[0.06em] rounded-md transition-colors hover:border-[var(--color-fg-1)] hover:text-[var(--color-fg-1)]"
 >
 {cancelText}
 </button>
 <button
 onClick={handleConfirm}
 disabled={!keywordMatches}
 className={`flex-1 px-4 py-2.5 font-mono text-[13px] uppercase tracking-[0.06em] rounded-md transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${style.button}`}
 >
 {confirmText}
 </button>
 </div>
 </div>
 </div>
 </div>
 );
};

export default ConfirmModal;
