import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DEFAULT_NODE_HEIGHT,
  DEFAULT_NODE_WIDTH,
  canvasBounds,
  chooseSides,
  nodesInBox,
  nodesInGroup,
  normaliseBox,
  parseCanvas,
  serializeCanvas,
  sideAnchor,
  type Box,
  type CanvasNode,
  type JsonCanvas
} from '@core/canvas'
import { redo, undo } from '@codemirror/commands'
import { basename, stem } from '@core/paths'
import { getActiveView } from '@/editor/active-view'
import { invoke } from '@/services/client'
import { useDocVersion } from '@/state/doc-version'
import { useStore } from '@/state/store'
import { Icon } from './Icon'
import { MarkdownCard } from './MarkdownCard'

const MIN_ZOOM = 0.2
const MAX_ZOOM = 2.5
const MIN_NODE_SIZE = 80
/** How much of a note to show on its card. */
const PREVIEW_CHARS = 240

interface Viewport {
  x: number
  y: number
  zoom: number
}

type Gesture =
  | { kind: 'pan'; startX: number; startY: number; originX: number; originY: number }
  /** Dragging a selection: every moving card's starting position, by id. */
  | { kind: 'move'; startX: number; startY: number; origins: Record<string, { x: number; y: number }> }
  | { kind: 'resize'; id: string; grabX: number; grabY: number; width: number; height: number }
  | { kind: 'connect'; from: string; x: number; y: number }
  | { kind: 'marquee'; startX: number; startY: number; box: Box }

const shortId = (): string => crypto.randomUUID().replace(/-/g, '').slice(0, 16)

/**
 * A JSON Canvas board, edited in place.
 *
 * The board's source of truth stays the buffer's CodeMirror document — the file
 * text — so saving, dirty state, external-change detection and undo all work
 * exactly as they do for a note. Each gesture writes the whole document once, on
 * release, which keeps one undo entry per action instead of one per mouse move.
 */
export function CanvasEditor({ bufferId }: { bufferId: string }): React.JSX.Element {
  const rootPath = useStore((s) => s.rootPath)
  const openPaths = useStore((s) => s.openPaths)
  const noteIndex = useStore((s) => s.noteIndex)
  const version = useDocVersion((v) => v[bufferId] ?? 0)

  const surfaceRef = useRef<HTMLDivElement>(null)
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, zoom: 1 })
  const [selection, setSelection] = useState<string[]>([])
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState<JsonCanvas | null>(null)
  const [gesture, setGesture] = useState<Gesture | null>(null)
  const [pickerAt, setPickerAt] = useState<{ x: number; y: number } | null>(null)
  /** Held space pans instead of drawing a marquee — the usual canvas idiom. */
  const spaceRef = useRef(false)

  // Re-read the board whenever the document changes — including changes this
  // component didn't make, like an undo.
  const stored = useMemo(() => {
    const view = getActiveView()
    return parseCanvas(view?.state.doc.toString() ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bufferId, version])

  const canvas = draft ?? stored
  const previews = useNotePreviews(canvas, rootPath)

  const commit = useCallback((next: JsonCanvas): void => {
    const view = getActiveView()
    if (!view) return
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: serializeCanvas(next) }
    })
    setDraft(null)
  }, [])

  /** Pointer position in board coordinates. */
  const toScene = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } => {
      const rect = surfaceRef.current?.getBoundingClientRect()
      if (!rect) return { x: 0, y: 0 }
      return {
        x: (clientX - rect.left - viewport.x) / viewport.zoom,
        y: (clientY - rect.top - viewport.y) / viewport.zoom
      }
    },
    [viewport]
  )

  const fit = useCallback((): void => {
    const rect = surfaceRef.current?.getBoundingClientRect()
    if (!rect || canvas.nodes.length === 0) {
      setViewport({ x: 0, y: 0, zoom: 1 })
      return
    }
    const box = canvasBounds(canvas.nodes)
    const width = box.maxX - box.minX + 120
    const height = box.maxY - box.minY + 120
    const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.min(rect.width / width, rect.height / height)))
    setViewport({
      zoom,
      x: rect.width / 2 - ((box.minX + box.maxX) / 2) * zoom,
      y: rect.height / 2 - ((box.minY + box.maxY) / 2) * zoom
    })
  }, [canvas.nodes])

  // Frame the board the first time it is shown.
  const framedRef = useRef<string | null>(null)
  useEffect(() => {
    if (framedRef.current === bufferId || canvas.nodes.length === 0) return
    framedRef.current = bufferId
    fit()
  }, [bufferId, canvas.nodes.length, fit])

  const addNode = useCallback(
    (node: CanvasNode): void => {
      commit({ ...canvas, nodes: [...canvas.nodes, node] })
      setSelection([node.id])
    },
    [canvas, commit]
  )

  const removeSelected = useCallback((): void => {
    if (selection.length === 0) return
    const gone = new Set(selection)
    commit({
      // Deleting a group leaves its cards behind — it is a frame, not a folder.
      nodes: canvas.nodes.filter((n) => !gone.has(n.id)),
      edges: canvas.edges.filter((e) => !gone.has(e.fromNode) && !gone.has(e.toNode))
    })
    setSelection([])
  }, [canvas, commit, selection])

  useEffect(() => {
    const onUp = (e: KeyboardEvent): void => {
      if (e.code === 'Space') spaceRef.current = false
    }
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null
      const typing = !!target && /input|textarea/i.test(target.tagName)
      if (e.code === 'Space' && !typing) spaceRef.current = true

      if ((e.ctrlKey || e.metaKey) && !typing && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        setSelection(canvas.nodes.map((n) => n.id))
        return
      }

      // The board's history is the document's history, but the editor holding
      // it is hidden and never focused — so its keymap never fires. Drive the
      // same commands from here, which keeps one undo step per gesture.
      if ((e.ctrlKey || e.metaKey) && !typing && e.key.toLowerCase() === 'z') {
        const view = getActiveView()
        if (view) {
          e.preventDefault()
          if (e.shiftKey) redo(view)
          else undo(view)
        }
        return
      }

      if (editing || selection.length === 0 || typing) return
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        removeSelected()
      } else if (e.key === 'Escape') {
        setSelection([])
      }
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onUp)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onUp)
    }
  }, [editing, selection, removeSelected, canvas.nodes])

  const onPointerMove = (e: React.PointerEvent): void => {
    if (!gesture) return
    const point = toScene(e.clientX, e.clientY)

    if (gesture.kind === 'pan') {
      setViewport((v) => ({
        ...v,
        x: gesture.originX + (e.clientX - gesture.startX),
        y: gesture.originY + (e.clientY - gesture.startY)
      }))
      return
    }
    if (gesture.kind === 'connect') {
      setGesture({ ...gesture, x: point.x, y: point.y })
      return
    }
    if (gesture.kind === 'marquee') {
      setGesture({
        ...gesture,
        box: normaliseBox(gesture.startX, gesture.startY, point.x, point.y)
      })
      return
    }
    if (gesture.kind === 'move') {
      const dx = point.x - gesture.startX
      const dy = point.y - gesture.startY
      setDraft({
        ...canvas,
        nodes: canvas.nodes.map((n) => {
          const origin = gesture.origins[n.id]
          return origin ? { ...n, x: origin.x + dx, y: origin.y + dy } : n
        })
      })
      return
    }
    setDraft({
      ...canvas,
      nodes: canvas.nodes.map((n) =>
        n.id === gesture.id
          ? {
              ...n,
              width: Math.max(MIN_NODE_SIZE, gesture.width + (point.x - gesture.grabX)),
              height: Math.max(MIN_NODE_SIZE, gesture.height + (point.y - gesture.grabY))
            }
          : n
      )
    })
  }

  const onPointerUp = (e: React.PointerEvent): void => {
    if (gesture?.kind === 'connect') {
      const point = toScene(e.clientX, e.clientY)
      const target = [...canvas.nodes]
        .reverse()
        .find(
          (n) =>
            point.x >= n.x && point.x <= n.x + n.width && point.y >= n.y && point.y <= n.y + n.height
        )
      if (target && target.id !== gesture.from) {
        const already = canvas.edges.some(
          (edge) => edge.fromNode === gesture.from && edge.toNode === target.id
        )
        if (!already) {
          commit({
            ...canvas,
            edges: [...canvas.edges, { id: shortId(), fromNode: gesture.from, toNode: target.id }]
          })
        }
      }
    } else if (gesture?.kind === 'marquee') {
      setSelection(nodesInBox(canvas.nodes, gesture.box).map((n) => n.id))
    } else if (draft) {
      commit(draft)
    }
    setGesture(null)
  }

  const onWheel = (e: React.WheelEvent): void => {
    if (e.ctrlKey || e.metaKey) {
      const rect = surfaceRef.current?.getBoundingClientRect()
      if (!rect) return
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1
      setViewport((v) => {
        const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.zoom * factor))
        const scale = zoom / v.zoom
        // Keep the point under the cursor pinned while zooming.
        const cx = e.clientX - rect.left
        const cy = e.clientY - rect.top
        return { zoom, x: cx - (cx - v.x) * scale, y: cy - (cy - v.y) * scale }
      })
      return
    }
    setViewport((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }))
  }

  const newTextCard = (at: { x: number; y: number }): void => {
    const node: CanvasNode = {
      id: shortId(),
      type: 'text',
      text: '',
      x: at.x - DEFAULT_NODE_WIDTH / 2,
      y: at.y - DEFAULT_NODE_HEIGHT / 2,
      width: DEFAULT_NODE_WIDTH,
      height: DEFAULT_NODE_HEIGHT
    }
    addNode(node)
    setEditing(node.id)
  }

  const centre = (): { x: number; y: number } => {
    const rect = surfaceRef.current?.getBoundingClientRect()
    return toScene((rect?.left ?? 0) + (rect?.width ?? 0) / 2, (rect?.top ?? 0) + (rect?.height ?? 0) / 2)
  }

  return (
    <div className="canvas">
      <div className="canvas__toolbar">
        <button className="icon-btn" title="Add card" onClick={() => newTextCard(centre())}>
          <Icon name="plus" size={15} />
        </button>
        <button className="icon-btn" title="Add note" onClick={() => setPickerAt(centre())}>
          <Icon name="file-text" size={15} />
        </button>
        <button
          className="icon-btn"
          title="Add group"
          onClick={() => {
            const at = centre()
            addNode({
              id: shortId(),
              type: 'group',
              label: 'Group',
              x: at.x - 320,
              y: at.y - 220,
              width: 640,
              height: 440
            })
          }}
        >
          <Icon name="layers" size={15} />
        </button>
        <span className="canvas__toolbar-gap" />
        <button
          className="icon-btn"
          title="Zoom out"
          onClick={() => setViewport((v) => ({ ...v, zoom: Math.max(MIN_ZOOM, v.zoom / 1.2) }))}
        >
          <span style={{ fontWeight: 700 }}>−</span>
        </button>
        <button className="icon-btn" title="Fit to screen" onClick={fit}>
          <Icon name="maximize" size={14} />
        </button>
        <button
          className="icon-btn"
          title="Zoom in"
          onClick={() => setViewport((v) => ({ ...v, zoom: Math.min(MAX_ZOOM, v.zoom * 1.2) }))}
        >
          <Icon name="plus" size={14} />
        </button>
        <span className="canvas__count">
          {canvas.nodes.length} card{canvas.nodes.length === 1 ? '' : 's'}
        </span>
      </div>

      <div
        ref={surfaceRef}
        className={`canvas__surface${gesture?.kind === 'pan' ? ' canvas__surface--panning' : ''}`}
        onWheel={onWheel}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerDown={(e) => {
          if (e.target !== e.currentTarget && !(e.target as HTMLElement).closest('.canvas__scene'))
            return
          if ((e.target as HTMLElement).closest('.canvas__card')) return
          // Blur first: clearing `editing` would unmount the textarea and take
          // whatever was typed with it, before its blur handler could save.
          if (editing) (document.activeElement as HTMLElement | null)?.blur()
          setEditing(null)
          setPickerAt(null)
          e.currentTarget.setPointerCapture(e.pointerId)

          // Middle button or a held space pans; a plain drag draws a marquee.
          if (e.button === 1 || spaceRef.current) {
            setGesture({
              kind: 'pan',
              startX: e.clientX,
              startY: e.clientY,
              originX: viewport.x,
              originY: viewport.y
            })
            return
          }
          setSelection([])
          const start = toScene(e.clientX, e.clientY)
          setGesture({
            kind: 'marquee',
            startX: start.x,
            startY: start.y,
            box: { x: start.x, y: start.y, width: 0, height: 0 }
          })
        }}
        onDoubleClick={(e) => {
          if ((e.target as HTMLElement).closest('.canvas__card')) return
          newTextCard(toScene(e.clientX, e.clientY))
        }}
      >
        <div
          className="canvas__scene"
          style={{
            transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`
          }}
        >
          <Edges canvas={canvas} gesture={gesture} />

          {gesture?.kind === 'marquee' && (
            <div
              className="canvas__marquee"
              style={{
                left: gesture.box.x,
                top: gesture.box.y,
                width: gesture.box.width,
                height: gesture.box.height
              }}
            />
          )}

          {/* Groups draw behind the cards they frame. */}
          {[...canvas.nodes]
            .sort((a, b) => Number(b.type === 'group') - Number(a.type === 'group'))
            .map((node) => (
            <div
              key={node.id}
              className={`canvas__card canvas__card--${node.type}${
                selection.includes(node.id) ? ' canvas__card--selected' : ''
              }`}
              style={{ left: node.x, top: node.y, width: node.width, height: node.height }}
              onPointerDown={(e) => {
                if ((e.target as HTMLElement).closest('.canvas__handle')) return
                e.stopPropagation()

                // Dragging an unselected card selects it alone; dragging one
                // that is already selected moves the whole selection.
                const additive = e.shiftKey || e.metaKey || e.ctrlKey
                let moving = selection
                if (additive) {
                  moving = selection.includes(node.id)
                    ? selection.filter((id) => id !== node.id)
                    : [...selection, node.id]
                } else if (!selection.includes(node.id)) {
                  moving = [node.id]
                }
                setSelection(moving)
                if (additive) return // a modifier click adjusts the set, it doesn't drag

                // A group carries the cards that sit inside it.
                const dragging = new Set(moving)
                for (const id of moving) {
                  const candidate = canvas.nodes.find((n) => n.id === id)
                  if (candidate?.type === 'group') {
                    for (const child of nodesInGroup(canvas.nodes, candidate)) dragging.add(child.id)
                  }
                }

                const point = toScene(e.clientX, e.clientY)
                const origins: Record<string, { x: number; y: number }> = {}
                for (const n of canvas.nodes) {
                  if (dragging.has(n.id)) origins[n.id] = { x: n.x, y: n.y }
                }
                e.currentTarget.setPointerCapture(e.pointerId)
                setGesture({ kind: 'move', startX: point.x, startY: point.y, origins })
              }}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onDoubleClick={(e) => {
                e.stopPropagation()
                if (node.type === 'text') setEditing(node.id)
                else if (node.type === 'file' && rootPath) {
                  void openPaths([`${rootPath}/${node.file}`])
                }
              }}
            >
              <CardBody
                node={node}
                editing={editing === node.id}
                preview={node.type === 'file' ? previews[node.file] : undefined}
                onText={(text) => {
                  commit({
                    ...canvas,
                    nodes: canvas.nodes.map((n) =>
                      n.id === node.id && n.type === 'text' ? { ...n, text } : n
                    )
                  })
                  setEditing(null)
                }}
              />

              <span
                className="canvas__handle canvas__handle--connect"
                title="Drag to another card to link them"
                onPointerDown={(e) => {
                  e.stopPropagation()
                  const point = toScene(e.clientX, e.clientY)
                  ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
                  setGesture({ kind: 'connect', from: node.id, x: point.x, y: point.y })
                }}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
              />
              <span
                className="canvas__handle canvas__handle--resize"
                onPointerDown={(e) => {
                  e.stopPropagation()
                  const point = toScene(e.clientX, e.clientY)
                  ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
                  setGesture({
                    kind: 'resize',
                    id: node.id,
                    grabX: point.x,
                    grabY: point.y,
                    width: node.width,
                    height: node.height
                  })
                }}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
              />
            </div>
          ))}
        </div>

        {canvas.nodes.length === 0 && (
          <p className="canvas__empty">
            Double-click anywhere to add a card, or use the note button above.
          </p>
        )}
      </div>

      {pickerAt && (
        <NotePicker
          notes={noteIndex}
          onPick={(path) => {
            addNode({
              id: shortId(),
              type: 'file',
              file: rootPath && path.startsWith(rootPath) ? path.slice(rootPath.length + 1) : path,
              x: pickerAt.x - DEFAULT_NODE_WIDTH / 2,
              y: pickerAt.y - DEFAULT_NODE_HEIGHT / 2,
              width: DEFAULT_NODE_WIDTH,
              height: DEFAULT_NODE_HEIGHT
            })
            setPickerAt(null)
          }}
          onClose={() => setPickerAt(null)}
        />
      )}
    </div>
  )
}

/** Links between cards, plus the rubber band while one is being drawn. */
function Edges({ canvas, gesture }: { canvas: JsonCanvas; gesture: Gesture | null }): React.JSX.Element {
  const byId = new Map(canvas.nodes.map((n) => [n.id, n]))
  const box = canvasBounds(canvas.nodes)
  // The SVG spans the board's extent plus room for a card being dragged out.
  const pad = 2000

  const path = (ax: number, ay: number, bx: number, by: number): string => {
    const bend = Math.max(40, Math.abs(bx - ax) / 2)
    return `M ${ax} ${ay} C ${ax + bend} ${ay}, ${bx - bend} ${by}, ${bx} ${by}`
  }

  return (
    <svg
      className="canvas__edges"
      style={{ left: box.minX - pad, top: box.minY - pad }}
      width={box.maxX - box.minX + pad * 2}
      height={box.maxY - box.minY + pad * 2}
      viewBox={`${box.minX - pad} ${box.minY - pad} ${box.maxX - box.minX + pad * 2} ${box.maxY - box.minY + pad * 2}`}
    >
      {canvas.edges.map((edge) => {
        const from = byId.get(edge.fromNode)
        const to = byId.get(edge.toNode)
        if (!from || !to) return null
        const sides = chooseSides(from, to)
        const a = sideAnchor(from, edge.fromSide ?? sides.from)
        const b = sideAnchor(to, edge.toSide ?? sides.to)
        return <path key={edge.id} className="canvas__edge" d={path(a.x, a.y, b.x, b.y)} />
      })}

      {gesture?.kind === 'connect' &&
        (() => {
          const from = byId.get(gesture.from)
          if (!from) return null
          const a = sideAnchor(from, 'right')
          return <path className="canvas__edge canvas__edge--draft" d={path(a.x, a.y, gesture.x, gesture.y)} />
        })()}
    </svg>
  )
}

function CardBody({
  node,
  editing,
  preview,
  onText
}: {
  node: CanvasNode
  editing: boolean
  preview: string | undefined
  onText: (text: string) => void
}): React.JSX.Element {
  if (node.type === 'text') {
    if (editing) {
      return (
        <textarea
          className="canvas__card-input"
          autoFocus
          defaultValue={node.text}
          onBlur={(e) => onText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') (e.target as HTMLTextAreaElement).blur()
          }}
        />
      )
    }
    if (!node.text.trim()) return <div className="canvas__card-text">Empty card</div>
    return <MarkdownCard text={node.text} />
  }

  if (node.type === 'file') {
    return (
      <>
        <div className="canvas__card-title">
          <Icon name="file-text" size={13} />
          <span>{stem(basename(node.file))}</span>
        </div>
        {preview === undefined ? (
          <div className="canvas__card-preview">…</div>
        ) : (
          <MarkdownCard text={preview} />
        )}
      </>
    )
  }

  if (node.type === 'link') {
    return (
      <div className="canvas__card-title">
        <Icon name="link" size={13} />
        <span>{node.url}</span>
      </div>
    )
  }

  return <div className="canvas__card-title">{node.label ?? 'Group'}</div>
}

/** Filtered list of vault notes, for dropping a note card on the board. */
function NotePicker({
  notes,
  onPick,
  onClose
}: {
  notes: { path: string; stem: string }[]
  onPick: (path: string) => void
  onClose: () => void
}): React.JSX.Element {
  const [query, setQuery] = useState('')
  const matches = notes
    .filter((n) => n.stem.toLowerCase().includes(query.trim().toLowerCase()))
    .slice(0, 40)

  return (
    <div className="canvas__picker" role="dialog" aria-label="Add a note to the canvas">
      <input
        className="canvas__picker-input"
        autoFocus
        placeholder="Add a note…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose()
          if (e.key === 'Enter' && matches[0]) onPick(matches[0].path)
        }}
      />
      <ul className="canvas__picker-list">
        {matches.map((note) => (
          <li key={note.path}>
            <button onClick={() => onPick(note.path)}>{note.stem}</button>
          </li>
        ))}
        {matches.length === 0 && <li className="canvas__picker-empty">No notes match.</li>}
      </ul>
    </div>
  )
}

/** First lines of each referenced note, so file cards say something. */
function useNotePreviews(canvas: JsonCanvas, rootPath: string | null): Record<string, string> {
  const [previews, setPreviews] = useState<Record<string, string>>({})

  const files = canvas.nodes
    .filter((n): n is Extract<CanvasNode, { type: 'file' }> => n.type === 'file')
    .map((n) => n.file)
  const key = files.join('|')

  useEffect(() => {
    if (!rootPath) return
    let stale = false
    const missing = files.filter((file) => previews[file] === undefined)
    if (missing.length === 0) return
    void Promise.all(
      missing.map(async (file) => {
        try {
          const { content } = await invoke('fs:readFile', { path: `${rootPath}/${file}` })
          return [file, content.replace(/^#.*$/m, '').trim().slice(0, PREVIEW_CHARS)] as const
        } catch {
          return [file, 'Missing note'] as const
        }
      })
    ).then((loaded) => {
      if (!stale) setPreviews((prev) => ({ ...prev, ...Object.fromEntries(loaded) }))
    })
    return () => {
      stale = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, rootPath])

  return previews
}
