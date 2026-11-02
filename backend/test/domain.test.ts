import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { addDays, daysBetween, lastMonths, localDate } from '../src/domain/dates.ts'
import { effectiveStatus, formatDocumentNumber, legalMentions, maltFees, statusAfterPayments } from '../src/domain/invoicing.ts'
import { computeTotals, formatEuros, lineTotalCents } from '../src/domain/money.ts'
import { conversionRate, probabilityAfterMove, weightedCents } from '../src/domain/pipeline.ts'
import { escapeHtml, planReminders, reminderEmail } from '../src/domain/reminders.ts'
import { buildTimeLines, minutesToQuantityMilli } from '../src/domain/time-billing.ts'

describe('montants', () => {
  it('calcule une ligne en centimes sans flottant résiduel', () => {
    assert.equal(lineTotalCents(2500, 55_000), 137_500)
    assert.equal(lineTotalCents(333, 10_001), 3330) // 3,330333 → 3 330 centimes
    assert.equal(lineTotalCents(-2500, 55_000), -137_500)
  })

  it('calcule la TVA par taux, sur la base de chaque taux', () => {
    const totals = computeTotals([
      { quantityMilli: 1000, unitPriceCents: 333, vatRateBps: 2000 },
      { quantityMilli: 1000, unitPriceCents: 333, vatRateBps: 2000 },
      { quantityMilli: 1000, unitPriceCents: 1000, vatRateBps: 0 },
    ])
    assert.equal(totals.htCents, 1666)
    assert.deepEqual(totals.byRate, [
      { rateBps: 0, baseCents: 1000, vatCents: 0 },
      { rateBps: 2000, baseCents: 666, vatCents: 133 },
    ])
    assert.equal(totals.ttcCents, 1799)
  })

  it('formate en euros à la française', () => {
    assert.match(formatEuros(123_456), /^1\s234,56\s€$/)
  })
})

describe('dates', () => {
  it('donne le jour local à Paris, pas le jour UTC', () => {
    assert.equal(localDate(new Date('2026-11-02T23:30:00Z'), 'Europe/Paris'), '2026-11-03')
  })
  it('ajoute des jours et compte les écarts, années bissextiles comprises', () => {
    assert.equal(addDays('2028-02-28', 1), '2028-02-29')
    assert.equal(daysBetween('2026-11-03', '2026-12-03'), 30)
    assert.deepEqual(lastMonths('2026-03-15', 4), ['2025-12', '2026-01', '2026-02', '2026-03'])
  })
})

describe('facturation', () => {
  it('passe en retard une facture émise dont l’échéance est dépassée', () => {
    assert.equal(effectiveStatus('ISSUED', '2026-11-02', '2026-11-03'), 'OVERDUE')
    assert.equal(effectiveStatus('ISSUED', '2026-11-03', '2026-11-03'), 'ISSUED')
    assert.equal(effectiveStatus('PAID', '2026-01-01', '2026-11-03'), 'PAID')
  })
  it('déduit le statut des encaissements', () => {
    assert.equal(statusAfterPayments(1000, 0), 'ISSUED')
    assert.equal(statusAfterPayments(1000, 400), 'PARTIALLY_PAID')
    assert.equal(statusAfterPayments(1000, 1000), 'PAID')
  })
  it('numérote sur 4 chiffres', () => {
    assert.equal(formatDocumentNumber('F', 2026, 7), 'F-2026-0007')
  })
  it('calcule les frais Malt (HT + TVA 20 %) et le versement net', () => {
    assert.deepEqual(maltFees(192_500, 192_500, 1000), { feeHtCents: 19_250, feeVatCents: 3_850, feeTtcCents: 23_100, netPayoutCents: 169_400 })
  })
  it('ajoute la mention de franchise en base de TVA et l’indemnité de 40 €', () => {
    const mentions = legalMentions({ vatRegime: 'FRANCHISE', latePenaltyRateText: 'x', recoveryFeeCents: 4000, isB2B: true })
    assert.ok(mentions.some((m) => m.includes('293 B')))
    assert.ok(mentions.some((m) => m.includes('40 €')))
    assert.ok(!legalMentions({ vatRegime: 'REEL', latePenaltyRateText: 'x', recoveryFeeCents: 4000, isB2B: true }).some((m) => m.includes('293 B')))
  })
})

describe('pipeline', () => {
  it('pondère et applique la probabilité de l’étape quand elle n’a pas été personnalisée', () => {
    assert.equal(weightedCents(100_000, 25), 25_000)
    assert.equal(probabilityAfterMove(10, 'NEW', 'PROPOSAL'), 50)
    assert.equal(probabilityAfterMove(65, 'PROPOSAL', 'NEGOTIATION'), 65)
    assert.equal(probabilityAfterMove(65, 'NEGOTIATION', 'WON'), 100)
    assert.equal(conversionRate(2, 1), 67)
    assert.equal(conversionRate(0, 0), null)
  })
})

describe('temps → lignes', () => {
  const entries = [
    { id: 1, projetsProjectName: 'P', workItemId: 12, workItemTitle: 'Maquettes', workItemType: 'TASK', spentOn: '2026-10-02', minutes: 420, comment: '' },
    { id: 2, projetsProjectName: 'P', workItemId: 12, workItemTitle: 'Maquettes', workItemType: 'TASK', spentOn: '2026-10-01', minutes: 210, comment: '' },
    { id: 3, projetsProjectName: 'P', workItemId: 15, workItemTitle: 'API', workItemType: 'TASK', spentOn: '2026-10-05', minutes: 90, comment: 'revue' },
  ]
  it('convertit les minutes en jours ou en heures (millièmes)', () => {
    assert.equal(minutesToQuantityMilli(630, 'DAY', 7), 1500)
    assert.equal(minutesToQuantityMilli(90, 'HOUR', 7), 1500)
  })
  it('regroupe par élément, dans l’ordre chronologique, avec les saisies liées', () => {
    const lines = buildTimeLines(entries, { unit: 'DAY', hoursPerDay: 7, rateCents: 55_000, vatRateBps: 0, grouping: 'WORK_ITEM' })
    assert.equal(lines.length, 2)
    assert.equal(lines[0]!.label, '#12 Maquettes')
    assert.equal(lines[0]!.quantityMilli, 1500)
    assert.deepEqual(lines[0]!.entryIds, [1, 2])
    assert.match(lines[0]!.details, /10 h 30 du 01\/10\/2026 au 02\/10\/2026/)
  })
  it('peut tout regrouper en une ligne par projet', () => {
    const lines = buildTimeLines(entries, { unit: 'HOUR', hoursPerDay: 7, rateCents: 8000, vatRateBps: 2000, grouping: 'PROJECT' })
    assert.equal(lines.length, 1)
    assert.equal(lines[0]!.quantityMilli, 12_000)
  })
})

describe('relances', () => {
  it('planifie au plus 3 niveaux, triés, sans doublon', () => {
    assert.deepEqual(planReminders('2026-11-01', [30, 3, 15, 3, 60]), [
      { level: 1, dueOn: '2026-11-04' },
      { level: 2, dueOn: '2026-11-16' },
      { level: 3, dueOn: '2026-12-01' },
    ])
  })
  it('échappe le HTML venu des données (nom du client, titre de la facture)', () => {
    assert.equal(escapeHtml('<b>"x"</b>'), '&lt;b&gt;&quot;x&quot;&lt;/b&gt;')
    const email = reminderEmail({
      level: 2,
      invoiceNumber: 'F-2026-0002',
      invoiceTitle: '<script>alert(1)</script>',
      issueDate: '2026-10-01',
      dueDate: '2026-10-31',
      balanceCents: 150_000,
      daysLate: 12,
      clientContactName: 'Hugo',
      clientName: 'Pixel',
      sellerName: 'Camille',
      sellerEmail: null,
      iban: null,
      latePenaltyRateText: 'trois fois le taux légal',
      recoveryFeeCents: 4000,
    })
    assert.ok(!email.html.includes('<script>'))
    assert.match(email.subject, /12 jours de retard/)
    assert.match(email.text, /40,00/)
  })
})
