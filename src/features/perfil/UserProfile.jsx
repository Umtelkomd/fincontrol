import React, { useState } from 'react';
import {
  updateProfile,
  updatePassword,
  reauthenticateWithCredential,
  EmailAuthProvider
} from 'firebase/auth';
import { User, Lock, Shield, Camera, Save, Eye, EyeOff, Check, AlertTriangle } from 'lucide-react';
import { useToast } from '../../contexts/ToastContext';

const InputField = ({ label, value, onChange, type = 'text', disabled = false, placeholder, icon: Icon }) => (
  <div>
    <label className="block text-[11px] font-semibold text-[#8e8e93] uppercase tracking-wider mb-1.5">{label}</label>
    <div className="relative">
      {Icon && <Icon size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#636366]" />}
      <input
        type={type}
        value={value}
        onChange={onChange}
        disabled={disabled}
        placeholder={placeholder}
        className={`w-full ${Icon ? 'pl-9' : 'pl-3'} pr-3 py-2.5 bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.08)] rounded-lg text-[13px] text-white placeholder-[#48484a] focus:outline-none focus:border-[#0a84ff] focus:ring-1 focus:ring-[#0a84ff] transition-all ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      />
    </div>
  </div>
);

const UserProfile = ({ user, userRole }) => {
  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [photoFile, setPhotoFile] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(user?.photoURL || null);
  const [saving, setSaving] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPw, setShowCurrentPw] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);

  let toastCtx;
  try { toastCtx = useToast(); } catch { toastCtx = null; }
  const showToast = toastCtx?.showToast;

  const initials = (user?.displayName || user?.email || '?')
    .split(/[\s@]/)
    .filter(Boolean)
    .slice(0, 2)
    .map(s => s[0].toUpperCase())
    .join('');

  const handleSaveProfile = async () => {
    if (!user) return;
    setSaving(true);
    try {
      await updateProfile(user, { displayName: displayName.trim() || null });
      showToast?.('Perfil actualizado');
    } catch (err) {
      console.error('Error updating profile:', err);
      showToast?.('Error al actualizar perfil', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handlePhotoChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      showToast?.('La imagen no debe superar 2MB', 'error');
      return;
    }
    setPhotoFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => setPhotoPreview(ev.target.result);
    reader.readAsDataURL(file);
    // Note: actual upload to Firebase Storage requires storage to be enabled.
    // For now we store as data URL in profile (works for small images).
    try {
      const dataUrl = await new Promise((resolve) => {
        const r = new FileReader();
        r.onload = (ev) => resolve(ev.target.result);
        r.readAsDataURL(file);
      });
      await updateProfile(user, { photoURL: dataUrl });
      showToast?.('Foto actualizada');
    } catch (err) {
      console.error('Error updating photo:', err);
      showToast?.('Error al subir foto', 'error');
    }
  };

  const validatePassword = (pw) => {
    if (pw.length < 8) return 'Mínimo 8 caracteres';
    if (!/\d/.test(pw)) return 'Debe incluir al menos 1 número';
    if (!/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(pw)) return 'Debe incluir al menos 1 carácter especial';
    return null;
  };

  const handleChangePassword = async () => {
    if (!user || !currentPassword || !newPassword) return;

    const pwError = validatePassword(newPassword);
    if (pwError) {
      showToast?.(pwError, 'error');
      return;
    }
    if (newPassword !== confirmPassword) {
      showToast?.('Las contraseñas no coinciden', 'error');
      return;
    }

    setChangingPassword(true);
    try {
      const credential = EmailAuthProvider.credential(user.email, currentPassword);
      await reauthenticateWithCredential(user, credential);
      await updatePassword(user, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      showToast?.('Contraseña actualizada');
    } catch (err) {
      console.error('Error changing password:', err);
      const msg = err.code === 'auth/wrong-password' ? 'Contraseña actual incorrecta'
        : err.code === 'auth/too-many-requests' ? 'Demasiados intentos, intenta más tarde'
        : 'Error al cambiar contraseña';
      showToast?.(msg, 'error');
    } finally {
      setChangingPassword(false);
    }
  };

  const pwValidation = newPassword ? validatePassword(newPassword) : null;
  const pwMatch = newPassword && confirmPassword ? newPassword === confirmPassword : null;

  const roleBadge = {
    admin: { label: 'Administrador', color: 'bg-[rgba(191,90,242,0.12)] text-[#bf5af2] border-[rgba(191,90,242,0.2)]' },
    manager: { label: 'Manager', color: 'bg-[rgba(10,132,255,0.12)] text-[#0a84ff] border-[rgba(10,132,255,0.2)]' },
    editor: { label: 'Editor', color: 'bg-[rgba(255,159,10,0.12)] text-[#ff9f0a] border-[rgba(255,159,10,0.2)]' },
  };
  const role = roleBadge[userRole] || roleBadge.editor;

  return (
    <div className="space-y-6 animate-fadeIn max-w-4xl mx-auto">
      {/* Avatar + Name Header */}
      <div className="flex flex-col items-center text-center">
        <div className="relative group">
          {photoPreview ? (
            <img src={photoPreview} alt="Avatar" className="w-20 h-20 rounded-full object-cover border-2 border-[rgba(255,255,255,0.1)]" />
          ) : (
            <div className="w-20 h-20 rounded-full bg-gradient-to-br from-[#bf5af2] to-[#0a84ff] flex items-center justify-center border-2 border-[rgba(255,255,255,0.1)]">
              <span className="text-2xl font-bold text-white">{initials}</span>
            </div>
          )}
          <label className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-full opacity-0 group-hover:opacity-100 cursor-pointer transition-opacity">
            <Camera size={20} className="text-white" />
            <input type="file" accept="image/*" onChange={handlePhotoChange} className="hidden" />
          </label>
        </div>
        <h2 className="text-lg font-bold text-white mt-3">{user?.displayName || user?.email}</h2>
        <span className={`mt-1.5 inline-flex px-3 py-1 rounded-full text-[11px] font-semibold border ${role.color}`}>
          <Shield size={12} className="mr-1.5" /> {role.label}
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Personal Info */}
        <div className="bg-[#1c1c1e] rounded-xl border border-[rgba(255,255,255,0.06)] overflow-hidden">
          <div className="px-5 py-3.5 border-b border-[rgba(255,255,255,0.06)] flex items-center gap-2">
            <User size={15} className="text-[#0a84ff]" />
            <h3 className="text-[13px] font-semibold text-[#c7c7cc]">Información Personal</h3>
          </div>
          <div className="p-5 space-y-4">
            <InputField
              label="Nombre"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Tu nombre completo"
              icon={User}
            />
            <InputField
              label="Email"
              value={user?.email || ''}
              disabled
              icon={null}
            />
            <InputField
              label="Rol"
              value={role.label}
              disabled
              icon={Shield}
            />
            <button
              onClick={handleSaveProfile}
              disabled={saving}
              className="flex items-center justify-center gap-2 w-full bg-[#0a84ff] hover:bg-[#0070e0] disabled:opacity-50 text-white px-4 py-2.5 rounded-lg text-[13px] font-semibold transition-all"
            >
              {saving ? 'Guardando...' : <><Save size={14} /> Guardar Cambios</>}
            </button>
          </div>
        </div>

        {/* Change Password */}
        <div className="bg-[#1c1c1e] rounded-xl border border-[rgba(255,255,255,0.06)] overflow-hidden">
          <div className="px-5 py-3.5 border-b border-[rgba(255,255,255,0.06)] flex items-center gap-2">
            <Lock size={15} className="text-[#ff9f0a]" />
            <h3 className="text-[13px] font-semibold text-[#c7c7cc]">Cambiar Contraseña</h3>
          </div>
          <div className="p-5 space-y-4">
            <div>
              <label className="block text-[11px] font-semibold text-[#8e8e93] uppercase tracking-wider mb-1.5">Contraseña Actual</label>
              <div className="relative">
                <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#636366]" />
                <input
                  type={showCurrentPw ? 'text' : 'password'}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="********"
                  className="w-full pl-9 pr-10 py-2.5 bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.08)] rounded-lg text-[13px] text-white placeholder-[#48484a] focus:outline-none focus:border-[#0a84ff] focus:ring-1 focus:ring-[#0a84ff] transition-all"
                />
                <button onClick={() => setShowCurrentPw(!showCurrentPw)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#636366] hover:text-[#8e8e93]">
                  {showCurrentPw ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-[#8e8e93] uppercase tracking-wider mb-1.5">Nueva Contraseña</label>
              <div className="relative">
                <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#636366]" />
                <input
                  type={showNewPw ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Min. 8 caracteres"
                  className="w-full pl-9 pr-10 py-2.5 bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.08)] rounded-lg text-[13px] text-white placeholder-[#48484a] focus:outline-none focus:border-[#0a84ff] focus:ring-1 focus:ring-[#0a84ff] transition-all"
                />
                <button onClick={() => setShowNewPw(!showNewPw)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#636366] hover:text-[#8e8e93]">
                  {showNewPw ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
              {newPassword && (
                <div className="flex items-center gap-1.5 mt-1.5">
                  {pwValidation ? (
                    <><AlertTriangle size={11} className="text-[#ff9f0a]" /><span className="text-[10px] text-[#ff9f0a]">{pwValidation}</span></>
                  ) : (
                    <><Check size={11} className="text-[#30d158]" /><span className="text-[10px] text-[#30d158]">Contraseña válida</span></>
                  )}
                </div>
              )}
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-[#8e8e93] uppercase tracking-wider mb-1.5">Confirmar Contraseña</label>
              <div className="relative">
                <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#636366]" />
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Repetir contraseña"
                  className="w-full pl-9 pr-3 py-2.5 bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.08)] rounded-lg text-[13px] text-white placeholder-[#48484a] focus:outline-none focus:border-[#0a84ff] focus:ring-1 focus:ring-[#0a84ff] transition-all"
                />
              </div>
              {confirmPassword && (
                <div className="flex items-center gap-1.5 mt-1.5">
                  {pwMatch ? (
                    <><Check size={11} className="text-[#30d158]" /><span className="text-[10px] text-[#30d158]">Coinciden</span></>
                  ) : (
                    <><AlertTriangle size={11} className="text-[#ff453a]" /><span className="text-[10px] text-[#ff453a]">No coinciden</span></>
                  )}
                </div>
              )}
            </div>

            <button
              onClick={handleChangePassword}
              disabled={changingPassword || !currentPassword || !newPassword || !confirmPassword || !!pwValidation || !pwMatch}
              className="flex items-center justify-center gap-2 w-full bg-[#ff9f0a] hover:bg-[#e8900a] disabled:opacity-40 text-black px-4 py-2.5 rounded-lg text-[13px] font-semibold transition-all"
            >
              {changingPassword ? 'Cambiando...' : <><Lock size={14} /> Cambiar Contraseña</>}
            </button>
          </div>
        </div>
      </div>

      {/* Preferences */}
      <div className="bg-[#1c1c1e] rounded-xl border border-[rgba(255,255,255,0.06)] overflow-hidden">
        <div className="px-5 py-3.5 border-b border-[rgba(255,255,255,0.06)]">
          <h3 className="text-[13px] font-semibold text-[#c7c7cc]">Preferencias</h3>
        </div>
        <div className="p-5 grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-[11px] font-semibold text-[#8e8e93] uppercase tracking-wider mb-1.5">Idioma</label>
            <select disabled className="w-full px-3 py-2.5 bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.08)] rounded-lg text-[13px] text-white opacity-50 cursor-not-allowed">
              <option>Español</option>
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-[#8e8e93] uppercase tracking-wider mb-1.5">Moneda</label>
            <select disabled className="w-full px-3 py-2.5 bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.08)] rounded-lg text-[13px] text-white opacity-50 cursor-not-allowed">
              <option>EUR (€)</option>
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-[#8e8e93] uppercase tracking-wider mb-1.5">Zona Horaria</label>
            <select disabled className="w-full px-3 py-2.5 bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.08)] rounded-lg text-[13px] text-white opacity-50 cursor-not-allowed">
              <option>Europe/Berlin (CET)</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  );
};

export default UserProfile;
