// Vite : React + Tailwind CSS v4. /api est relayé vers le backend Fastify (http://127.0.0.1:3001, ou ATELIER_MISSION_API_URL) :
// même origine, aucune configuration CORS. Ports d'Atelier Mission dans la suite : interface 5176, aperçu 4176 (strictPort).
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const apiTarget = process.env.ATELIER_MISSION_API_URL ?? 'http://127.0.0.1:3001'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { host: '127.0.0.1', port: 5176, strictPort: true, proxy: { '/api': { target: apiTarget, changeOrigin: false } } },
  preview: { host: '127.0.0.1', port: 4176, strictPort: true, proxy: { '/api': { target: apiTarget, changeOrigin: false } } },
})
