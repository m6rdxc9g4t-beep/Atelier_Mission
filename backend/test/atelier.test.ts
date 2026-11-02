// Contrat atelier-node/1 : manifeste, événements (seq, gap), idempotence, tables.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { testApp, timeRow } from './helpers.ts'

describe('nœud Atelier', () => {
  it('publie un manifeste conforme', async () => {
    const t = await testApp()
    try {
      const m = (await t.api('GET', '/api/atelier/manifest')).body
      assert.equal(m.contract, 'atelier-node/1')
      assert.equal(m.app, 'mission')
      const ids = m.actions.map((a: { id: string }) => a.id)
      assert.equal(new Set(ids).size, ids.length)
      for (const action of m.actions) {
        assert.match(action.id, /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/)
        assert.ok(action.http && action.mcp_tool === null)
        if (action.kind === 'write' && action.id.includes('create')) assert.equal(action.idempotency, 'header')
      }
    } finally {
      await t.close()
    }
  })

  it('numérote les événements, filtre par type et signale un trou', async () => {
    const t = await testApp()
    try {
      const client = (await t.api('POST', '/api/clients', { name: 'A' })).body
      const opp = (await t.api('POST', '/api/opportunities', { clientId: client.id, title: 'O' })).body
      await t.api('POST', `/api/opportunities/${opp.id}/move`, { stage: 'QUALIFIED' })
      const all = (await t.api('GET', '/api/atelier/events?since=0')).body
      assert.deepEqual(all.events.map((e: { type: string }) => e.type), ['mission.opportunity.created', 'mission.opportunity.stage_changed'])
      assert.equal(all.next, 2)
      assert.equal(all.events[1].data.from, 'NEW')
      assert.equal(all.events[1].data.client_id, String(client.id))
      const after = (await t.api('GET', '/api/atelier/events?since=2')).body
      assert.equal(after.events.length, 0)
      assert.equal(after.next, 2)
      assert.equal((await t.api('GET', '/api/atelier/events?since=99')).body.gap, true)
    } finally {
      await t.close()
    }
  })

  it('rejoue une création avec la même Idempotency-Key et refuse une clé réutilisée', async () => {
    const t = await testApp()
    try {
      const client = (await t.api('POST', '/api/clients', { name: 'A' })).body
      const body = { client_id: client.id, title: 'Prospect Nexus', amount_cents: 100_000 }
      const headers = { 'idempotency-key': 'nexus:run-1:step-2' }
      const first = await t.api('POST', '/api/atelier/opportunities', body, headers)
      const second = await t.api('POST', '/api/atelier/opportunities', { amount_cents: 100_000, title: 'Prospect Nexus', client_id: client.id }, headers)
      assert.equal(first.status, 201)
      assert.equal(second.status, 201)
      assert.equal(second.headers['idempotency-replayed'], 'true')
      assert.deepEqual(second.body, first.body)
      assert.equal((await t.api('GET', '/api/opportunities')).body.length, 1)
      const reused = await t.api('POST', '/api/atelier/opportunities', { ...body, title: 'Autre' }, headers)
      assert.equal(reused.status, 409)
      assert.equal(reused.body.code, 'IDEMPOTENCY_KEY_REUSED')
    } finally {
      await t.close()
    }
  })

  it('sert les tables atelier-table/1', async () => {
    const t = await testApp()
    try {
      t.fakes.projetsRows = [timeRow(1, 5, 'Tâche', '2026-10-01', 2.5)]
      await t.api('POST', '/api/atelier/time/import', { project_id: 1 })
      const table = (await t.api('GET', '/api/atelier/tables/unbilled-time')).body
      assert.equal(table.format, 'atelier-table/1')
      assert.deepEqual(table.rows, [{ id: 1, projet: 'Portail transporteurs', element_id: 5, element: 'Tâche', date: '2026-10-01', heures: 2.5 }])
      assert.equal((await t.api('GET', '/api/atelier/tables/inconnue')).status, 404)
    } finally {
      await t.close()
    }
  })
})
