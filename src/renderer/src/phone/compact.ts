import { useSyncExternalStore } from 'react'
import { isDesktop } from '../api'

// The height keeps a phone turned on its side in the phone layout. The same query as the `compact` CSS variant.
const query = window.matchMedia('(max-width: 640px), (max-height: 640px) and (pointer: coarse)')

/** A browser small enough for the phone layout, whatever the device. The desktop window never is. */
export function useIsCompact(): boolean {
  return useSyncExternalStore(
    (listener) => {
      query.addEventListener('change', listener)
      return () => query.removeEventListener('change', listener)
    },
    () => !isDesktop && query.matches,
  )
}

/** Keeps the page the height of what's visible above iOS Safari's on-screen keyboard, which `dvh` ignores. */
export function followVisualViewport(): void {
  const viewport = window.visualViewport
  if (!viewport) return
  const update = () => {
    if (viewport.scale > 1) return
    document.documentElement.style.setProperty('--viewport-height', `${viewport.height}px`)
    // iOS scrolls the page to reveal a focused input, which would push the header off the top.
    window.scrollTo(0, 0)
  }
  viewport.addEventListener('resize', update)
  viewport.addEventListener('scroll', update)
  update()
}
