import { useEffect, useRef } from 'react'
import { EditorView } from '@codemirror/view'
import { setActiveView } from '@/editor/active-view'
import { bufferRegistry } from '@/editor/buffer-registry'
import { settingsCompartment, settingsExtensions } from '@/editor/create-state'
import { lineWidthCss } from '@/editor/line-width'
import { useStore } from '@/state/store'

/**
 * Thin React wrapper around a single EditorView. React manages lifecycle and
 * the container div only; all editing behavior lives in CM6 extensions.
 * Tab switches swap EditorStates in and out — undo history, selection and
 * scroll position of background tabs survive for free.
 */
export function EditorPane(): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const shownIdRef = useRef<string | null>(null)
  const activeId = useStore((s) => s.activeId)
  const settings = useStore((s) => s.settings)

  // Create the view once.
  useEffect(() => {
    const view = new EditorView({ parent: containerRef.current! })
    viewRef.current = view
    setActiveView(view)
    return () => {
      setActiveView(null)
      view.destroy()
      viewRef.current = null
    }
  }, [])

  // Swap document states on tab change.
  useEffect(() => {
    const view = viewRef.current
    if (!view || !activeId) return
    if (shownIdRef.current === activeId) return

    // Park the outgoing tab's state (with its selection/history) in the registry.
    if (shownIdRef.current) {
      bufferRegistry.setState(shownIdRef.current, view.state)
    }
    const next = bufferRegistry.get(activeId)
    if (next) {
      view.setState(next.state)
      // States created while in the background may carry stale settings.
      view.dispatch({
        effects: settingsCompartment.reconfigure(settingsExtensions(useStore.getState().settings))
      })
      shownIdRef.current = activeId
      view.focus()
    }
  }, [activeId])

  // Live-apply settings changes to the visible editor.
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: settingsCompartment.reconfigure(settingsExtensions(settings))
    })
  }, [settings])

  // Keep the registry's copy of the active state fresh so store actions
  // (save on quit, etc.) can read background-consistent state at any time.
  useEffect(() => {
    const interval = setInterval(() => {
      const view = viewRef.current
      if (view && shownIdRef.current) bufferRegistry.setState(shownIdRef.current, view.state)
    }, 1000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div
      ref={containerRef}
      className="editor-pane"
      style={{
        fontSize: `${settings.editor.fontSize}px`,
        ['--zy-editor-font-size' as string]: `${settings.editor.fontSize}px`,
        ['--zy-editor-line-height' as string]: String(settings.editor.lineHeight),
        ['--zy-editor-font-family' as string]: settings.editor.fontFamily || 'var(--zy-prose-font)',
        ['--zy-editor-max-width' as string]: lineWidthCss(settings.editor)
      }}
    />
  )
}
