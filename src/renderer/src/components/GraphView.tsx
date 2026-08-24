import { useCallback, useEffect, useRef, useState } from 'react'
import type { GraphData, GraphEdge } from '@shared/types'
import { invoke } from '@/services/client'
import { useStore } from '@/state/store'
import { Icon } from './Icon'

interface SimNode {
  id: string
  label: string
  exists: boolean
  degree: number
  x: number
  y: number
  vx: number
  vy: number
}

/** Tunable graph controls — mirrors Obsidian's Filters / Forces / Display panel. */
interface Controls {
  /** Force multipliers (1 = baseline). */
  center: number
  repel: number
  linkForce: number
  linkDistance: number
  /** Display toggles. */
  arrows: boolean
  labels: boolean
  scale: boolean
  /** Membership toggles. */
  orphans: boolean
  ghosts: boolean
  /** Filter + local view. */
  query: string
  local: boolean
  depth: number
}

const DEFAULTS: Controls = {
  center: 1,
  repel: 1,
  linkForce: 1,
  linkDistance: 1,
  arrows: false,
  labels: true,
  scale: true,
  orphans: true,
  ghosts: true,
  query: '',
  local: false,
  depth: 1
}

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

/**
 * Force-directed vault graph on a canvas: spring edges, pairwise repulsion,
 * centering gravity. Hand-rolled (no deps) — personal vaults are hundreds of
 * notes, well within O(n²) per frame.
 *
 * Controls live in React state; the simulation reads them through refs so the
 * physics loop is never torn down when a slider moves. Node membership
 * (orphans / ghosts / local view) is recomputed by `rebuild()`, which reuses
 * the persistent SimNode objects so positions survive filter changes.
 */
export function GraphView(): React.JSX.Element | null {
  const open = useStore((s) => s.graphOpen)
  const close = (): void => useStore.setState({ graphOpen: false })
  const rootPath = useStore((s) => s.rootPath)
  const activePath = useStore((s) => (s.activeId ? (s.buffers[s.activeId]?.filePath ?? null) : null))
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [status, setStatus] = useState('')
  const [panelOpen, setPanelOpen] = useState(false)
  const [ctl, setCtl] = useState<Controls>(DEFAULTS)

  // Live view of the controls for the animation loop (no re-subscribe on change).
  const ctlRef = useRef(ctl)
  useEffect(() => {
    ctlRef.current = ctl
  })

  // Persistent simulation state, shared between the sim effect and rebuild().
  const allByIdRef = useRef<Map<string, SimNode>>(new Map())
  const allEdgesRef = useRef<GraphEdge[]>([])
  const workNodesRef = useRef<SimNode[]>([])
  const workEdgesRef = useRef<GraphEdge[]>([])
  const workByIdRef = useRef<Map<string, SimNode>>(new Map())
  const readyRef = useRef(false)

  // Derive the visible sub-graph from the current controls, preserving positions.
  const rebuild = useCallback(() => {
    const all = allByIdRef.current
    const allEdges = allEdgesRef.current
    const c = ctlRef.current
    const empty = (msg: string): void => {
      workNodesRef.current = []
      workEdgesRef.current = []
      workByIdRef.current = new Map()
      setStatus(msg)
    }
    if (all.size === 0) return empty('')

    // Ghost (linked-but-missing) filter.
    const ids = new Set<string>()
    for (const [id, n] of all) if (c.ghosts || n.exists) ids.add(id)

    // Local view: BFS out from the active note up to `depth` hops.
    if (c.local) {
      const center = activePath && ids.has(activePath) ? activePath : null
      if (!center) return empty('Open a note to see its local graph')
      const adj = new Map<string, string[]>()
      const link = (a: string, b: string): void => {
        const list = adj.get(a)
        if (list) list.push(b)
        else adj.set(a, [b])
      }
      for (const e of allEdges) {
        if (!ids.has(e.from) || !ids.has(e.to)) continue
        link(e.from, e.to)
        link(e.to, e.from)
      }
      const reached = new Set([center])
      let frontier = [center]
      for (let d = 0; d < c.depth; d++) {
        const next: string[] = []
        for (const id of frontier)
          for (const nb of adj.get(id) ?? [])
            if (!reached.has(nb)) {
              reached.add(nb)
              next.push(nb)
            }
        frontier = next
      }
      ids.forEach((id) => {
        if (!reached.has(id)) ids.delete(id)
      })
    }

    let edges = allEdges.filter((e) => ids.has(e.from) && ids.has(e.to))

    // Orphan (unlinked) filter — after ghost/local pruning removes their edges.
    if (!c.orphans) {
      const linked = new Set<string>()
      for (const e of edges) {
        linked.add(e.from)
        linked.add(e.to)
      }
      ids.forEach((id) => {
        if (!linked.has(id)) ids.delete(id)
      })
      edges = edges.filter((e) => ids.has(e.from) && ids.has(e.to))
    }

    const nodes: SimNode[] = []
    const byId = new Map<string, SimNode>()
    ids.forEach((id) => {
      const n = all.get(id)
      if (n) {
        nodes.push(n)
        byId.set(id, n)
      }
    })
    workNodesRef.current = nodes
    workEdgesRef.current = edges
    workByIdRef.current = byId
    setStatus(`${nodes.length} notes · ${edges.length} links`)
  }, [activePath])

  // Stable handle so the long-lived sim effect can call the latest rebuild()
  // without re-running (and refetching) when the active note changes.
  const rebuildRef = useRef(rebuild)
  useEffect(() => {
    rebuildRef.current = rebuild
  })

  // Recompute membership when a filter/local control (or the active note) changes.
  useEffect(() => {
    if (open && readyRef.current) rebuild()
  }, [open, rebuild, ctl.orphans, ctl.ghosts, ctl.local, ctl.depth])

  useEffect(() => {
    if (!open || !rootPath) return
    const canvas = canvasRef.current
    if (!canvas) return
    let raf = 0
    let disposed = false
    let hover: SimNode | null = null
    let drag: SimNode | null = null
    let zoom = 1
    let panX = 0
    let panY = 0
    let panning = false
    readyRef.current = false

    const colors = {
      edge: cssVar('--zy-border'),
      node: cssVar('--zy-accent'),
      ghost: cssVar('--zy-fg-faint'),
      label: cssVar('--zy-fg-muted'),
      labelHover: cssVar('--zy-fg')
    }

    const resize = (): void => {
      const dpr = window.devicePixelRatio || 1
      canvas.width = canvas.clientWidth * dpr
      canvas.height = canvas.clientHeight * dpr
    }
    resize()
    window.addEventListener('resize', resize)

    const toWorld = (cx: number, cy: number): [number, number] => {
      const rect = canvas.getBoundingClientRect()
      return [
        (cx - rect.left - rect.width / 2 - panX) / zoom,
        (cy - rect.top - rect.height / 2 - panY) / zoom
      ]
    }
    const radius = (n: SimNode): number =>
      ctlRef.current.scale ? 4 + Math.min(10, Math.sqrt(n.degree) * 2) : 5

    const pick = (cx: number, cy: number): SimNode | null => {
      const [wx, wy] = toWorld(cx, cy)
      let best: SimNode | null = null
      let bestD = Infinity
      for (const n of workNodesRef.current) {
        const d = Math.hypot(n.x - wx, n.y - wy)
        if (d < radius(n) + 6 / zoom && d < bestD) {
          best = n
          bestD = d
        }
      }
      return best
    }

    const tick = (): void => {
      const c = ctlRef.current
      const nodes = workNodesRef.current
      const edges = workEdgesRef.current
      const byId = workByIdRef.current

      // Physics.
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i]!
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j]!
          let dx = a.x - b.x
          let dy = a.y - b.y
          const d2 = Math.max(64, dx * dx + dy * dy)
          const f = (900 * c.repel) / d2
          const d = Math.sqrt(d2)
          dx /= d
          dy /= d
          a.vx += dx * f
          a.vy += dy * f
          b.vx -= dx * f
          b.vy -= dy * f
        }
      }
      const rest = 90 * c.linkDistance
      const spring = 0.004 * c.linkForce
      for (const e of edges) {
        const a = byId.get(e.from)
        const b = byId.get(e.to)
        if (!a || !b) continue
        const dx = b.x - a.x
        const dy = b.y - a.y
        const d = Math.max(1, Math.hypot(dx, dy))
        const f = (d - rest) * spring
        a.vx += (dx / d) * f
        a.vy += (dy / d) * f
        b.vx -= (dx / d) * f
        b.vy -= (dy / d) * f
      }
      const gravity = 0.0015 * c.center
      for (const n of nodes) {
        if (n === drag) continue
        n.vx = (n.vx - n.x * gravity) * 0.85
        n.vy = (n.vy - n.y * gravity) * 0.85
        n.x += n.vx
        n.y += n.vy
      }

      // Draw.
      const ctx = canvas.getContext('2d')!
      const dpr = window.devicePixelRatio || 1
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight)
      ctx.translate(canvas.clientWidth / 2 + panX, canvas.clientHeight / 2 + panY)
      ctx.scale(zoom, zoom)

      const q = c.query.trim().toLowerCase()
      const matches = (n: SimNode): boolean => !q || n.label.toLowerCase().includes(q)

      const neighbors = new Set<string>()
      if (hover) {
        neighbors.add(hover.id)
        for (const e of edges) {
          if (e.from === hover.id) neighbors.add(e.to)
          if (e.to === hover.id) neighbors.add(e.from)
        }
      }

      for (const e of edges) {
        const a = byId.get(e.from)
        const b = byId.get(e.to)
        if (!a || !b) continue
        const lit = hover != null && (e.from === hover.id || e.to === hover.id)
        let alpha = hover ? (lit ? 0.9 : 0.15) : 0.6
        if (q && !matches(a) && !matches(b)) alpha = 0.05
        ctx.strokeStyle = lit ? colors.node : colors.edge
        ctx.globalAlpha = alpha
        ctx.lineWidth = (lit ? 1.6 : 1) / zoom
        ctx.beginPath()
        ctx.moveTo(a.x, a.y)
        ctx.lineTo(b.x, b.y)
        ctx.stroke()

        // Directional arrowhead just outside the target node.
        if (c.arrows) {
          const len = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y))
          const ux = (b.x - a.x) / len
          const uy = (b.y - a.y) / len
          const tipX = b.x - ux * (radius(b) + 1.5)
          const tipY = b.y - uy * (radius(b) + 1.5)
          const size = 6 / zoom
          const ang = Math.atan2(uy, ux)
          ctx.beginPath()
          ctx.moveTo(tipX, tipY)
          ctx.lineTo(tipX - size * Math.cos(ang - 0.4), tipY - size * Math.sin(ang - 0.4))
          ctx.moveTo(tipX, tipY)
          ctx.lineTo(tipX - size * Math.cos(ang + 0.4), tipY - size * Math.sin(ang + 0.4))
          ctx.stroke()
        }
      }
      for (const n of nodes) {
        const dimmed = (hover != null && !neighbors.has(n.id)) || !matches(n)
        ctx.globalAlpha = dimmed ? 0.2 : 1
        ctx.fillStyle = n.exists ? colors.node : colors.ghost
        ctx.beginPath()
        ctx.arc(n.x, n.y, radius(n), 0, Math.PI * 2)
        ctx.fill()
        if (c.labels && !dimmed && (zoom > 0.7 || n === hover || n.degree >= 3)) {
          ctx.fillStyle = n === hover ? colors.labelHover : colors.label
          ctx.font = `${11 / zoom}px sans-serif`
          ctx.textAlign = 'center'
          ctx.fillText(n.label, n.x, n.y + radius(n) + 12 / zoom)
        }
      }
      ctx.globalAlpha = 1
      if (!disposed) raf = requestAnimationFrame(tick)
    }

    setStatus('Building graph…')
    void invoke('workspace:graph', { rootPath }).then((data: GraphData) => {
      if (disposed) return
      const all = new Map<string, SimNode>()
      data.nodes.forEach((n, i) => {
        all.set(n.id, {
          ...n,
          x: Math.cos((i / data.nodes.length) * Math.PI * 2) * 160,
          y: Math.sin((i / data.nodes.length) * Math.PI * 2) * 160,
          vx: 0,
          vy: 0
        })
      })
      allByIdRef.current = all
      allEdgesRef.current = data.edges
      readyRef.current = true
      rebuildRef.current()
      raf = requestAnimationFrame(tick)
    })

    const onMove = (e: MouseEvent): void => {
      if (drag) {
        const [wx, wy] = toWorld(e.clientX, e.clientY)
        drag.x = wx
        drag.y = wy
        drag.vx = 0
        drag.vy = 0
      } else if (panning) {
        panX += e.movementX
        panY += e.movementY
      } else {
        hover = pick(e.clientX, e.clientY)
        canvas.style.cursor = hover ? 'pointer' : 'grab'
      }
    }
    const onDown = (e: MouseEvent): void => {
      drag = pick(e.clientX, e.clientY)
      if (!drag) panning = true
    }
    const onUp = (e: MouseEvent): void => {
      if (drag && !panning) {
        const clicked = pick(e.clientX, e.clientY)
        if (clicked === drag && clicked.exists && Math.hypot(e.movementX, e.movementY) < 4) {
          void useStore.getState().openPaths([clicked.id])
          close()
        }
      }
      drag = null
      panning = false
    }
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      zoom = Math.min(3, Math.max(0.25, zoom * (e.deltaY > 0 ? 0.9 : 1.1)))
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    canvas.addEventListener('mousemove', onMove)
    canvas.addEventListener('mousedown', onDown)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('keydown', onKey)
    canvas.addEventListener('wheel', onWheel, { passive: false })

    return () => {
      disposed = true
      readyRef.current = false
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
      canvas.removeEventListener('mousemove', onMove)
      canvas.removeEventListener('mousedown', onDown)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('keydown', onKey)
      canvas.removeEventListener('wheel', onWheel)
    }
  }, [open, rootPath])

  if (!open) return null

  const up = (patch: Partial<Controls>): void => setCtl((c) => ({ ...c, ...patch }))

  return (
    <div className="modal-backdrop">
      <div className="graph" role="dialog" aria-label="Graph view">
        <div className="graph__header">
          <span className="graph__title">Graph</span>
          <span className="graph__status">{status}</span>
          <button
            className={`icon-btn${panelOpen ? ' graph__gear--on' : ''}`}
            aria-label="Graph settings"
            aria-pressed={panelOpen}
            onClick={() => setPanelOpen((o) => !o)}
          >
            <Icon name="sliders" size={15} />
          </button>
          <button className="icon-btn" aria-label="Close graph" onClick={close}>
            <Icon name="x" size={15} />
          </button>
        </div>
        {rootPath ? (
          <div className="graph__body">
            <canvas ref={canvasRef} className="graph__canvas" />
            {panelOpen && (
              <div className="graph__panel">
                <section className="graph__section">
                  <h4 className="graph__section-title">Filters</h4>
                  <div className="graph__search">
                    <Icon name="search" size={13} />
                    <input
                      className="graph__search-input"
                      placeholder="Filter notes…"
                      value={ctl.query}
                      onChange={(e) => up({ query: e.target.value })}
                    />
                  </div>
                  <Check label="Orphans" on={ctl.orphans} set={(v) => up({ orphans: v })} />
                  <Check label="Ghost nodes" on={ctl.ghosts} set={(v) => up({ ghosts: v })} />
                  <Check label="Local graph" on={ctl.local} set={(v) => up({ local: v })} />
                  {ctl.local && (
                    <Range
                      label={`Depth · ${ctl.depth}`}
                      value={ctl.depth}
                      min={1}
                      max={3}
                      step={1}
                      set={(v) => up({ depth: v })}
                    />
                  )}
                </section>
                <section className="graph__section">
                  <h4 className="graph__section-title">Forces</h4>
                  <Range label="Center" value={ctl.center} min={0} max={2} step={0.05} set={(v) => up({ center: v })} />
                  <Range label="Repel" value={ctl.repel} min={0} max={2} step={0.05} set={(v) => up({ repel: v })} />
                  <Range label="Link force" value={ctl.linkForce} min={0} max={2} step={0.05} set={(v) => up({ linkForce: v })} />
                  <Range label="Link distance" value={ctl.linkDistance} min={0.2} max={2.5} step={0.05} set={(v) => up({ linkDistance: v })} />
                </section>
                <section className="graph__section">
                  <h4 className="graph__section-title">Display</h4>
                  <Check label="Arrows" on={ctl.arrows} set={(v) => up({ arrows: v })} />
                  <Check label="Labels" on={ctl.labels} set={(v) => up({ labels: v })} />
                  <Check label="Size by links" on={ctl.scale} set={(v) => up({ scale: v })} />
                </section>
                <button className="graph__reset" onClick={() => setCtl({ ...DEFAULTS })}>
                  Reset to defaults
                </button>
              </div>
            )}
          </div>
        ) : (
          <p className="rpanel-empty">Open a folder to see its graph.</p>
        )}
      </div>
    </div>
  )
}

function Check({
  label,
  on,
  set
}: {
  label: string
  on: boolean
  set: (v: boolean) => void
}): React.JSX.Element {
  return (
    <label className="graph__check">
      <input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} />
      <span>{label}</span>
    </label>
  )
}

function Range({
  label,
  value,
  min,
  max,
  step,
  set
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  set: (v: number) => void
}): React.JSX.Element {
  return (
    <label className="graph__range">
      <span className="graph__range-label">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => set(parseFloat(e.target.value))}
      />
    </label>
  )
}
