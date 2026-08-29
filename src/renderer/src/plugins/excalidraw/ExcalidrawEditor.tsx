import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import type { AppState, BinaryFiles } from '@excalidraw/excalidraw/types'
import type { OrderedExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import { viewForBuffer } from '@/editor/active-view'
import { useDocVersion } from '@/state/doc-version'
import { useStore } from '@/state/store'
import { EmptyState } from '@/components/PanelBits'

/**
 * Excalidraw as a document surface.
 *
 * Registered through the plugin API rather than wired into the editor pane, so
 * nothing in the app knows this file type exists. That is the point: the same
 * route is open to any third-party editor, and this one is only the first to
 * take it.
 * `.excalidraw` files are the format Excalidraw itself reads and writes, so a
 * drawing made here opens on excalidraw.com and one made there opens here — the
 * integration is the file format, not a private encoding of it.
 *
 * Loaded lazily. It is by a wide margin the largest dependency in the app, and a
 * vault with no drawings in it should never pay for it.
 */
const Excalidraw = lazy(async () => {
  // Excalidraw fetches its handwriting fonts at runtime, falling back to a CDN
  // it cannot reach offline. Pointed at the copies beside index.html instead;
  // see scripts/sync-assets.mjs.
  ;(window as unknown as { EXCALIDRAW_ASSET_PATH: string }).EXCALIDRAW_ASSET_PATH = new URL(
    './',
    window.location.href
  ).href
  const mod = await import('@excalidraw/excalidraw')
  await import('@excalidraw/excalidraw/index.css')
  return { default: mod.Excalidraw }
})

interface Scene {
  elements: readonly OrderedExcalidrawElement[]
  appState: Partial<AppState>
  files: BinaryFiles
}

/**
 * How long to wait after the last change before writing it back.
 *
 * A drag emits a change per frame; serialising the whole scene sixty times a
 * second to record one gesture would make the editor fight the pointer.
 */
const COMMIT_DELAY = 700

/**
 * The drawing, as the file holds it.
 *
 * Only the parts of appState that belong to the document. The rest is view and
 * UI state — which tool is selected, where the scroll is — and writing it would
 * make the file change every time the drawing was merely looked at.
 */
interface DocumentAppState {
  gridSize: number | null
  viewBackgroundColor: string
}

/** Excalidraw's own default, named so the value can be agreed on in two places. */
const DEFAULT_BACKGROUND = '#ffffff'

function toFile(
  elements: readonly OrderedExcalidrawElement[],
  appState: DocumentAppState,
  files: BinaryFiles
): string {
  return `${JSON.stringify(
    { type: 'excalidraw', version: 2, source: 'orrery', elements, appState, files },
    null,
    2
  )}\n`
}

export function ExcalidrawEditor({ bufferId }: { bufferId: string }): React.JSX.Element {
  const themeId = useStore((s) => s.settings.theme)
  const version = useDocVersion((v) => v[bufferId] ?? 0)
  const [failed, setFailed] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** The document text this surface last read or wrote, to tell a change of its
      own from one that arrived from somewhere else. */
  const committedRef = useRef<string | null>(null)
  /** The same drawing in the form this surface would write it. A file saved by
      excalidraw.com differs from ours in formatting alone, and comparing raw
      text would call that a change and mark an untouched drawing as edited. */
  const normalisedRef = useRef<string | null>(null)
  /** Bumped only for a change this surface did not make, to rebuild the scene. */
  const [sceneKey, setSceneKey] = useState(0)
  /** The scene, tagged with the load it came from. Tagging rather than clearing
      on change: the reset is then derived during render, and the effect below
      never has to set state synchronously to invalidate it. */
  const [loaded, setLoaded] = useState<{ key: string; scene: Scene } | null>(null)
  /** Whether a real document has been read. Nothing is written back before it
      has: an unloaded surface reports itself as empty, and committing that
      would erase the drawing it had not finished opening. */
  const loadedRef = useRef(false)

  /**
   * The drawing comes from the buffer's document, not from disk.
   *
   * Same route the canvas takes, and for the same reason: edits go back through
   * CodeMirror, so dirty state, Ctrl+S, autosave, undo and the reload-from-disk
   * guard are the ones the rest of the app already has. Writing the file
   * directly would mean a second, subtly different copy of all of it.
   *
   * Waited for rather than read once. The pane registers its view in an effect,
   * so the first render of this component can land before there is any document
   * to read — and reading too early would mount an empty canvas, whose very
   * first change event would then write that emptiness over the real drawing.
   */
  const key = `${bufferId}:${sceneKey}`
  const scene = loaded?.key === key ? loaded.scene : null

  useEffect(() => {
    loadedRef.current = false
    let live = true
    let frame = 0

    const attempt = (tries: number): void => {
      if (!live) return
      const view = viewForBuffer(bufferId)
      if (!view) {
        // Roughly two seconds at 60fps. Failing loudly beats mounting a blank
        // canvas over a file that has something in it.
        if (tries > 120) {
          setFailed(true)
          return
        }
        frame = requestAnimationFrame(() => attempt(tries + 1))
        return
      }

      const text = view.state.doc.toString()
      committedRef.current = text
      try {
        const parsed = text.trim() ? JSON.parse(text) : {}
        const elements = parsed.elements ?? []
        const files = parsed.files ?? {}
        // Spelled out rather than left to Excalidraw's defaults, so the file the
        // drawing would serialise to is knowable before any change arrives.
        const document: DocumentAppState = {
          gridSize: parsed.appState?.gridSize ?? null,
          viewBackgroundColor: parsed.appState?.viewBackgroundColor ?? DEFAULT_BACKGROUND
        }
        normalisedRef.current = toFile(elements, document, files)
        setLoaded({
          key,
          scene: {
            elements,
            // Excalidraw insists on `collaborators` being present, warning if not.
            appState: { ...(parsed.appState ?? {}), ...document, collaborators: [] },
            files
          }
        })
        loadedRef.current = true
      } catch {
        setFailed(true)
      }
    }
    // Scheduled rather than called: the view this waits for is registered by an
    // effect in the pane above, and a child's effects run before its parent's —
    // so on the first mount there is never a document to read yet.
    frame = requestAnimationFrame(() => attempt(0))

    return () => {
      live = false
      cancelAnimationFrame(frame)
    }
  }, [bufferId, sceneKey, key])

  const onChange = useCallback(
    (elements: readonly OrderedExcalidrawElement[], appState: AppState, files: BinaryFiles) => {
      if (!loadedRef.current) return
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        const view = viewForBuffer(bufferId)
        if (!view || !loadedRef.current) return
        const next = toFile(
          elements,
          {
            gridSize: appState.gridSize ?? null,
            viewBackgroundColor: appState.viewBackgroundColor ?? DEFAULT_BACKGROUND
          },
          files
        )
        // Excalidraw emits a change as it mounts, and again for pans and tool
        // switches. Comparing against the normalised form is what keeps a
        // drawing that was only opened from being marked as edited.
        if (next === normalisedRef.current) return
        normalisedRef.current = next
        committedRef.current = next
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: next } })
      }, COMMIT_DELAY)
    },
    [bufferId]
  )

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    },
    []
  )

  /**
   * Rebuild the scene when the document changed underneath it.
   *
   * A reload from disk or an undo replaces the document without this surface
   * knowing; comparing against the last text it wrote is what distinguishes
   * that from the commits it makes itself, which must not disturb the canvas.
   */
  useEffect(() => {
    const text = viewForBuffer(bufferId)?.state.doc.toString() ?? ''
    if (committedRef.current !== null && text !== committedRef.current) {
      committedRef.current = text
      setSceneKey((k) => k + 1)
    }
  }, [version, bufferId])

  if (failed) return <EmptyState icon="alert-triangle">That drawing could not be read.</EmptyState>
  if (!scene) return <EmptyState icon="pencil">Opening the drawing…</EmptyState>

  return (
    <div className="excalidraw-host">
      <Suspense fallback={<EmptyState icon="pencil">Loading the drawing surface…</EmptyState>}>
        <Excalidraw
          initialData={scene}
          onChange={onChange}
          // Follows the app rather than sitting in its own colour scheme.
          theme={themeId === 'dark' ? 'dark' : 'light'}
        />
      </Suspense>
    </div>
  )
}
