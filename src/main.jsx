import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './styles/nexus-os.css'
import './index.css'
import App from './App.jsx'

// Apply the theme class BEFORE first paint. useTheme() only mounts inside the
// authenticated shell (Sidebar), so without this the login screen — and any
// pre-auth flash — would render light even though NEXUS.OS is dark-first.
if ((localStorage.getItem('fincontrol.theme') || 'dark') === 'dark') {
 document.documentElement.classList.add('nx-dark')
}

createRoot(document.getElementById('root')).render(
 <StrictMode>
 <BrowserRouter>
 <App />
 </BrowserRouter>
 </StrictMode>,
)
