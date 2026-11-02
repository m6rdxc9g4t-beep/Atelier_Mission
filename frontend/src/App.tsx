// Aiguillage des écrans (#/route) dans le cadre commun.
import { Shell } from './components/shell.tsx'
import { Toasts } from './components/ui.tsx'
import { useRoute } from './lib/router.ts'
import { ClientsView } from './views/ClientsView.tsx'
import { DashboardView } from './views/DashboardView.tsx'
import { InvoiceView } from './views/InvoiceView.tsx'
import { InvoicesView } from './views/InvoicesView.tsx'
import { PipelineView } from './views/PipelineView.tsx'
import { QuoteView } from './views/QuoteView.tsx'
import { QuotesView } from './views/QuotesView.tsx'
import { RemindersView } from './views/RemindersView.tsx'
import { SettingsView } from './views/SettingsView.tsx'
import { TimeView } from './views/TimeView.tsx'

function Screen() {
  const { segments } = useRoute()
  const [section, id] = segments
  const numericId = id !== undefined && /^\d+$/.test(id) ? Number(id) : undefined
  switch (section) {
    case undefined:
      return <DashboardView />
    case 'pipeline':
      return <PipelineView />
    case 'clients':
      return <ClientsView clientId={numericId} />
    case 'devis':
      return numericId ? <QuoteView id={numericId} /> : <QuotesView />
    case 'factures':
      return numericId ? <InvoiceView id={numericId} /> : <InvoicesView />
    case 'temps':
      return <TimeView />
    case 'relances':
      return <RemindersView />
    case 'parametres':
      return <SettingsView />
    default:
      return <DashboardView />
  }
}

export function App() {
  return (
    <>
      <Shell>
        <Screen />
      </Shell>
      <Toasts />
    </>
  )
}
