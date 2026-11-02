// Contrats HTTP des apps reliées, vérifiés avec un faux fetch (formes réelles relevées sur Atelier Trésorerie et Brevo).
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createBrevoClient } from '../src/integrations/brevo.ts'
import { createProjetsClient } from '../src/integrations/projets.ts'
import { centsToAmount, createTresorerieClient } from '../src/integrations/tresorerie.ts'

type Call = { url: string; init?: RequestInit }

function fakeFetch(routes: Record<string, unknown>, calls: Call[] = []) {
  return async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    const key = Object.keys(routes).find((k) => url.includes(k))
    if (!key) return new Response('{"error":"introuvable"}', { status: 404 })
    return new Response(JSON.stringify(routes[key]), { status: 200, headers: { 'content-type': 'application/json' } })
  }
}

describe('Atelier Trésorerie', () => {
  it('convertit les centimes en montant décimal (Trésorerie lit des euros)', () => {
    assert.equal(centsToAmount(192_500), '1925.00')
    assert.equal(centsToAmount(-23_105), '-231.05')
    assert.equal(centsToAmount(7), '0.07')
  })

  it('déballe les listes { items } et poste une opération avec X-Requested-With', async () => {
    const calls: Call[] = []
    const client = createTresorerieClient(
      'http://127.0.0.1:5050',
      fakeFetch(
        {
          '/api/accounts': { items: [{ id: 1, name: 'Compte pro', type: 'courant', archived: false, balance_cents: 0 }] },
          '/api/categories': { items: [{ id: 15, name: 'Missions', kind: 'revenu', color: '#fff' }] },
          '/api/transactions?q=': { items: [{ id: 9, notes: 'x [mission:payment:3:encaissement]' }], total: 1 },
          '/api/transactions': { id: 42 },
        },
        calls,
      ),
    )
    assert.deepEqual(await client.listAccounts(), [{ id: 1, name: 'Compte pro', type: 'courant', archived: false }])
    assert.deepEqual(await client.listCategories(), [{ id: 15, name: 'Missions', kind: 'revenu' }])
    assert.equal(await client.findByMarker('[mission:payment:3:encaissement]'), 9)
    assert.equal(await client.findByMarker('[mission:payment:4:encaissement]'), null)
    const id = await client.createTransaction({ account_id: 1, date: '2026-11-03', label: 'Client — facture F-1', amount_cents: 192_500, category_id: null, notes: 'n' })
    assert.equal(id, 42)
    const post = calls.at(-1)!
    assert.equal(post.init?.method, 'POST')
    assert.equal((post.init?.headers as Record<string, string>)['X-Requested-With'], 'AtelierMission')
    assert.deepEqual(JSON.parse(String(post.init?.body)), { account_id: 1, date: '2026-11-03', label: 'Client — facture F-1', amount: '1925.00', notes: 'n', status: 'valide' })
  })

  it('traduit une erreur de Trésorerie en message français', async () => {
    const client = createTresorerieClient('http://127.0.0.1:5050', async () => new Response('{"error":"Certains champs sont invalides."}', { status: 400 }))
    await assert.rejects(client.createTransaction({ account_id: 1, date: '2026-11-03', label: 'x', amount_cents: 1, category_id: null, notes: '' }), /HTTP 400\) : Certains champs sont invalides/)
  })
})

describe('Atelier Projets', () => {
  it('lit les projets (snake_case) et la table time-entries filtrée par projet', async () => {
    const calls: Call[] = []
    const client = createProjetsClient(
      'http://127.0.0.1:3000',
      fakeFetch(
        {
          '/api/atelier/projects': [{ id: '2', name: 'Zeta' }, { id: 1, name: 'Alpha' }],
          '/api/atelier/tables/time-entries': { format: 'atelier-table/1', name: 'time-entries', rows: [{ id: 1, element_id: 5, element: 'T', type: 'TASK', projet: 'Alpha', date: '2026-10-01', heures: 1.5, commentaire: null }], total: 1, truncated: false },
        },
        calls,
      ),
    )
    assert.deepEqual(await client.listProjects(), [{ id: 1, name: 'Alpha' }, { id: 2, name: 'Zeta' }])
    const { rows } = await client.timeEntries(1)
    assert.equal(rows[0]!.heures, 1.5)
    assert.match(calls.at(-1)!.url, /time-entries\?project_id=1$/)
  })

  it('signale Projets arrêté sans planter', async () => {
    const client = createProjetsClient('http://127.0.0.1:3000', async () => {
      throw new TypeError('fetch failed')
    })
    assert.equal(await client.ping(), false)
    await assert.rejects(client.listProjects(), /Atelier Projets injoignable/)
  })
})

describe('Brevo', () => {
  it('envoie sur /v3/smtp/email avec la clé dans l’en-tête api-key', async () => {
    const calls: Call[] = []
    const brevo = createBrevoClient('xkeysib-test', fakeFetch({ '/smtp/email': { messageId: '<abc@smtp-relay>' } }, calls))
    const result = await brevo.sendEmail({ sender: { email: 'moi@example.com' }, to: [{ email: 'client@example.com' }], subject: 'S', htmlContent: '<p>x</p>', textContent: 'x' })
    assert.equal(result.messageId, '<abc@smtp-relay>')
    assert.equal(calls[0]!.url, 'https://api.brevo.com/v3/smtp/email')
    assert.equal((calls[0]!.init?.headers as Record<string, string>)['api-key'], 'xkeysib-test')
  })
})
