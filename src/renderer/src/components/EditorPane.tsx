import { useEffect, useRef } from 'react'
import { EditorView } from '@codemirror/view'
import { registerPaneView, setActiveView } from '@/editor/active-view'
import { bumpDocVersion } from '@/state/doc-version'
import { refreshStatsNow } from '@/state/editor-stats'
import { bufferRegistry } from '@/editor/buffer-registry'
import { settingsCompartment, settingsExtensions } from '@/editor/create-state'
import { ensureLanguage } from '@/editor/code-language'
import { refreshGitGutter } from '@/editor/git-gutter'
import { openDocument, replayDiagnostics } from '@/editor/lsp-session'
import { lineWidthCss } from '@/editor/line-width'
import { useStore } from '@/state/store'
import { CanvasEditor } from './CanvasEditor'
import { ExcalidrawEditor } from './ExcalidrawEditor'
import { DiffView } from './DiffView'
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
  const kind = useStore((s) => (bufferId ? s.buffers[bufferId]?.kind : undefined))
  const isDirty = useStore((s) => (bufferId ? (s.buffers[bufferId]?.isDirty ?? false) : false))
  const isCanvas = kind === 'canvas'
  const isExcalidraw = kind === 'excalidraw'
  const isDiff = kind === 'diff'
  // Neither surface is a CodeMirror view, so the editor host stays hidden.
  const isCustom = isCanvas || isExcalidraw || isDiff

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
    const shownKind = useStore.getState().buffers[bufferId]?.kind ?? 'markdown'
    view.dispatch({
      effects: settingsCompartment.reconfigure(
        settingsExtensions(useStore.getState().settings, shownKind)
      )
    })
    // Grammars are code-split, so a code buffer opens unhighlighted for as
    // long as its language takes to arrive.
    const shownPath = useStore.getState().buffers[bufferId]?.filePath
    if (shownKind === 'code' && shownPath) {
      void ensureLanguage(view, shownPath)
      // Tell the server the file is open, and draw anything it has already
      // said about it — diagnostics for a background tab arrive before the tab
      // is ever looked at.
      void openDocument(shownPath, view.state.doc.toString())
      replayDiagnostics(bufferId, shownPath, view)
    }
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
      effects: settingsCompartment.reconfigure(settingsExtensions(settings, kind ?? 'markdown'))
    })
    // `kind` matters as much as the settings do: it decides whether this buffer
    // gets the markdown machinery or the code one.
  }, [settings, kind])

  // Refresh the change bars whenever the file matches disk again — on open,
  // and on the dirty flag clearing after a save. Marks are anchored to
  // positions, so they stay aligned while typing; this is what makes them true
  // again afterwards.
  useEffect(() => {
    const view = viewRef.current
    if (!view || kind !== 'code' || isDirty) return
    void refreshGitGutter(view)
  }, [bufferId, kind, isDirty])

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
    if (!isCustom) viewRef.current?.requestMeasure()
  }, [isCustom])

  return (
    <div
      className={`editor-pane-host${focused ? ' editor-pane-host--focused' : ''}`}
      onMouseDownCapture={onFocus}
    >
      <div
        ref={containerRef}
        className="editor-pane"
        hidden={isCustom || !bufferId}
        style={{
          fontSize: `${settings.editor.fontSize}px`,
          ['--or-editor-font-size' as string]: `${settings.editor.fontSize}px`,
          ['--or-editor-line-height' as string]: String(settings.editor.lineHeight),
          // Prose reads in a proportional face; code does not. A code file set
          // in the prose font loses the column alignment indentation depends on,
          // and picks up the ligatures that turn `=>` into a glyph the file does
          // not contain. An explicit setting still wins for either kind.
          ['--or-editor-font-family' as string]:
            settings.editor.fontFamily ||
            (kind === 'code' ? 'var(--or-mono-font)' : 'var(--or-prose-font)'),
          // A reading column is for prose. Code is read down the left edge
          // against its indentation, so it takes the full pane and sits just
          // clear of the gutter instead of being centred in a 46rem measure.
          ['--or-editor-max-width' as string]:
            kind === 'code' ? 'none' : lineWidthCss(settings.editor),
          ['--or-editor-line-pad' as string]: kind === 'code' ? '0.75rem' : '2rem'
        }}
      />
      {isCanvas && bufferId && <CanvasEditor key={bufferId} bufferId={bufferId} />}
      {isExcalidraw && bufferId && <ExcalidrawEditor key={bufferId} bufferId={bufferId} />}
      {isDiff && bufferId && <DiffView key={bufferId} bufferId={bufferId} />}
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
