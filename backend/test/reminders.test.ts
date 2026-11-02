// Relances par Brevo : hors ligne par défaut, une seule relance par facture, échecs enregistrés.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { COMPANY, testApp } from './helpers.ts'

async function overdueInvoice(t: Awaited<ReturnType<typeof testApp>>, email: string | null = 'hugo@pixel.example') {
  await t.api('PATCH', '/api/settings', { ...COMPANY, integrations: { brevoSenderEmail: 'factures@camille.example', brevoSenderName: 'Camille Martin' } })
  const client = (await t.api('POST', '/api/clients', { name: 'Studio <Pixel>', address: 'Nantes', email, contactName: 'Hugo' })).body
  const draft = (await t.api('POST', '/api/invoices', { clientId: client.id, title: 'Audit SEO', paymentTermsDays: 15, lines: [{ label: 'Audit', unit: 'DAY', quantity: 3, unitPriceCents: 50_000, vatRateBps: 0 }] })).body
  return (await t.api('POST', `/api/invoices/${draft.id}/issue`, { issueDate: '2026-10-01' })).body
}

describe('relances Brevo', () => {
  it('reste hors ligne par défaut : rien ne part', async () => {
    const t = await testApp({ start: '2026-10-01' })
    try {
      const invoice = await overdueInvoice(t)
      t.setToday('2026-10-20')
      const list = (await t.api('GET', '/api/reminders?scope=due')).body
      assert.equal(list.blocker.code, 'OFFLINE')
      const res = await t.api('POST', `/api/reminders/${invoice.reminders[0].id}/send`)
      assert.equal(res.status, 403)
      assert.equal(res.body.code, 'OFFLINE')
      assert.equal(t.fakes.brevo.sent.length, 0)
    } finally {
      await t.close()
    }
  })

  it('en ligne : n’envoie que le niveau le plus élevé dû et dépasse les autres', async () => {
    const t = await testApp({ start: '2026-10-01' })
    try {
      const invoice = await overdueInvoice(t)
      await t.api('PUT', '/api/settings/online-mode', { online: true })
      t.setToday('2026-11-05') // échéance 16/10 : niveaux 1 (19/10) et 2 (31/10) dus, 3 (15/11) à venir
      const due = (await t.api('GET', '/api/reminders?scope=due')).body
      assert.equal(due.reminders.length, 2)
      assert.equal(due.blocker, null)
      const run = await t.api('POST', '/api/reminders/run')
      assert.deepEqual(run.body, { sent: 1, failed: 0, skipped: 0, blocked: null })
      const sent = t.fakes.brevo.sent[0]!
      assert.equal(sent.to[0]!.email, 'hugo@pixel.example')
      assert.equal(sent.sender.email, 'factures@camille.example')
      assert.match(sent.subject, /Relance : facture F-2026-0001 impayée \(20 jours de retard\)/)
      assert.deepEqual(sent.bcc, [{ email: 'camille@example.com' }])
      const after = (await t.api('GET', `/api/invoices/${invoice.id}`)).body.reminders
      assert.deepEqual(after.map((r: { status: string }) => r.status), ['CANCELLED', 'SENT', 'PLANNED'])
      const events = (await t.api('GET', '/api/atelier/events?types=mission.reminder.sent')).body.events
      assert.equal(events.length, 1)
      assert.equal(events[0].data.level, 2)
    } finally {
      await t.close()
    }
  })

  it('le planificateur n’envoie rien tant que l’envoi automatique est désactivé', async () => {
    const t = await testApp({ start: '2026-10-01' })
    try {
      await overdueInvoice(t)
      await t.api('PUT', '/api/settings/online-mode', { online: true })
      t.setToday('2026-10-25')
      const { runDueReminders } = await import('../src/services/reminders.ts')
      assert.equal((await runDueReminders(t.app.ctx)).blocked, 'AUTO_SEND_DISABLED')
      await t.api('PATCH', '/api/settings', { reminders: { autoSend: true } })
      assert.equal((await runDueReminders(t.app.ctx)).sent, 1)
    } finally {
      await t.close()
    }
  })

  it('enregistre l’échec de Brevo et refuse sans adresse client ou sans clé', async () => {
    const t = await testApp({ start: '2026-10-01' })
    try {
      const invoice = await overdueInvoice(t)
      await t.api('PUT', '/api/settings/online-mode', { online: true })
      t.setToday('2026-10-20')
      t.fakes.brevo.fail = true
      const res = await t.api('POST', `/api/reminders/${invoice.reminders[0].id}/send`)
      assert.equal(res.status, 502)
      const reminder = (await t.api('GET', `/api/invoices/${invoice.id}`)).body.reminders[0]
      assert.equal(reminder.status, 'FAILED')
      assert.match(reminder.error, /401/)
    } finally {
      await t.close()
    }
    const noKey = await testApp({ start: '2026-10-01', brevo: false })
    try {
      await overdueInvoice(noKey)
      await noKey.api('PUT', '/api/settings/online-mode', { online: true })
      assert.equal((await noKey.api('GET', '/api/reminders')).body.blocker.code, 'BREVO_NOT_CONFIGURED')
      assert.equal((await noKey.api('GET', '/api/settings')).body.brevoKeyConfigured, false)
    } finally {
      await noKey.close()
    }
  })

  it('prévisualise l’e-mail avec les données échappées', async () => {
    const t = await testApp({ start: '2026-10-01' })
    try {
      const invoice = await overdueInvoice(t)
      const preview = (await t.api('GET', `/api/reminders/${invoice.reminders[0].id}/preview`)).body
      assert.equal(preview.to, 'hugo@pixel.example')
      assert.match(preview.html, /Bonjour Hugo/)
      assert.match(preview.text, /FR76 0000/)
    } finally {
      await t.close()
    }
  })
})
