// API locale uniquement ; données de Projets et Trésorerie jamais envoyées hors de la machine ; mode en ligne protégé.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createProjetsClient } from '../src/integrations/projets.ts'
import { createTresorerieClient } from '../src/integrations/tresorerie.ts'
import { testApp } from './helpers.ts'

describe('sécurité', () => {
  it('refuse un hôte étranger (DNS rebinding) et une écriture venue d’un autre site', async () => {
    const t = await testApp()
    try {
      assert.equal((await t.api('GET', '/api/health', undefined, { host: 'evil.example' })).status, 403)
      const csrf = await t.api('PUT', '/api/settings/online-mode', { online: true }, { origin: 'https://evil.example' })
      assert.equal(csrf.status, 403)
      assert.equal(csrf.body.code, 'FORBIDDEN_ORIGIN')
      assert.equal((await t.api('GET', '/api/settings')).body.onlineMode, false)
      const nullOrigin = await t.api('POST', '/api/clients', { name: 'X' }, { origin: 'null' })
      assert.equal(nullOrigin.status, 403)
      assert.equal((await t.api('POST', '/api/clients', { name: 'X' }, { origin: 'http://127.0.0.1:5176' })).status, 201)
    } finally {
      await t.close()
    }
  })

  it('PATCH /settings ne peut pas passer l’app en ligne', async () => {
    const t = await testApp()
    try {
      const res = await t.api('PATCH', '/api/settings', { onlineMode: true })
      assert.equal(res.status, 400)
      assert.equal((await t.api('GET', '/api/settings')).body.onlineMode, false)
    } finally {
      await t.close()
    }
  })

  it('n’accepte que des adresses de bouclage pour Projets et Trésorerie', () => {
    assert.throws(() => createProjetsClient('https://projets.example.com'), /adresse locale/)
    assert.throws(() => createTresorerieClient('http://192.168.1.20:5050'), /adresse locale/)
    assert.doesNotThrow(() => createTresorerieClient('http://localhost:5050'))
    assert.doesNotThrow(() => createProjetsClient('http://[::1]:3000'))
  })

  it('n’expose jamais la clé Brevo', async () => {
    const t = await testApp()
    try {
      const body = JSON.stringify((await t.api('GET', '/api/settings')).body)
      assert.ok(!/xkeysib/i.test(body))
      assert.match(body, /"brevoKeyConfigured":true/)
    } finally {
      await t.close()
    }
  })
})
