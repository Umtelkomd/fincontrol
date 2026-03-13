# TASK: Fixes visuales + Perfil de Usuario

## Fix 1: Pie Chart de Distribución de Gastos — Leyenda desbordada

### Problema
En `Dashboard.jsx`, el pie chart "Distribución de Gastos" tiene demasiadas categorías y la leyenda se desborda del contenedor, tapando contenido a la derecha.

### Solución
1. **Limitar el pie chart a las top 8 categorías** y agrupar el resto en "Otros"
2. **Mover la leyenda abajo** del chart (no al lado) para que no desborde
3. **Usar tooltip** para mostrar el nombre completo + monto al hacer hover

```jsx
// Agrupar categorías pequeñas
const TOP_N = 8;
const sortedCategories = [...categoryData].sort((a, b) => b.value - a.value);
const topCategories = sortedCategories.slice(0, TOP_N);
const otherSum = sortedCategories.slice(TOP_N).reduce((s, c) => s + c.value, 0);
if (otherSum > 0) {
  topCategories.push({ name: 'Otros', value: otherSum });
}
```

Para la leyenda:
```jsx
<Legend 
  layout="horizontal" 
  verticalAlign="bottom" 
  align="center"
  wrapperStyle={{ fontSize: '11px', paddingTop: '12px' }}
  formatter={(value) => value.length > 15 ? value.slice(0, 15) + '…' : value}
/>
```

### Archivos
- `src/features/dashboard/Dashboard.jsx` — sección del pie chart

---

## Fix 2: Perfil de Usuario editable

### Requerimiento
El usuario quiere poder editar su perfil desde la app: nombre, foto, contraseña. Actualmente solo se muestra el email y el rol en el sidebar.

### Implementación

#### A. Crear componente de Perfil
Crear `src/features/perfil/UserProfile.jsx`:

- **Sección 1: Info personal**
  - Nombre (displayName) — editable, guardar con `updateProfile(user, { displayName })`
  - Email — solo lectura (mostrarlo pero no editable sin re-auth)
  - Foto de perfil — subir imagen, guardar URL con `updateProfile(user, { photoURL })`
  - Rol — solo lectura (badge admin/manager/editor)

- **Sección 2: Cambiar contraseña**
  - Contraseña actual (para re-autenticación)
  - Nueva contraseña
  - Confirmar nueva contraseña
  - Usar `reauthenticateWithCredential()` + `updatePassword()`
  - Validar: mínimo 8 caracteres, al menos 1 número y 1 especial
  - Mostrar toast de éxito/error

- **Sección 3: Preferencias**
  - Idioma (solo español por ahora, placeholder para futuro)
  - Formato de moneda (EUR por defecto)
  - Zona horaria

#### B. Firebase imports necesarios
```javascript
import { 
  updateProfile, 
  updatePassword, 
  reauthenticateWithCredential, 
  EmailAuthProvider 
} from 'firebase/auth';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
```

**Nota:** Firebase Storage debe estar habilitado para la foto de perfil. Si no está habilitado, mostrar un avatar con las iniciales del nombre (como ya se hace en el sidebar) y deshabilitar el upload de foto.

#### C. Agregar ruta
En `App.jsx`:
```jsx
import UserProfile from './features/perfil/UserProfile';

// En las rutas:
<Route path="/perfil" element={<UserProfile user={user} userRole={userRole} />} />
```

#### D. Acceso al perfil
En el sidebar (`Sidebar.jsx`), hacer clickeable el user pill:
```jsx
<button onClick={() => navigate('/perfil')} className="...">
  {/* avatar + email + role badge */}
</button>
```

También agregar en el MobileMenu.

#### E. Actualizar sidebar y header con displayName
Donde dice `user?.email`, preferir `user?.displayName || user?.email`.
Si hay `photoURL`, mostrar la imagen en vez del avatar de iniciales.

### Estilo
- Mismo dark Apple-style
- Layout: 2 columnas en desktop (info + seguridad), 1 columna en mobile
- Avatar grande (80x80) centrado arriba
- Inputs consistentes con el resto de la app (bg dark, border subtle, focus ring blue)

### Archivos a crear
- `src/features/perfil/UserProfile.jsx`

### Archivos a modificar
- `src/App.jsx` — agregar ruta `/perfil`
- `src/components/layout/Sidebar.jsx` — user pill clickeable → navigate('/perfil')
- `src/components/layout/MobileMenu.jsx` — lo mismo
