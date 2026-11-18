import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Button } from '@/components/ui/button'
import { isDesktop, pairedToken, reloadViews, useConnectionState } from './api'
import { App } from './App'
import { followVisualViewport } from './phone/compact'
import { Pairing } from './remote/Pairing'
import { refreshPushSubscription } from './remote/push'
import './styles.css'

function Root() {
  const { reconnecting, unsavedError, epoch } = useConnectionState()
  if (!isDesktop && !pairedToken()) return <Pairing />
  return (
    <div className="flex h-full flex-col">
      {reconnecting ? (
        <div role="status" className="bg-muted text-muted-foreground shrink-0 px-2 py-0.5 text-center text-xs">
          Reconnecting…
        </div>
      ) : unsavedError && (
        <div role="alert" className="bg-destructive/10 flex shrink-0 items-center justify-center gap-2 px-2 py-1 text-xs">
          <span>Couldn't save your edits: {unsavedError}. Copy them before reloading.</span>
          <Button size="sm" variant="outline" onClick={reloadViews}>Reload</Button>
        </div>
      )}
      <div className="min-h-0 flex-1">
        <App key={epoch} />
      </div>
    </div>
  )
}

if (!isDesktop) followVisualViewport()
if (pairedToken()) refreshPushSubscription()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
