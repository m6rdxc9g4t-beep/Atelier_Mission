// Déploiement serveur : l'API sert aussi l'interface compilée (STATIC_DIR), derrière la même garde d'hôte.
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import { buildApp, type App } from '../src/app.ts'
import { readConfig } from '../src/config.ts'
import { openDatabase } from '../src/db/client.ts'

describe('interface servie par l’API', () => {
  let dir: string
  let app: App
  let close: () => void

  before(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'mission-static-'))
    mkdirSync(path.join(dir, 'assets'))
    writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>Atelier Mission</title>')
    writeFileSync(path.join(dir, 'assets', 'app-abc.js'), 'console.log(1)')
    const database = openDatabase(':memory:')
    close = database.close
    app = await buildApp({ db: database.db, staticDir: dir, allowedHosts: ['mission.atelier.example.fr'] })
  })

  after(async () => {
    await app.close()
    close()
    rmSync(dir, { recursive: true, force: true })
  })

  const get = (url: string, host = 'mission.atelier.example.fr') => app.inject({ method: 'GET', url, headers: { host } })

  it('sert index.html sans cache et les fichiers compilés en cache long', async () => {
    const page = await get('/')
    assert.equal(page.statusCode, 200)
    assert.match(page.body, /Atelier Mission/)
    assert.equal(page.headers['cache-control'], 'no-cache')
    const asset = await get('/assets/app-abc.js')
    assert.equal(asset.statusCode, 200)
    assert.match(String(asset.headers['cache-control']), /immutable/)
  })

  it('garde l’API prioritaire et ses 404 JSON', async () => {
    assert.equal((await get('/api/health')).json().status, 'ok')
    const missing = await get('/api/inconnue')
    assert.equal(missing.statusCode, 404)
    assert.equal(missing.json().code, 'NOT_FOUND')
    assert.equal((await get('/absent.js')).statusCode, 404)
  })

  it('applique la garde d’hôte à l’interface aussi', async () => {
    assert.equal((await get('/', 'evil.example')).statusCode, 403)
  })

  it('lit STATIC_DIR relatif au dossier backend', () => {
    assert.equal(readConfig({}).staticDir, undefined)
    assert.match(readConfig({ STATIC_DIR: '../frontend/dist' }).staticDir ?? '', /frontend[/\\]dist$/)
  })
})
