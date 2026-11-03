// Facture électronique via SUPER PDP : garde-fous, dépôt automatique, statuts, « Encaissée », reprise après coupure.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { splitPaymentByRate } from '../src/domain/einvoicing.ts'
import { UpstreamError } from '../src/integrations/http.ts'
import { createSuperPdpClient } from '../src/integrations/superpdp.ts'
import { COMPANY, testApp } from './helpers.ts'

async function issued(t: Awaited<ReturnType<typeof testApp>>, options: { siren?: string | null; online?: boolean; vat?: boolean } = {}) {
  await t.api('PATCH', '/api/settings', COMPANY)
  if (options.online !== false) await t.api('PUT', '/api/settings/online-mode', { online: true })
  const client = (await t.api('POST', '/api/clients', { name: 'Pixel', address: '3 place du Marché\n44000 Nantes', siren: options.siren === undefined ? '834567890' : options.siren })).body
  const draft = (await t.api('POST', '/api/invoices', { clientId: client.id, title: 'Audit', lines: [{ label: 'Audit', unit: 'DAY', quantity: 2.5, unitPriceCents: 55_000, vatRateBps: 0 }, { label: 'Atelier', unit: 'FLAT', quantity: 1, unitPriceCents: 30_000, vatRateBps: 0 }] })).body
  return (await t.api('POST', `/api/invoices/${draft.id}/issue`)).body
}

describe('facture électronique SUPER PDP', () => {
  it('ne part pas hors ligne ni sans identifiants', async () => {
    const t = await testApp()
    try {
      const invoice = await issued(t, { online: false })
      assert.equal(t.fakes.superpdp.deposits.length, 0)
      const res = await t.api('POST', `/api/invoices/${invoice.id}/einvoice`)
      assert.equal(res.status, 403)
      assert.equal(res.body.code, 'OFFLINE')
    } finally {
      await t.close()
    }
    const none = await testApp({ superpdp: false })
    try {
      const invoice = await issued(none)
      assert.equal((await none.api('POST', `/api/invoices/${invoice.id}/einvoice`)).body.code, 'SUPERPDP_NOT_CONFIGURED')
      assert.equal((await none.api('GET', '/api/settings')).body.superpdpConfigured, false)
    } finally {
      await none.close()
    }
  })

  it('exige le SIREN du client (acheminement vers sa plateforme)', async () => {
    const t = await testApp()
    try {
      const invoice = await issued(t, { siren: null })
      assert.equal(t.fakes.superpdp.deposits.length, 0)
      assert.match(invoice.einvoice.eligibility, /SIREN du client/)
      assert.equal((await t.api('POST', `/api/invoices/${invoice.id}/einvoice`)).status, 400)
    } finally {
      await t.close()
    }
  })

  it('dépose le Factur-X à l’émission (une seule fois) et suit les statuts par curseur', async () => {
    const t = await testApp()
    try {
      const invoice = await issued(t)
      assert.equal(t.fakes.superpdp.deposits.length, 1)
      const deposit = t.fakes.superpdp.deposits[0]!
      assert.equal(deposit.externalId, 'F-2026-0001')
      assert.equal(Buffer.from(deposit.pdf.slice(0, 5)).toString(), '%PDF-')
      assert.equal(invoice.einvoice.transmission.state, 'SENT')
      assert.equal(invoice.einvoice.transmission.remoteId, deposit.id)
      assert.equal(invoice.einvoice.transmission.lastStatusLabel, 'Déposée')
      assert.equal((await t.api('POST', `/api/invoices/${invoice.id}/einvoice`)).status, 409)

      t.platformEvent(deposit.id, 'fr:202', 'Reçue par la plateforme')
      t.platformEvent(999_999, 'fr:204') // facture inconnue (reçue d'un fournisseur) : ignorée
      t.platformEvent(deposit.id, 'fr:205', 'Approuvée')
      const sync = await t.api('POST', '/api/einvoicing/sync')
      assert.deepEqual(sync.body, { events: 2, reports: 0, blocked: null })
      assert.deepEqual((await t.api('POST', '/api/einvoicing/sync')).body.events, 0)
      const after = (await t.api('GET', `/api/invoices/${invoice.id}`)).body
      assert.equal(after.einvoice.transmission.lastStatusLabel, 'Approuvée')
      assert.deepEqual(after.einvoice.transmission.events.map((e: { statusCode: string }) => e.statusCode), ['fr:200', 'fr:202', 'fr:205'])
      const events = (await t.api('GET', '/api/atelier/events?types=mission.einvoice.sent,mission.einvoice.status_changed')).body.events
      assert.equal(events[0].type, 'mission.einvoice.sent')
      assert.equal(events.filter((e: { type: string }) => e.type === 'mission.einvoice.status_changed').length, 3)
    } finally {
      await t.close()
    }
  })

  it('signale un rejet de la plateforme et refuse de redéposer la même facture', async () => {
    const t = await testApp()
    try {
      const invoice = await issued(t)
      t.platformEvent(t.fakes.superpdp.deposits[0]!.id, 'fr:213', 'Rejetée', 'BR-FR-12 : adresse électronique du destinataire inconnue')
      await t.api('POST', '/api/einvoicing/sync')
      const after = (await t.api('GET', `/api/invoices/${invoice.id}`)).body
      assert.equal(after.einvoice.transmission.state, 'REJECTED')
      assert.match(after.einvoice.transmission.error, /BR-FR-12/)
      assert.ok(after.activities.some((a: { message: string }) => /Rejetée — BR-FR-12/.test(a.message)))
      assert.match((await t.api('POST', `/api/invoices/${invoice.id}/einvoice`)).body.detail, /avoir/)
    } finally {
      await t.close()
    }
  })

  it('transmet « Encaissée » (fr:212) à l’encaissement, sans doublon', async () => {
    const t = await testApp()
    try {
      const invoice = await issued(t)
      await t.api('POST', `/api/invoices/${invoice.id}/payments`, { amountCents: 167_500, receivedOn: '2026-11-20' })
      assert.equal(t.fakes.superpdp.reports.length, 1)
      assert.deepEqual(t.fakes.superpdp.reports[0], { invoiceId: t.fakes.superpdp.deposits[0]!.id, reports: [{ amountCents: 167_500, ratePercent: '0', date: '2026-11-20' }] })
      const paid = (await t.api('GET', `/api/invoices/${invoice.id}`)).body
      assert.equal(paid.payments[0].einvoiceReport.state, 'SENT')
      await t.api('POST', '/api/einvoicing/sync')
      await t.api('POST', `/api/payments/${paid.payments[0].id}/einvoice-report`)
      assert.equal(t.fakes.superpdp.reports.length, 1)
      const del = await t.api('DELETE', `/api/payments/${paid.payments[0].id}`)
      assert.match(del.body.warning, /Encaissée/)
    } finally {
      await t.close()
    }
  })

  it('reprend un dépôt dont la réponse s’est perdue sans le redéposer ; réessaie après un refus HTTP', async () => {
    const t = await testApp()
    try {
      await t.api('PATCH', '/api/settings', { einvoicing: { autoSend: false } })
      const invoice = await issued(t)
      assert.equal(t.fakes.superpdp.deposits.length, 0)
      // 1. Coupure : la plateforme a reçu la facture mais la réponse n'arrive pas.
      t.fakes.superpdp.failNext = new UpstreamError('SUPERPDP_ERROR', 'SUPER PDP injoignable (délai dépassé)')
      assert.equal((await t.api('POST', `/api/invoices/${invoice.id}/einvoice`)).status, 502)
      assert.equal((await t.api('GET', `/api/invoices/${invoice.id}`)).body.einvoice.transmission.state, 'UNKNOWN')
      t.fakes.superpdp.deposits.push({ externalId: 'F-2026-0001', pdf: new Uint8Array(), id: 777 })
      const retry = await t.api('POST', `/api/invoices/${invoice.id}/einvoice`)
      assert.equal(retry.body.transmission.state, 'SENT')
      assert.equal(retry.body.transmission.remoteId, 777)
      assert.equal(t.fakes.superpdp.deposits.length, 1)
    } finally {
      await t.close()
    }
    const t2 = await testApp()
    try {
      await t2.api('PATCH', '/api/settings', { einvoicing: { autoSend: false } })
      const invoice = await issued(t2)
      t2.fakes.superpdp.failNext = new UpstreamError('SUPERPDP_ERROR', 'SUPER PDP a refusé la requête (HTTP 400) : facture invalide', 400)
      await t2.api('POST', `/api/invoices/${invoice.id}/einvoice`)
      assert.equal((await t2.api('GET', `/api/invoices/${invoice.id}`)).body.einvoice.transmission.state, 'FAILED')
      assert.equal((await t2.api('POST', `/api/invoices/${invoice.id}/einvoice`)).body.transmission.state, 'SENT')
    } finally {
      await t2.close()
    }
  })

  it('dépose l’avoir quand la facture annulée avait été déposée', async () => {
    const t = await testApp()
    try {
      const invoice = await issued(t)
      const cancel = (await t.api('POST', `/api/invoices/${invoice.id}/cancel`, { reason: 'Erreur' })).body
      assert.deepEqual(t.fakes.superpdp.deposits.map((d) => d.externalId), ['F-2026-0001', 'A-2026-0001'])
      assert.equal((await t.api('GET', `/api/invoices/${cancel.creditNoteId}`)).body.einvoice.transmission.state, 'SENT')
    } finally {
      await t.close()
    }
  })

  it('ne dépose jamais une facture Malt', async () => {
    const t = await testApp()
    try {
      await t.api('PUT', '/api/settings/online-mode', { online: true })
      const malt = (await t.api('POST', '/api/clients', { name: 'Bellevue', channel: 'MALT', siren: '823456789' })).body
      const draft = (await t.api('POST', '/api/invoices', { clientId: malt.id, title: 'Sprint', lines: [{ label: 'Jour', unit: 'DAY', quantity: 1, unitPriceCents: 50_000, vatRateBps: 0 }] })).body
      const res = (await t.api('POST', `/api/invoices/${draft.id}/issue`, { externalRef: 'M-1' })).body
      assert.match(res.einvoice.eligibility, /Malt/)
      assert.equal(t.fakes.superpdp.deposits.length, 0)
    } finally {
      await t.close()
    }
  })
})

describe('données de paiement par taux', () => {
  it('répartit un encaissement au prorata du TTC de chaque taux, au centime près', () => {
    const buckets = [
      { rateBps: 1000, baseCents: 100_000, vatCents: 10_000 },
      { rateBps: 2000, baseCents: 50_000, vatCents: 10_000 },
    ]
    const parts = splitPaymentByRate(100_001, buckets, false)
    assert.equal(parts.reduce((s, p) => s + p.amountCents, 0), 100_001)
    assert.deepEqual(parts.map((p) => p.rateBps), [1000, 2000])
    assert.equal(parts[0]!.amountCents, 64_707) // 100 001 × 110 000 / 170 000 = 64 706,53
    assert.deepEqual(splitPaymentByRate(5000, buckets, true), [{ rateBps: 0, amountCents: 5000 }])
  })
})

describe('client HTTP SUPER PDP', () => {
  it('s’authentifie en client_credentials, réutilise le jeton, dépose le PDF brut et déclare fr:212', async () => {
    const calls: { url: string; init?: RequestInit }[] = []
    const fetchImpl = async (url: string, init?: RequestInit) => {
      calls.push({ url, init })
      const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
      if (url.endsWith('/oauth2/token')) return json({ access_token: 'tok-1', expires_in: 1800 })
      if (url.includes('/v1.beta/invoices?external_id=')) return json({ id: 42, direction: 'out', external_id: 'F-2026-0001', events: [] })
      if (url.endsWith('/v1.beta/invoice_events')) return json({ id: 7, invoice_id: 42, status_code: 'fr:212', created_at: '2026-11-20T10:00:00Z' })
      return new Response('{}', { status: 404 })
    }
    const client = createSuperPdpClient({ clientId: 'id', clientSecret: 's3cr3t' }, fetchImpl)
    await client.sendInvoice(new Uint8Array([37, 80, 68, 70]), 'F-2026-0001')
    await client.reportPayment(42, [{ amountCents: 167_500, ratePercent: '0', date: '2026-11-20' }])
    const [token, deposit, report] = calls
    assert.equal(calls.filter((c) => c.url.endsWith('/oauth2/token')).length, 1)
    assert.equal(String(token!.init?.body), 'grant_type=client_credentials&client_id=id&client_secret=s3cr3t')
    assert.equal((token!.init?.headers as Record<string, string>)['content-type'], 'application/x-www-form-urlencoded')
    assert.equal(deposit!.url, 'https://api.superpdp.tech/v1.beta/invoices?external_id=F-2026-0001')
    assert.equal((deposit!.init?.headers as Record<string, string>)['content-type'], 'application/pdf')
    assert.equal((deposit!.init?.headers as Record<string, string>).authorization, 'Bearer tok-1')
    assert.deepEqual(JSON.parse(String(report!.init?.body)), {
      invoice_id: 42,
      status_code: 'fr:212',
      details: [{ reported_data: [{ amount: '1675.00', currency_code: 'EUR', type_code: 'MEN', value_percent: '0', date: '2026-11-20' }] }],
    })
  })
})
