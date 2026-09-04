import { Fragment, useEffect, useRef } from 'react'
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
import { equalSizes, fitSizes, resizePanes, toColumns } from '@core/pane-sizes'
import { useStore } from '@/state/store'
import { surfaceForKind } from '@/plugins/registry'
import { isHtmlFile } from '@core/html-document'
import { CanvasEditor } from './CanvasEditor'
import { DiffView } from './DiffView'
import { HtmlPreview } from './HtmlPreview'
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
  const isDiff = kind === 'diff'
  // A surface contributed by a plugin, rendered in place of the text editor.
  const surface = kind ? surfaceForKind(kind) : null
  // An HTML file being read rather than edited. Unlike everything else here it
  // is a mode rather than a kind: the buffer stays a code document with its own
  // editor, history and unsaved changes, and the rendered page is drawn over
  // the top of it until it is switched back.
  const fileName = useStore((s) => (bufferId ? s.buffers[bufferId]?.fileName : undefined))
  const reading = useStore((s) => (bufferId ? !!s.htmlReading[bufferId] : false))
  const isReadingHtml = reading && !!fileName && isHtmlFile(fileName)
  // None of these is a CodeMirror view, so the editor host stays hidden.
  const isCustom = isCanvas || isDiff || surface !== null || isReadingHtml

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
      style={{
        /**
         * Page zoom, as a factor every surface in the pane can read.
         *
         * The setting is a type size, which is the right control for a text
         * document and no control at all for a table, or for a rendered page
         * in a frame. Those cannot take a font size from the outside — one
         * lays out to its own, the other is a whole document with opinions of
         * its own — but both can be scaled. So the size is published here as a
         * ratio against the size a document starts at, and each surface uses
         * whichever of the two it can.
         *
         * Without it the keystroke still moved the setting on those surfaces
         * and nothing on screen changed, which reads as a shortcut that does
         * not work while quietly drifting the size of every other document.
         */
        ['--or-page-zoom' as string]: String(settings.editor.fontSize / DEFAULT_FONT_SIZE)
      }}
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
      {surface && bufferId && <surface.Component key={bufferId} bufferId={bufferId} />}
      {isDiff && bufferId && <DiffView key={bufferId} bufferId={bufferId} />}
      {isReadingHtml && bufferId && <HtmlPreview key={bufferId} bufferId={bufferId} />}
      {!bufferId && <EmptyState icon="file-text">Open a note in this pane.</EmptyState>}
    </div>
  )
}

/** The size a document starts at; page zoom is measured against it. */
const DEFAULT_FONT_SIZE = 16

/** Width of the grab area between two panes, matching `.pane-divider`. */
const DIVIDER = '5px'

/** The editing area: one pane, or several side by side, with dividers between. */
export function EditorPane(): React.JSX.Element {
  const paneIds = useStore((s) => s.paneIds)
  const focusedPane = useStore((s) => s.focusedPane)
  const focusPane = useStore((s) => s.focusPane)
  const paneSizes = useStore((s) => s.paneSizes)
  const setPaneSizes = useStore((s) => s.setPaneSizes)
  const split = paneIds.length > 1
  const hostRef = useRef<HTMLDivElement>(null)

  // Fitted at render rather than on every change: the stored list can be one
  // pane out of date after a split or a close, and this is the one place that
  // has to agree with what is on screen.
  const sizes = fitSizes(paneSizes, paneIds.length)

  const startDrag = (divider: number) => (event: React.MouseEvent) => {
    event.preventDefault()
    const host = hostRef.current
    if (!host) return
    const width = host.getBoundingClientRect().width
    const startX = event.clientX
    const from = sizes

    const onMove = (move: MouseEvent): void => {
      setPaneSizes(resizePanes(from, divider, (move.clientX - startX) / width))
    }
    const onUp = (): void => {
      document.body.classList.remove('is-resizing')
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    document.body.classList.add('is-resizing')
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  // The keyboard path, because a divider is four pixels wide and a mouse is
  // not the only way anyone works.
  const onDividerKey =
    (divider: number) =>
    (event: React.KeyboardEvent): void => {
      const step = event.shiftKey ? 0.1 : 0.02
      if (event.key === 'ArrowLeft') setPaneSizes(resizePanes(sizes, divider, -step))
      else if (event.key === 'ArrowRight') setPaneSizes(resizePanes(sizes, divider, step))
      else if (event.key === 'Home' || event.key === 'Enter')
        setPaneSizes(equalSizes(paneIds.length))
      else return
      event.preventDefault()
    }

  return (
    <div
      className={`editor-panes${split ? ' editor-panes--split' : ''}`}
      ref={hostRef}
      style={{ gridTemplateColumns: toColumns(sizes, DIVIDER) }}
    >
      {paneIds.map((bufferId, index) => (
        // A fragment per slot: the divider belongs between two panes, and the
        // grid needs both as its own children.
        <Fragment key={index}>
          {index > 0 && (
            <div
              className="pane-divider"
              role="separator"
              aria-orientation="vertical"
              aria-label={`Resize pane ${index}`}
              tabIndex={0}
              title="Drag to resize. Double-click for equal columns."
              onMouseDown={startDrag(index - 1)}
              onDoubleClick={() => setPaneSizes(equalSizes(paneIds.length))}
              onKeyDown={onDividerKey(index - 1)}
            />
          )}
          <Pane
            // By position: a pane is a slot, and keying by buffer would tear
            // down the editor whenever a pane was told to show something else.
            bufferId={bufferId}
            focused={focusedPane === index}
            onFocus={() => focusPane(index)}
          />
        </Fragment>
      ))}
    </div>
  )
}
