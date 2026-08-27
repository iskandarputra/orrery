import { useEffect, useRef } from 'react'
import { EditorView } from '@codemirror/view'
import { registerPaneView, setActiveView } from '@/editor/active-view'
import { bumpDocVersion } from '@/state/doc-version'
import { refreshStatsNow } from '@/state/editor-stats'
import { bufferRegistry } from '@/editor/buffer-registry'
import { settingsCompartment, settingsExtensions } from '@/editor/create-state'
import { lineWidthCss } from '@/editor/line-width'
import { useStore } from '@/state/store'
import { CanvasEditor } from './CanvasEditor'
import { EmptyState } from './PanelBits'

/**
 * One editing surface: a CodeMirror view, or a board when the buffer is a
 * canvas. Tab switches swap EditorStates in and out, so undo history,
 * selection and scroll position of background tabs survive for free.
 *
 * A buffer belongs to exactly one pane at a time — two editors over one file
 * would give it two diverging histories — so a pane can own its view outright.
 */
function Pane({
  bufferId,
  focused,
  onFocus
}: {
  bufferId: string | null
  focused: boolean
  onFocus: () => void
}): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const shownIdRef = useRef<string | null>(null)
  const settings = useStore((s) => s.settings)
  const isCanvas = useStore((s) => (bufferId ? s.buffers[bufferId]?.kind === 'canvas' : false))

  useEffect(() => {
    const view = new EditorView({ parent: containerRef.current! })
    viewRef.current = view
    return () => {
      if (shownIdRef.current) registerPaneView(shownIdRef.current, null)
      view.destroy()
      viewRef.current = null
    }
  }, [])

  // Whichever pane has focus is the one commands and the status bar act on.
  useEffect(() => {
    if (focused && viewRef.current) setActiveView(viewRef.current)
  }, [focused])

  useEffect(() => {
    const view = viewRef.current
    if (!view || !bufferId || shownIdRef.current === bufferId) return

    // Park the outgoing tab's state (with its selection/history) in the registry.
    if (shownIdRef.current) {
      bufferRegistry.setState(shownIdRef.current, view.state)
      registerPaneView(shownIdRef.current, null)
    }
    const next = bufferRegistry.get(bufferId)
    if (!next) return

    view.setState(next.state)
    // States created while in the background may carry stale settings.
    view.dispatch({
      effects: settingsCompartment.reconfigure(settingsExtensions(useStore.getState().settings))
    })
    shownIdRef.current = bufferId
    registerPaneView(bufferId, view)
    // A tab swap fires no editor update, so anything rendered *from* the
    // document — the counters, a canvas board — has to be told to re-read.
    refreshStatsNow(view.state)
    bumpDocVersion(bufferId)
    if (focused) view.focus()
    // `focused` is read for that focus call only; re-running on it would steal
    // focus back from the pane the user just clicked into.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bufferId])

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: settingsCompartment.reconfigure(settingsExtensions(settings))
    })
  }, [settings])

  // Keep the registry's copy fresh so store actions can read a consistent
  // state for a buffer whose pane isn't focused.
  useEffect(() => {
    const interval = setInterval(() => {
      const view = viewRef.current
      if (view && shownIdRef.current) bufferRegistry.setState(shownIdRef.current, view.state)
    }, 1000)
    return () => clearInterval(interval)
  }, [])

  // Coming back from a board, the editor was display:none and measured as
  // zero-sized; CodeMirror needs telling to look again.
  useEffect(() => {
    if (!isCanvas) viewRef.current?.requestMeasure()
  }, [isCanvas])

  return (
    <div
      className={`editor-pane-host${focused ? ' editor-pane-host--focused' : ''}`}
      onMouseDownCapture={onFocus}
    >
      <div
        ref={containerRef}
        className="editor-pane"
        hidden={isCanvas || !bufferId}
        style={{
          fontSize: `${settings.editor.fontSize}px`,
          ['--or-editor-font-size' as string]: `${settings.editor.fontSize}px`,
          ['--or-editor-line-height' as string]: String(settings.editor.lineHeight),
          ['--or-editor-font-family' as string]: settings.editor.fontFamily || 'var(--or-prose-font)',
          ['--or-editor-max-width' as string]: lineWidthCss(settings.editor)
        }}
      />
      {isCanvas && bufferId && <CanvasEditor key={bufferId} bufferId={bufferId} />}
      {!bufferId && <EmptyState icon="file-text">Open a note in this pane.</EmptyState>}
    </div>
  )
}

/** The editing area: one pane, or two side by side when the editor is split. */
export function EditorPane(): React.JSX.Element {
  const paneIds = useStore((s) => s.paneIds)
  const focusedPane = useStore((s) => s.focusedPane)
  const focusPane = useStore((s) => s.focusPane)
  const split = paneIds[1] !== null

  return (
    <div className={`editor-panes${split ? ' editor-panes--split' : ''}`}>
      <Pane bufferId={paneIds[0]} focused={focusedPane === 0} onFocus={() => focusPane(0)} />
      {split && (
        <Pane bufferId={paneIds[1]} focused={focusedPane === 1} onFocus={() => focusPane(1)} />
      )}
    </div>
  )
}
