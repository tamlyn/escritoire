import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Button } from '@/components/ui/button'
import { isDesktop, pairedToken, useConnectionLost } from './api'
import { App } from './App'
import { Pairing } from './remote/Pairing'
import './styles.css'

function Root() {
  const lost = useConnectionLost()
  if (!isDesktop && !pairedToken()) return <Pairing />
  return (
    <>
      <App />
      {lost && (
        <div className="bg-background/80 fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 p-4 text-center">
          <p>{lost.message}</p>
          <Button onClick={() => location.reload()}>Reconnect</Button>
        </div>
      )}
    </>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
