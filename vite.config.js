import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Required at build time so the deployed bundle always has a complete Firebase
// config. Building without these ships an empty apiKey and the app crashes with
// `auth/invalid-api-key` (prod outage, 2026-06). The guard aborts the build
// before a broken artifact can be produced or deployed.
const REQUIRED_ENV = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
]

export default defineConfig(({ command, mode }) => {
  if (command === 'build') {
    const env = loadEnv(mode, process.cwd(), 'VITE_')
    const missing = REQUIRED_ENV.filter((key) => !env[key])
    if (missing.length > 0) {
      throw new Error(
        `\n[fincontrol] Build aborted — missing required env vars:\n  ${missing.join('\n  ')}\n` +
          'Create or restore .env (see .env.example) before building or deploying.\n'
      )
    }
  }

  return {
    plugins: [react(), tailwindcss()],
    test: {
      environment: 'jsdom',
      include: ['src/**/*.{test,spec}.{js,jsx,ts,tsx}'],
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
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
  }
})
