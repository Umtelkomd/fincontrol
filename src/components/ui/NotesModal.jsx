import { useState, useEffect } from 'react';
import { X, MessageSquare, FileText, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/nexus';

const safe = (v) => (v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));

const NotesModal = ({ isOpen, onClose, transaction, onAddNote }) => {
 const [newNote, setNewNote] = useState('');
 const [activeTab, setActiveTab] = useState('comments');

 // Reset tab when modal opens
 useEffect(() => {
 if (isOpen) {
 setTimeout(() => {
 setActiveTab('comments');
 setNewNote('');
 }, 0);
 }
 }, [isOpen]);

 const handleAddNote = () => {
 if (!newNote.trim()) return;
 onAddNote(transaction, newNote.trim());
 setNewNote('');
 };

 if (!isOpen || !transaction) return null;

 const comments = transaction.notes?.filter(n => n.type === 'comment') || [];
 const systemLogs = transaction.notes?.filter(n => n.type === 'system') || [];

 return (
 <div className="fixed inset-0 z-[200] flex items-center justify-center bg-[rgba(7,8,10,0.72)] p-4" role="dialog" aria-modal="true">
 <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] ">
 <div className="flex items-center justify-between border-b border-[var(--color-line)] bg-[var(--color-bg-2)] px-6 py-4">
 <div>
 <h3 className="flex items-center gap-2 text-lg font-medium tracking-[-0.03em] text-[var(--color-fg-1)]">
 <MessageSquare size={20} /> Notas y Comentarios
 </h3>
 <p className="mt-1 text-sm text-[var(--color-fg-3)]">{transaction.description}</p>
 </div>
 <button onClick={onClose} className="rounded-lg p-2 text-[var(--color-fg-3)] transition hover:bg-transparent hover:text-[var(--color-fg-4)]">
 <X size={20} />
 </button>
 </div>

 <div className="border-b border-[var(--color-line)]">
 <div className="flex">
 <button
 onClick={() => setActiveTab('comments')}
 className={`flex-1 px-6 py-3 text-sm font-medium transition-colors border-b-2 ${
 activeTab === 'comments'
 ? 'border-[var(--color-fg-1)] bg-transparent text-[var(--color-fg-1)]'
 : 'border-transparent text-[var(--color-fg-3)] hover:bg-transparent hover:text-[var(--color-fg-4)]'
 }`}
 >
 <div className="flex items-center justify-center gap-2">
 <MessageSquare size={16} />
 <span>Comentarios</span>
 {comments.length > 0 && (
 <span className="rounded-full bg-transparent px-2 py-0.5 text-xs text-[var(--color-fg-1)]">
 {comments.length}
 </span>
 )}
 </div>
 </button>
 <button
 onClick={() => setActiveTab('logs')}
 className={`flex-1 px-6 py-3 text-sm font-medium transition-colors border-b-2 ${
 activeTab === 'logs'
 ? 'border-[var(--color-fg-4)] bg-transparent text-[var(--color-fg-4)]'
 : 'border-transparent text-[var(--color-fg-3)] hover:bg-transparent hover:text-[var(--color-fg-4)]'
 }`}
 >
 <div className="flex items-center justify-center gap-2">
 <FileText size={16} />
 <span>Historial</span>
 {systemLogs.length > 0 && (
 <span className="rounded-full bg-transparent px-2 py-0.5 text-xs text-[var(--color-fg-4)]">
 {systemLogs.length}
 </span>
 )}
 </div>
 </button>
 </div>
 </div>

 <div className="flex-1 overflow-y-auto p-6 space-y-3">
 {activeTab === 'comments' ? (
 comments.length > 0 ? (
 comments.map((note, idx) => (
 <div key={idx} className="rounded-lg border border-[var(--color-line-s)] bg-[var(--color-bg-1)] p-4">
 <div className="flex items-start justify-between mb-2">
 <div className="flex items-center gap-2">
 <MessageSquare size={14} className="text-[var(--color-fg-1)]" />
 <span className="text-xs font-medium text-[var(--color-fg-1)]">
 {safe(note.user)}
 </span>
 </div>
 <span className="text-xs text-[var(--color-fg-1)]">
 {new Date(note.timestamp).toLocaleString('es-ES')}
 </span>
 </div>
 <p className="text-sm font-medium text-[var(--color-fg-1)]">
 {safe(note.text)}
 </p>
 </div>
 ))
 ) : (
 <p className="py-8 text-center text-[var(--color-fg-3)]">No hay comentarios aún.</p>
 )
 ) : (
 systemLogs.length > 0 ? (
 systemLogs.map((note, idx) => (
 <div key={idx} className="rounded-lg border border-[var(--color-line)] bg-[var(--color-bg-1)] p-4">
 <div className="flex items-start justify-between mb-2">
 <div className="flex items-center gap-2">
 <AlertCircle size={14} className="text-[var(--color-fg-3)]" />
 <span className="text-xs font-medium text-[var(--color-fg-3)]">
 Sistema
 </span>
 </div>
 <span className="text-xs text-[var(--color-fg-3)]">
 {new Date(note.timestamp).toLocaleString('es-ES')}
 </span>
 </div>
 <p className="text-sm italic text-[var(--color-fg-4)]">
 {safe(note.text)}
 </p>
 </div>
 ))
 ) : (
 <p className="py-8 text-center text-[var(--color-fg-3)]">No hay historial aún.</p>
 )
 )}
 </div>

 {activeTab === 'comments' && (
 <div className="border-t border-[var(--color-line)] bg-[var(--color-bg-2)] p-6">
 <div className="flex gap-2">
 <input
 type="text"
 placeholder="Agregar un comentario..."
 className="flex-1 rounded-lg border border-[var(--color-line)] bg-[var(--color-bg-1)] px-4 py-2.5 text-sm text-[var(--color-fg-1)] outline-none focus:border-[var(--color-fg-1)] "
 value={newNote}
 onChange={(e) => setNewNote(e.target.value)}
 onKeyDown={(e) => e.key === 'Enter' && handleAddNote()}
 />
 <Button variant="primary" disabled={!newNote.trim()} onClick={handleAddNote}>
 Agregar
 </Button>
 </div>
 </div>
 )}
 </div>
 </div>
 );
};

export default NotesModal;
