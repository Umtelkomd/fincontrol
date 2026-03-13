import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks: {
          'firebase': ['firebase/app', 'firebase/firestore', 'firebase/auth'],
          'recharts': ['recharts'],
          'pdf': ['jspdf', 'jspdf-autotable'],
          'vendor': ['react', 'react-dom', 'react-router-dom'],
        }
      }
    }
  }
})
