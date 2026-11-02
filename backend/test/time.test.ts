// Temps d'Atelier Projets → facture : jamais facturé deux fois, changements signalés, avoir qui libère le temps.
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { COMPANY, testApp, timeRow } from './helpers.ts'

describe('temps passé → facture', () => {
  let t: Awaited<ReturnType<typeof testApp>>
  let clientId = 0
  let invoiceId = 0
  before(async () => {
    t = await testApp()
    await t.api('PATCH', '/api/settings', COMPANY)
    clientId = (await t.api('POST', '/api/clients', { name: 'Bellevue', address: 'Lyon' })).body.id
    t.fakes.projetsRows = [
      timeRow(101, 12, 'Maquettes', '2026-10-01', 7),
      timeRow(102, 12, 'Maquettes', '2026-10-02', 3.5),
      timeRow(103, 15, 'API', '2026-10-05', 7),
      timeRow(104, 15, 'API', '2026-10-20', 7),
    ]
  })
  after(() => t.close())

  it('importe les saisies d’un projet (réimport sans doublon)', async () => {
    const first = await t.api('POST', '/api/time/import', { projectId: 1 })
    assert.equal(first.body.created, 4)
    const again = await t.api('POST', '/api/time/import', { projectId: 1 })
    assert.equal(again.body.created, 0)
    assert.equal(again.body.unchanged, 4)
  })

  it('prévisualise puis crée la facture des saisies non facturées de la période', async () => {
    const body = { clientId, projectId: 1, to: '2026-10-10', unit: 'DAY', rateCents: 50_000, hoursPerDay: 7 }
    const preview = await t.api('POST', '/api/invoices/from-time/preview', body)
    assert.equal(preview.body.lines.length, 2)
    assert.equal(preview.body.lines[0].quantityMilli, 1500)
    const created = await t.api('POST', '/api/invoices/from-time', body)
    assert.equal(created.status, 201)
    assert.equal(created.body.totalHtCents, 125_000)
    assert.equal(created.body.serviceStart, '2026-10-01')
    assert.equal(created.body.serviceEnd, '2026-10-05')
    assert.equal(created.body.time.entries, 3)
    invoiceId = created.body.id
  })

  it('ne refacture jamais une saisie déjà liée à une facture', async () => {
    const res = await t.api('POST', '/api/invoices/from-time', { clientId, projectId: 1, to: '2026-10-10', unit: 'DAY' })
    assert.equal(res.status, 400)
    const unbilled = (await t.api('GET', '/api/time/entries?billed=unbilled')).body
    assert.deepEqual(unbilled.map((e: { projetsEntryId: number }) => e.projetsEntryId), [104])
  })

  it('modifier une ligne du brouillon garde le lien ; la retirer libère ses saisies', async () => {
    const invoice = (await t.api('GET', `/api/invoices/${invoiceId}`)).body
    const [first, second] = invoice.lines
    const edited = await t.api('PATCH', `/api/invoices/${invoiceId}`, {
      lines: [{ id: first.id, label: 'Maquettes (remise)', unit: 'DAY', quantity: 1.5, unitPriceCents: 45_000, vatRateBps: 0 }],
    })
    assert.equal(edited.body.lines[0].timeEntryCount, 2)
    assert.equal(edited.body.time.entries, 2)
    assert.ok(second)
    const unbilled = (await t.api('GET', '/api/time/entries?billed=unbilled')).body
    assert.deepEqual(unbilled.map((e: { projetsEntryId: number }) => e.projetsEntryId).sort(), [103, 104])
  })

  it('signale une saisie facturée puis modifiée ou supprimée dans Projets', async () => {
    await t.api('POST', `/api/invoices/${invoiceId}/issue`)
    t.fakes.projetsRows = [timeRow(101, 12, 'Maquettes', '2026-10-01', 8), timeRow(103, 15, 'API', '2026-10-05', 7), timeRow(104, 15, 'API', '2026-10-20', 7)]
    const res = await t.api('POST', '/api/time/import', { projectId: 1 })
    assert.equal(res.body.flagged, 2) // 101 modifiée, 102 supprimée (toutes deux facturées)
    const flagged = (await t.api('GET', '/api/time/entries?billed=flagged')).body
    assert.equal(flagged.length, 2)
    assert.equal((await t.api('GET', `/api/invoices/${invoiceId}`)).body.time.flagged, 2)
  })

  it('annule la facture par un avoir numéroté et rend le temps facturable', async () => {
    const res = await t.api('POST', `/api/invoices/${invoiceId}/cancel`, { reason: 'Erreur de taux' })
    assert.equal(res.status, 200)
    assert.equal(res.body.invoice.status, 'CANCELLED')
    const credit = (await t.api('GET', `/api/invoices/${res.body.creditNoteId}`)).body
    assert.equal(credit.number, 'A-2026-0001')
    assert.equal(credit.kind, 'CREDIT_NOTE')
    assert.equal(credit.totalTtcCents, -67_500)
    const unbilled = (await t.api('GET', '/api/time/entries?billed=unbilled')).body
    assert.ok(unbilled.length >= 3)
    assert.ok(res.body.invoice.reminders.every((r: { status: string }) => r.status === 'CANCELLED'))
  })
})
