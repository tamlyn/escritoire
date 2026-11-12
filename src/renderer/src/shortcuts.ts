import { useEffect, useRef } from 'react'

export const isMac = navigator.userAgent.includes('Mac')

/** ⌘ on macOS, Ctrl elsewhere. */
export const modifierLabel = isMac ? '⌘' : 'Ctrl+'

export function hasModifier(event: { metaKey: boolean; ctrlKey: boolean }): boolean {
  return isMac ? event.metaKey : event.ctrlKey
}

export function useShortcut(key: string, handler: () => void): void {
  const handlerRef = useRef(handler)
  handlerRef.current = handler

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!hasModifier(event) || event.shiftKey || event.altKey || event.key.toLowerCase() !== key) return
      event.preventDefault()
      handlerRef.current()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [key])
}
