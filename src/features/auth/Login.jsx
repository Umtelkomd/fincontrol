import { useState } from 'react';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '../../services/firebase';
import NexusMark from '../../components/brand/NexusMark';
import { Alert, Button } from '../../components/ui/nexus';

const Login = () => {
 const [loginData, setLoginData] = useState({ email: '', password: '' });
 const [loginError, setLoginError] = useState('');
 const [loading, setLoading] = useState(false);

 const handleLogin = async (e) => {
 e.preventDefault();
 setLoginError('');
 setLoading(true);
 try {
 await signInWithEmailAndPassword(auth, loginData.email, loginData.password);
 } catch (error) {
 if (error.code === 'auth/network-request-failed') {
 setLoginError('Error de conexión. Verifica tu internet.');
 } else if (error.code === 'auth/too-many-requests') {
 setLoginError('Demasiados intentos. Intenta de nuevo más tarde.');
 } else {
 setLoginError('Email o contraseña incorrectos');
 }
 } finally {
 setLoading(false);
 }
 };

 return (
  <div className="relative min-h-screen overflow-hidden bg-[var(--color-bg-0)] text-[var(--color-fg-1)]">
  <div aria-hidden="true" className="absolute inset-x-0 top-0 h-[4px] bg-[var(--color-accent)]" />
  <div aria-hidden="true" className="absolute -right-10 top-10 font-display text-[160px] font-medium leading-none tracking-[-0.08em] text-[var(--color-fg-1)] opacity-[0.025] lg:text-[240px]">
  NEXUS
  </div>
  <div className="mx-auto flex min-h-screen w-full max-w-[1240px]">
  <section className="relative hidden flex-1 flex-col justify-between overflow-hidden border-r border-[var(--color-line)] bg-[var(--color-bg-1)] p-10 lg:flex">
  <div aria-hidden="true" className="absolute inset-y-0 left-0 w-[4px] bg-[var(--color-accent)]" />
  <div aria-hidden="true" className="absolute bottom-[-42px] left-10 font-display text-[110px] font-medium leading-none tracking-[-0.08em] text-[var(--color-fg-1)] opacity-[0.035]">
  SOFTWARE
  </div>
  <div className="relative">
  <div className="mb-8 flex h-16 w-16 items-center justify-center rounded-md border border-[var(--color-line-s)] bg-[var(--color-bg-0)]">
  <NexusMark size={40} title="NEXUS" />
  </div>
  <p className="label-mono text-[var(--color-accent)]">Secure access</p>
  <h1 className="mt-4 max-w-[560px] font-display text-[72px] font-light leading-[0.88] tracking-[-0.055em] text-[var(--color-fg-1)]">
  NEXUS<br /><em className="font-normal italic">finance</em><span className="text-[var(--color-accent)]">.OS</span>
  </h1>
  <p className="mt-6 max-w-[460px] text-[15px] leading-7 text-[var(--color-fg-2)]">
  Operator UI para control financiero: caja, cuentas por cobrar, cuentas por pagar y trazabilidad operativa sobre una sola marca.
  </p>
  </div>

  <div className="relative grid grid-cols-2 gap-px overflow-hidden rounded-md border border-[var(--color-line)] bg-[var(--color-line)]">
  <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-4 py-3">
  <p className="label-mono text-[var(--color-fg-3)]">Entorno</p>
  <p className="mt-1 font-mono text-[14px] text-[var(--color-fg-1)]">UMTELKOMD GmbH</p>
  </div>
  <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-4 py-3">
  <p className="label-mono text-[var(--color-fg-3)]">Modo</p>
  <p className="mt-1 font-mono text-[14px] text-[var(--color-fg-1)]">Finance Operations Console</p>
 </div>
 </div>
 </section>

  <section className="relative flex flex-1 items-center justify-center p-4 sm:p-8">
  <div className="relative w-full max-w-md overflow-hidden rounded-lg border border-[var(--color-line-s)] bg-[var(--color-bg-1)] p-8">
  <div aria-hidden="true" className="absolute inset-x-0 top-0 h-[3px] bg-[var(--color-accent)]" />
  <div className="mb-8 flex flex-col items-center gap-3 text-center">
  <div className="flex h-16 w-16 items-center justify-center rounded-md border border-[var(--color-line-s)] bg-[var(--color-bg-0)]">
  <NexusMark size={40} title="NEXUS" />
  </div>
  <div>
  <h2 className="font-display text-[34px] font-light tracking-[-0.04em] text-[var(--color-fg-1)]">NEXUS.OS</h2>
  <p className="mt-1 label-mono text-[var(--color-accent)]">UMTELKOMD · secure finance</p>
 </div>
 </div>

<form onSubmit={handleLogin} className="space-y-4">
 <div>
 <label htmlFor="email" className="mb-2 block label-mono text-[var(--color-fg-3)]">Email</label>
 <input
 id="email"
 type="email"
 required
 className="w-full rounded-md border border-[var(--color-line-s)] bg-[var(--color-bg-0)] px-4 py-3 font-mono text-sm text-[var(--color-fg-1)] outline-none transition-colors placeholder:text-[var(--color-fg-4)] focus:border-[var(--color-accent)]"
 value={loginData.email}
 onChange={(e) => setLoginData({ ...loginData, email: e.target.value })}
placeholder="usuario@umtelkomd.com"
/>
</div>

 <div>
 <label htmlFor="password" className="mb-2 block label-mono text-[var(--color-fg-3)]">Contraseña</label>
 <input
 id="password"
 type="password"
 required
 className="w-full rounded-md border border-[var(--color-line-s)] bg-[var(--color-bg-0)] px-4 py-3 font-mono text-sm text-[var(--color-fg-1)] outline-none transition-colors placeholder:text-[var(--color-fg-4)] focus:border-[var(--color-accent)]"
 value={loginData.password}
 onChange={(e) => setLoginData({ ...loginData, password: e.target.value })}
placeholder="********"
/>
</div>

 {loginError && (
 <Alert variant="err" title="Error de acceso">{loginError}</Alert>
 )}

 <Button
 type="submit"
 variant="primary"
 disabled={loading}
 loading={loading}
 className="w-full justify-center py-3 font-mono uppercase tracking-[0.06em]"
 >
 Iniciar Sesión
 </Button>
 </form>

 <p className="mt-6 text-center font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--color-fg-4)]">
  Rebuilt around software · {new Date().getFullYear()}
 </p>
</div>
</section>
</div>
</div>
 );
};

export default Login;
