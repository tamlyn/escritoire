import { EditorView } from '@codemirror/view'
import { type ReactNode, useEffect, useRef } from 'react'
import { useParentTabState } from 'react-resizable-panels'

/**
 * Puts focus back where it was in a tab when the tab is shown again. Hiding a
 * tab drops its focus, since its content is kept mounted but not displayed.
 */
export function RememberFocus({ children }: { children: ReactNode }) {
  const shown = useParentTabState()?.isVisible ?? false
  const container = useRef<HTMLDivElement>(null)
  const lastFocused = useRef<HTMLElement | null>(null)

  // After the content's own effects, so a remembered element wins over a tab's default focus.
  useEffect(() => {
    const element = lastFocused.current
    if (!shown || !element?.isConnected) return
    // Focusing CodeMirror's content element directly would let the browser's
    // selection replace the editor's.
    const editor = EditorView.findFromDOM(element)
    if (editor) editor.focus()
    else element.focus({ preventScroll: true })
  }, [shown])

  return (
    <div
      ref={container}
      className="contents"
      onFocus={(event) => {
        // React also delivers focus from portals, such as menus, which aren't the tab's own.
        if (container.current?.contains(event.target)) lastFocused.current = event.target
      }}
    >
      {children}
    </div>
  )
}
