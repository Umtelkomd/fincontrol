import React, { useState } from 'react';
import { Paperclip, Upload, CloudOff, FileText, Image, File, Search } from 'lucide-react';
import { useAllTransactions } from '../../hooks/useAllTransactions';
import { useToast } from '../../contexts/ToastContext';

const Adjuntos = ({ user }) => {
 const { loading } = useAllTransactions(user);
 const { showToast } = useToast();
 const [isDragging, setIsDragging] = useState(false);
 const [searchTerm, setSearchTerm] = useState('');

 const handleDragOver = (e) => {
 e.preventDefault();
 setIsDragging(true);
 };

 const handleDragLeave = () => {
 setIsDragging(false);
 };

 const handleDrop = (e) => {
 e.preventDefault();
 setIsDragging(false);
 showToast('Firebase Storage no está configurado aún. Los adjuntos estarán disponibles próximamente.', 'warning');
 };

 const handleFileSelect = () => {
 showToast('Firebase Storage no está configurado aún. Los adjuntos estarán disponibles próximamente.', 'warning');
 };

 if (loading) {
 return (
 <div className="flex items-center justify-center py-20">
 <div className="w-6 h-6 border-2 border-[var(--color-accent)] border-t-transparent rounded-full animate-spin" />
 </div>
 );
 }

 return (
 <div className="space-y-6 animate-fadeIn">
 <div className="flex items-center justify-between">
 <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-6 py-5 ">
 <p className="label-mono text-[var(--color-fg-1)]">Documentación</p>
 <h2 className="mt-2 text-[24px] font-medium tracking-[-0.03em] text-[var(--color-fg-1)]">Adjuntos</h2>
 <p className="mt-1 text-sm text-[var(--color-fg-3)]">Centraliza facturas, justificantes y respaldos de cada registro financiero.</p>
 </div>
 <div className="inline-flex items-center gap-2 rounded-lg border border-[var(--color-line-s)] bg-transparent px-3 py-2">
 <CloudOff size={14} className="text-[var(--color-warn)]" />
 <span className="text-[11px] font-medium text-[var(--color-warn)]">Almacenamiento pendiente</span>
 </div>
 </div>

 <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
 <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] p-5 ">
 <div className="flex items-center justify-between mb-2">
 <p className="label-mono text-[var(--color-fg-3)]">Total archivos</p>
 <Paperclip size={18} className="text-[var(--color-fg-1)]" />
 </div>
 <p className="font-display text-[28px] font-medium tracking-[-0.03em] text-[var(--color-fg-1)]">0</p>
 </div>
 <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] p-5 ">
 <div className="flex items-center justify-between mb-2">
 <p className="label-mono text-[var(--color-fg-3)]">Registros con adjuntos</p>
 <FileText size={18} className="text-[var(--color-ok)]" />
 </div>
 <p className="font-display text-[28px] font-medium tracking-[-0.03em] text-[var(--color-ok)]">0</p>
 </div>
 <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] p-5 ">
 <div className="flex items-center justify-between mb-2">
 <p className="label-mono text-[var(--color-fg-3)]">Espacio usado</p>
 <Image size={18} className="text-[var(--color-warn)]" />
 </div>
 <p className="font-display text-[28px] font-medium tracking-[-0.03em] text-[var(--color-warn)]">0 MB</p>
 </div>
 </div>

 <div
 onDragOver={handleDragOver}
 onDragLeave={handleDragLeave}
 onDrop={handleDrop}
 onClick={handleFileSelect}
 className={`cursor-pointer rounded-md border-2 border-dashed p-10 text-center transition-all ${
 isDragging
 ? 'border-[var(--color-fg-1)] bg-transparent'
 : 'border-[var(--color-line)] bg-[var(--color-bg-1)] hover:border-[var(--color-line)]'
 }`}
 >
 <Upload size={32} className={`mx-auto mb-3 ${isDragging ? 'text-[var(--color-fg-1)]' : 'text-[var(--color-fg-3)]'}`} />
 <p className="mb-1 text-[14px] font-medium text-[var(--color-fg-1)]">
 {isDragging ? 'Suelta los archivos aquí' : 'Arrastra archivos o haz clic para subir'}
 </p>
 <p className="text-[12px] text-[var(--color-fg-3)]">PDF, imágenes y documentos de respaldo, hasta 10 MB.</p>
 <div className="mt-4 inline-flex items-center gap-2 rounded-lg border border-[var(--color-line-s)] bg-transparent px-4 py-2">
 <CloudOff size={14} className="text-[var(--color-warn)]" />
 <span className="text-[12px] text-[var(--color-warn)]">Hace falta activar Firebase Storage para habilitar esta función</span>
 </div>
 </div>

 <div className="relative">
 <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-fg-3)]" />
 <input
 type="text"
 placeholder="Buscar por transacción o archivo..."
 value={searchTerm}
 onChange={(e) => setSearchTerm(e.target.value)}
 className="w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-bg-1)] py-2.5 pl-10 pr-4 text-[13px] text-[var(--color-fg-1)] placeholder-[var(--color-fg-3)] outline-none transition focus:border-[var(--color-fg-1)] "
 />
 </div>

 <div className="overflow-hidden rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] ">
 <div className="overflow-x-auto">
 <table className="w-full text-left">
 <thead>
 <tr className="border-b border-[var(--color-line)] bg-[var(--color-bg-2)]">
 <th className="px-4 py-3 label-mono text-[var(--color-fg-3)]">Transacción</th>
 <th className="px-4 py-3 label-mono text-[var(--color-fg-3)]">Archivos</th>
 <th className="px-4 py-3 label-mono text-[var(--color-fg-3)]">Fecha</th>
 <th className="px-4 py-3 text-right label-mono text-[var(--color-fg-3)]">Tamaño</th>
 </tr>
 </thead>
 <tbody>
 </tbody>
 </table>
 </div>

 <div className="text-center py-16">
 <File className="mx-auto mb-3 h-8 w-8 text-[var(--color-fg-3)]" />
 <p className="mb-1 text-sm text-[var(--color-fg-3)]">Los adjuntos estarán disponibles cuando se active el almacenamiento del proyecto.</p>
 <p className="text-[11px] text-[var(--color-fg-3)]">Hace falta habilitar Firebase Storage en `umtelkomd-finance`.</p>
 </div>
 </div>
 </div>
 );
};

export default Adjuntos;
