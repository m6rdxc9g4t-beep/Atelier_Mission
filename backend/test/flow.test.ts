// Parcours complet : prospect → devis → facture → encaissement → Trésorerie, avec les garde-fous légaux.
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { COMPANY, testApp } from './helpers.ts'

describe('prospect → devis → facture → encaissement', () => {
  let t: Awaited<ReturnType<typeof testApp>>
  before(async () => {
    t = await testApp()
  })
  after(() => t.close())

  let clientId = 0
  let oppId = 0
  let quoteId = 0
  let invoiceId = 0

  it('crée le client et l’opportunité (Nouveau, 10 %)', async () => {
    const client = await t.api('POST', '/api/clients', { name: 'Atelier Vert SAS', email: 'Compta@AtelierVert.example ', channel: 'DIRECT' })
    assert.equal(client.status, 201)
    assert.equal(client.body.email, 'compta@ateliervert.example')
    clientId = client.body.id
    const opp = await t.api('POST', '/api/opportunities', { clientId, title: 'Tableau de bord', dailyRateCents: 50_000, days: 12 })
    assert.equal(opp.status, 201)
    assert.equal(opp.body.amountCents, 600_000)
    assert.equal(opp.body.probability, 10)
    assert.equal(opp.body.source, 'DIRECT')
    oppId = opp.body.id
  })

  it('refuse un champ inconnu', async () => {
    const res = await t.api('POST', '/api/clients', { name: 'X', hacker: true })
    assert.equal(res.status, 400)
    assert.equal(res.body.code, 'VALIDATION')
  })

  it('numérote le devis et fait avancer l’opportunité à l’envoi puis à l’acceptation', async () => {
    const quote = await t.api('POST', '/api/quotes', {
      clientId,
      opportunityId: oppId,
      title: 'Phase 1',
      lines: [
        { label: 'Cadrage', unit: 'DAY', quantity: 2, unitPriceCents: 50_000, vatRateBps: 0 },
        { label: 'Développement', unit: 'DAY', quantity: 10, unitPriceCents: 50_000, vatRateBps: 0 },
      ],
    })
    assert.equal(quote.status, 201)
    assert.equal(quote.body.number, 'D-2026-0001')
    assert.equal(quote.body.totalHtCents, 600_000)
    assert.equal(quote.body.validUntil, '2026-12-03')
    quoteId = quote.body.id
    await t.api('POST', `/api/quotes/${quoteId}/send`)
    assert.equal((await t.api('GET', `/api/opportunities/${oppId}`)).body.stage, 'PROPOSAL')
    assert.equal((await t.api('PATCH', `/api/quotes/${quoteId}`, { title: 'Autre' })).status, 409)
    await t.api('POST', `/api/quotes/${quoteId}/accept`)
    const opp = (await t.api('GET', `/api/opportunities/${oppId}`)).body
    assert.equal(opp.stage, 'WON')
    assert.equal(opp.probability, 100)
  })

  it('transforme le devis en facture brouillon', async () => {
    const res = await t.api('POST', `/api/quotes/${quoteId}/invoice`)
    assert.equal(res.status, 201)
    assert.equal(res.body.status, 'DRAFT')
    assert.equal(res.body.totalTtcCents, 600_000)
    assert.equal(res.body.lines.length, 2)
    invoiceId = res.body.id
  })

  it('refuse d’émettre sans identité du vendeur ni adresse du client', async () => {
    const res = await t.api('POST', `/api/invoices/${invoiceId}/issue`)
    assert.equal(res.status, 400)
    assert.match(res.body.detail, /nom, SIREN ou SIRET, adresse/)
    await t.api('PATCH', '/api/settings', COMPANY)
    const res2 = await t.api('POST', `/api/invoices/${invoiceId}/issue`)
    assert.equal(res2.status, 400)
    assert.match(res2.body.detail, /adresse du client « Atelier Vert SAS »/)
    await t.api('PATCH', `/api/clients/${clientId}`, { address: '27 avenue Jean Jaurès\n38000 Grenoble' })
  })

  it('émet : numéro légal, échéance, coordonnées figées, 3 relances planifiées', async () => {
    const res = await t.api('POST', `/api/invoices/${invoiceId}/issue`)
    assert.equal(res.status, 200)
    assert.equal(res.body.number, 'F-2026-0001')
    assert.equal(res.body.issueDate, '2026-11-03')
    assert.equal(res.body.dueDate, '2026-12-03')
    assert.equal(res.body.reminders.length, 3)
    assert.deepEqual(res.body.reminders.map((r: { dueOn: string }) => r.dueOn), ['2026-12-06', '2026-12-18', '2027-01-02'])
    assert.ok(res.body.legalMentions.some((m: string) => m.includes('293 B')))
    // Les coordonnées du client sont figées : un changement ultérieur ne modifie pas la facture émise.
    await t.api('PATCH', `/api/clients/${clientId}`, { address: 'Nouvelle adresse' })
    assert.match((await t.api('GET', `/api/invoices/${invoiceId}`)).body.client.address, /Grenoble/)
  })

  it('interdit de modifier ou supprimer une facture émise', async () => {
    assert.equal((await t.api('PATCH', `/api/invoices/${invoiceId}`, { title: 'X' })).status, 409)
    assert.equal((await t.api('DELETE', `/api/invoices/${invoiceId}`)).status, 409)
    assert.equal((await t.api('PATCH', `/api/invoices/${invoiceId}`, { notes: 'Merci !' })).status, 200)
  })

  it('refuse une date d’émission antérieure à la dernière facture', async () => {
    const draft = await t.api('POST', '/api/invoices', { clientId, title: 'Avenant', lines: [{ label: 'Jour', unit: 'DAY', quantity: 1, unitPriceCents: 50_000, vatRateBps: 0 }] })
    const res = await t.api('POST', `/api/invoices/${draft.body.id}/issue`, { issueDate: '2026-10-01' })
    assert.equal(res.status, 409)
    await t.api('DELETE', `/api/invoices/${draft.body.id}`)
  })

  it('passe en retard après l’échéance', async () => {
    t.setToday('2026-12-10')
    const list = (await t.api('GET', '/api/invoices?status=OVERDUE')).body
    assert.equal(list.length, 1)
    t.setToday('2026-11-20')
  })

  it('encaissement partiel : facture « payée en partie », Trésorerie en attente de compte', async () => {
    const res = await t.api('POST', `/api/invoices/${invoiceId}/payments`, { amountCents: 200_000, receivedOn: '2026-11-20' })
    assert.equal(res.status, 201)
    assert.equal(res.body.status, 'PARTIALLY_PAID')
    assert.equal(res.body.payments[0].tresorerieStatus, 'PENDING')
    assert.match(res.body.payments[0].tresorerieError, /compte bancaire/)
    assert.equal(t.fakes.tresorerie.created.length, 0)
  })

  it('refuse un encaissement supérieur au reste à payer', async () => {
    const res = await t.api('POST', `/api/invoices/${invoiceId}/payments`, { amountCents: 500_000, receivedOn: '2026-11-21' })
    assert.equal(res.status, 400)
  })

  it('solde : facture payée, relances annulées, opérations Trésorerie sans doublon', async () => {
    await t.api('PATCH', '/api/settings', { integrations: { tresorerieAccountId: 3, tresorerieRevenueCategoryId: 7 } })
    const sync = await t.api('POST', '/api/integrations/tresorerie/sync-pending')
    assert.deepEqual(sync.body, { synced: 1, failed: 0, total: 1 })
    const res = await t.api('POST', `/api/invoices/${invoiceId}/payments`, { amountCents: 400_000, receivedOn: '2026-11-22' })
    assert.equal(res.body.status, 'PAID')
    assert.ok(res.body.reminders.every((r: { status: string }) => r.status === 'CANCELLED'))
    assert.equal(t.fakes.tresorerie.created.length, 2)
    const op = t.fakes.tresorerie.created[1]!
    assert.equal(op.amount_cents, 400_000)
    assert.equal(op.account_id, 3)
    assert.equal(op.category_id, 7)
    assert.match(op.label, /Atelier Vert SAS — facture F-2026-0001/)
    // Un nouvel essai retrouve l'opération par son marqueur : aucun doublon.
    const paymentId = res.body.payments[1].id
    await t.api('POST', `/api/payments/${paymentId}/sync`)
    assert.equal(t.fakes.tresorerie.created.length, 2)
  })

  it('tableau de bord : encaissé du mois, pipeline vide, conversion 100 %', async () => {
    const dash = (await t.api('GET', '/api/dashboard')).body
    assert.equal(dash.kpis.collectedMonthCents, 600_000)
    assert.equal(dash.kpis.outstandingCents, 0)
    assert.equal(dash.kpis.conversionRate, 100)
  })

  it('imprime la facture (HTML échappé, mentions légales)', async () => {
    const res = await t.app.inject({ method: 'GET', url: `/api/invoices/${invoiceId}/print`, headers: { host: '127.0.0.1:3001' } })
    assert.equal(res.statusCode, 200)
    assert.match(res.headers['content-type'] as string, /text\/html/)
    assert.match(res.body, /F-2026-0001/)
    assert.match(res.body, /TVA non applicable, art\. 293 B du CGI/)
    assert.match(res.body, /40 €/)
  })
})

describe('mission Malt : versement net et frais en dépense', () => {
  it('envoie le brut en revenu et les frais Malt TTC en dépense, sans numéro légal propre', async () => {
    const t = await testApp()
    try {
      await t.api('PATCH', '/api/settings', { ...COMPANY, integrations: { tresorerieAccountId: 3, tresorerieRevenueCategoryId: 7, tresorerieFeeCategoryId: 8 } })
      const client = await t.api('POST', '/api/clients', { name: 'Bellevue', channel: 'MALT', maltFeeBps: 1000 })
      const draft = await t.api('POST', '/api/invoices', { clientId: client.body.id, title: 'Sprint 1', lines: [{ label: 'Jours', unit: 'DAY', quantity: 3.5, unitPriceCents: 55_000, vatRateBps: 0 }] })
      assert.equal(draft.body.channel, 'MALT')
      assert.equal(draft.body.remindersEnabled, false)
      const issued = await t.api('POST', `/api/invoices/${draft.body.id}/issue`, { externalRef: 'MALT-48213' })
      assert.equal(issued.body.number, null)
      assert.equal(issued.body.displayNumber, 'Malt MALT-48213')
      assert.equal(issued.body.reminders.length, 0)
      assert.equal(issued.body.malt.netPayoutCents, 192_500 - 23_100)
      await t.api('POST', `/api/invoices/${draft.body.id}/payments`, { amountCents: 192_500, receivedOn: '2026-11-03' })
      assert.deepEqual(
        t.fakes.tresorerie.created.map((o) => [o.amount_cents, o.category_id]),
        [
          [192_500, 7],
          [-23_100, 8],
        ],
      )
    } finally {
      await t.close()
    }
  })
})
