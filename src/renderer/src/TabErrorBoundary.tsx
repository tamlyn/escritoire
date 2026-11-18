import { Component, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { errorMessage } from './api'

type Props = { children: ReactNode }
type State = { message: string | null }

/**
 * Keeps a render error to the tab it happened in. Without it React unmounts the
 * whole window. Offers a reload rather than a retry, since React caches a
 * failed lazy import and remounting would only fail again.
 */
export class TabErrorBoundary extends Component<Props, State> {
  state: State = { message: null }

  static getDerivedStateFromError(error: unknown): State {
    return { message: errorMessage(error) }
  }

  render() {
    if (this.state.message === null) return this.props.children
    return (
      <div role="alert" className="flex h-full flex-col items-center justify-center gap-4 p-4 text-center">
        <p>This tab stopped working.</p>
        <p className="text-muted-foreground max-w-xl text-sm break-words select-text">{this.state.message}</p>
        <Button onClick={() => location.reload()}>Reload window</Button>
      </div>
    )
  }
}
