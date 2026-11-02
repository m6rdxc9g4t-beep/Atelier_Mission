// Données de démonstration (fictives) : `npm run db:seed`. Ne fait rien si la base contient déjà des clients
// (sauf avec --force sur une base vide de clients). Les dates sont calculées autour d'aujourd'hui.
import { loadEnvFile, readConfig } from '../src/config.ts'
import { openDatabase } from '../src/db/client.ts'
import { clients } from '../src/db/schema.ts'
import { addDays, localDate } from '../src/domain/dates.ts'
import type { Ctx } from '../src/services/context.ts'
import { createClient } from '../src/services/clients.ts'
import { createInvoice, issueInvoice } from '../src/services/invoices.ts'
import { createOpportunity, moveOpportunity } from '../src/services/opportunities.ts'
import { recordPayment } from '../src/services/payments.ts'
import { acceptQuote, createQuote, sendQuote } from '../src/services/quotes.ts'
import { updateSettings } from '../src/services/settings.ts'
import { applyTimeSnapshot, createInvoiceFromTime } from '../src/services/time.ts'

loadEnvFile()
const { databasePath } = readConfig()
const { db, close } = openDatabase(databasePath)

if (db.select().from(clients).all().length > 0) {
  console.log('Base déjà remplie : rien à faire.')
  close()
  process.exit(0)
}

const realToday = localDate(new Date())
// Horloge réglable : chaque étape « se passe » à la date voulue, pour que la numérotation reste chronologique.
let clock = new Date()
const at = (isoDate: string) => {
  clock = new Date(`${isoDate}T10:00:00Z`)
}
const offline = { projets: () => { throw new Error('hors ligne') }, tresorerie: () => { throw new Error('hors ligne') }, brevo: null }
const ctx: Ctx = { db, now: () => clock, timeZone: 'Europe/Paris', integrations: offline as unknown as Ctx['integrations'] }
const d = (offset: number) => addDays(realToday, offset)

updateSettings(db, {
  company: {
    name: 'Camille Martin EI',
    legalForm: 'EI',
    siren: '912345678',
    siret: '91234567800017',
    address: '12 rue des Artisans\n69002 Lyon',
    email: 'contact@camille-martin.example',
    phone: '06 12 34 56 78',
    iban: 'FR76 3000 6000 0112 3456 7890 189',
    bic: 'AGRIFRPP',
    vatRegime: 'FRANCHISE',
  },
  billing: { defaultDailyRateCents: 55_000, hoursPerDay: 7 },
  integrations: { tresorerieAutoSync: false },
})

const bellevue = createClient(ctx, {
  name: 'Bellevue Logistique',
  channel: 'MALT',
  contactName: 'Sophie Durand',
  email: 'sophie.durand@bellevue.example',
  address: '4 quai Perrache\n69002 Lyon',
  siren: '823456789',
  maltFeeBps: 1000,
})
const atelierVert = createClient(ctx, {
  name: 'Atelier Vert SAS',
  channel: 'DIRECT',
  contactName: 'Yanis Benali',
  email: 'compta@ateliervert.example',
  address: '27 avenue Jean Jaurès\n38000 Grenoble',
  siren: '834567890',
  paymentTermsDays: 30,
})
const nova = createClient(ctx, { name: 'Nova Santé', channel: 'MALT', contactName: 'Léa Fontaine', email: 'lea@novasante.example', address: '9 rue Pasteur\n75011 Paris' })
const pixel = createClient(ctx, { name: 'Studio Pixel & Co', channel: 'DIRECT', contactName: 'Hugo Lambert', email: 'hugo@pixelco.example', address: '3 place du Marché\n44000 Nantes' })
const mairie = createClient(ctx, { name: 'Mairie de Villeneuve', channel: 'DIRECT', contactName: 'Service numérique', email: 'numerique@villeneuve.example', address: 'Place de la République\n69100 Villeneuve' })

// Pipeline
at(d(-70))
const oppBellevue = createOpportunity(ctx, { clientId: bellevue.id, title: 'Refonte du portail transporteurs', source: 'MALT', dailyRateCents: 55_000, days: 20, projetsProjectId: 1, maltUrl: 'https://www.malt.fr/' })
moveOpportunity(ctx, oppBellevue.id, { stage: 'WON' })
at(d(-40))
const oppVert = createOpportunity(ctx, { clientId: atelierVert.id, title: 'Tableau de bord de production', source: 'REFERRAL', amountCents: 660_000 })
createOpportunity(ctx, { clientId: nova.id, title: 'Audit accessibilité RGAA', source: 'MALT', amountCents: 330_000, stage: 'QUALIFIED', nextAction: 'Appel de cadrage', nextActionDate: d(1) })
createOpportunity(ctx, { clientId: pixel.id, title: 'Site vitrine + CMS', source: 'NETWORK', amountCents: 480_000, stage: 'NEW', nextAction: 'Envoyer les références', nextActionDate: d(-1) })
const oppMairie = createOpportunity(ctx, { clientId: mairie.id, title: 'Application de signalement', source: 'DIRECT', amountCents: 1_200_000, stage: 'NEGOTIATION', probability: 60, nextAction: 'Relancer après le conseil municipal', nextActionDate: d(5) })
createOpportunity(ctx, { clientId: nova.id, title: 'Maintenance annuelle', source: 'MALT', amountCents: 240_000, stage: 'NEW' })
const lost = createOpportunity(ctx, { clientId: pixel.id, title: 'Application mobile événementielle', source: 'NETWORK', amountCents: 900_000, stage: 'PROPOSAL' })
moveOpportunity(ctx, lost.id, { stage: 'LOST', lostReason: 'Budget reporté à 2027' })

// Devis
at(d(-38))
const quoteVert = createQuote(ctx, {
  clientId: atelierVert.id,
  opportunityId: oppVert.id,
  title: 'Tableau de bord de production — phase 1',
  lines: [
    { label: 'Ateliers de cadrage', unit: 'DAY', quantity: 2, unitPriceCents: 55_000, vatRateBps: 0 },
    { label: 'Développement du tableau de bord', unit: 'DAY', quantity: 10, unitPriceCents: 55_000, vatRateBps: 0 },
  ],
})
sendQuote(ctx, quoteVert.id)
at(d(-35))
acceptQuote(ctx, quoteVert.id)
at(d(-6))
const quoteMairie = createQuote(ctx, {
  clientId: mairie.id,
  opportunityId: oppMairie.id,
  title: 'Application de signalement citoyen',
  lines: [
    { label: 'Conception UX et maquettes', unit: 'DAY', quantity: 5, unitPriceCents: 60_000, vatRateBps: 0 },
    { label: 'Développement et mise en ligne', unit: 'DAY', quantity: 15, unitPriceCents: 60_000, vatRateBps: 0 },
    { label: 'Formation des agents', unit: 'FLAT', quantity: 1, unitPriceCents: 90_000, vatRateBps: 0 },
  ],
})
sendQuote(ctx, quoteMairie.id)

// Temps passé (instantané fictif d'Atelier Projets, projet 1 = mission Bellevue)
const timeRows = [
  [101, 12, 'Cartographie des flux transporteurs', -30, 7],
  [102, 12, 'Cartographie des flux transporteurs', -29, 3.5],
  [103, 14, 'Maquettes du portail', -28, 7],
  [104, 14, 'Maquettes du portail', -27, 7],
  [105, 15, 'API de suivi des expéditions', -16, 7],
  [106, 15, 'API de suivi des expéditions', -15, 7],
  [107, 15, 'API de suivi des expéditions', -14, 6],
  [108, 16, 'Tableau de bord transporteurs', -9, 7],
  [109, 16, 'Tableau de bord transporteurs', -8, 7],
  [110, 17, 'Corrections retour recette', -3, 4.5],
] as const
applyTimeSnapshot(
  ctx,
  1,
  timeRows.map(([id, el, title, offset, hours]) => ({ id, element_id: el, element: title, type: 'TASK', projet: 'Portail transporteurs Bellevue', date: d(offset), heures: hours, commentaire: null })),
  false,
)

// Factures
at(d(-34))
const inv1 = createInvoice(ctx, { clientId: atelierVert.id, title: 'Acompte 30 % — tableau de bord de production', quoteId: quoteVert.id, opportunityId: oppVert.id, lines: [{ label: 'Acompte 30 % sur devis', unit: 'FLAT', quantity: 1, unitPriceCents: 198_000, vatRateBps: 0 }] })
issueInvoice(ctx, inv1, { issueDate: d(-34) })
at(d(-20))
await recordPayment(ctx, inv1, { amountCents: 198_000, receivedOn: d(-20), method: 'TRANSFER' })

at(d(-25))
const inv2 = createInvoiceFromTime(ctx, { clientId: bellevue.id, projectId: 1, to: d(-27), unit: 'DAY', rateCents: 55_000, opportunityId: oppBellevue.id, title: 'Portail transporteurs — cadrage et maquettes' })
issueInvoice(ctx, inv2.id, { issueDate: d(-25), externalRef: 'MALT-2026-48213' })
at(d(-12))
await recordPayment(ctx, inv2.id, { amountCents: inv2.totalTtcCents, receivedOn: d(-12), method: 'MALT' })

at(d(-24))
const inv3 = createInvoice(ctx, {
  clientId: pixel.id,
  title: 'Audit SEO et performance',
  paymentTermsDays: 15,
  lines: [{ label: 'Audit SEO technique et recommandations', unit: 'DAY', quantity: 3, unitPriceCents: 50_000, vatRateBps: 0 }],
})
issueInvoice(ctx, inv3, { issueDate: d(-24) })

at(d(-4))
const inv4 = createInvoice(ctx, { clientId: atelierVert.id, title: 'Tableau de bord — livraison phase 1', opportunityId: oppVert.id, lines: [{ label: 'Solde phase 1 (70 %)', unit: 'FLAT', quantity: 1, unitPriceCents: 462_000, vatRateBps: 0 }] })
issueInvoice(ctx, inv4, { issueDate: d(-4) })

at(realToday)
createInvoice(ctx, { clientId: mairie.id, title: 'Atelier de cadrage (brouillon)', lines: [{ label: 'Atelier de cadrage', unit: 'DAY', quantity: 1, unitPriceCents: 60_000, vatRateBps: 0 }] })

console.log('✔ Données de démonstration créées (5 clients, 8 opportunités, 2 devis, 5 factures, 10 saisies de temps).')
close()
