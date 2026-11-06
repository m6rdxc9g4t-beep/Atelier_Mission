// Vite : React + Tailwind CSS v4. /api est relayé vers le backend Fastify (http://127.0.0.1:3001, ou ATELIER_MISSION_API_URL) :
// même origine, aucune configuration CORS. Ports d'Atelier Mission dans la suite : interface 5176, aperçu 4176 (strictPort).
// Thème (docs/SUITE.md §1.5 d'Atelier Projets) : le script commun design-system/brand/atelier-theme.js est injecté tel quel
// dans le <head> de index.html, script bloquant avant l'affichage (pas de copie à tenir à jour, pas d'éclair clair → sombre).
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

const THEME_MARKER = /<!-- atelier-theme\b[^>]*-->/

function atelierTheme(): Plugin {
  const file = createRequire(import.meta.url).resolve('@atelier-mission/design-system/brand/atelier-theme.js')
  return {
    name: 'atelier-theme',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        if (!THEME_MARKER.test(html)) throw new Error('index.html : repère <!-- atelier-theme --> introuvable')
        const script = readFileSync(file, 'utf8').replaceAll('</script', '<\\/script')
        return html.replace(THEME_MARKER, () => `<script>\n${script}</script>`)
      },
    },
  }
}

const apiTarget = process.env.ATELIER_MISSION_API_URL ?? 'http://127.0.0.1:3001'

export default defineConfig({
  plugins: [atelierTheme(), react(), tailwindcss()],
  server: { host: '127.0.0.1', port: 5176, strictPort: true, proxy: { '/api': { target: apiTarget, changeOrigin: false } } },
  preview: { host: '127.0.0.1', port: 4176, strictPort: true, proxy: { '/api': { target: apiTarget, changeOrigin: false } } },
})
