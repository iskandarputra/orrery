import { showsLabel } from '@core/graph-labels'
import { SETTLED, step, type Link } from '@core/graph-sim'
import { filterGraphView, rankByFrequency } from '@core/graph-view'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { AnalyzedGraphNode, GraphAnalysis, GraphEdge } from '@shared/types'
import { useStore } from '@/state/store'
import { Icon } from './Icon'

interface SimNode extends AnalyzedGraphNode {
  x: number
  y: number
  vx: number
  vy: number
}

/** What node size means. Links is raw count; the others come from the analysis. */
type SizeBy = 'links' | 'influence' | 'bridge'
/** What node colour means. */
type ColorBy = 'none' | 'cluster' | 'folder' | 'kind'

/**
 * Groups are ranked by size and the eight biggest take the theme's validated
 * categorical slots; the tail folds into one muted colour rather than cycling
 * hues, which would give two clusters on screen the same colour.
 */
const VIZ_SLOTS = 8

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
  /** Analysis encodings. */
  sizeBy: SizeBy
  colorBy: ColorBy
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
  // Off: a map that names every note at rest is mostly text, and the two names
  // worth having (the node under the pointer, the note that is open) are shown
  // whatever this says. See `showsLabel`.
  labels: false,
  scale: true,
  sizeBy: 'links',
  colorBy: 'none',
  orphans: true,
  ghosts: true,
  query: '',
  local: false,
  depth: 1
}

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

export function GraphView(): React.JSX.Element | null {
  const open = useStore((s) => s.graphOpen)
  const close = (): void => useStore.setState({ graphOpen: false })
  const rootPath = useStore((s) => s.rootPath)
  const loadGraph = useStore((s) => s.loadGraph)
  const includeCode = useStore((s) => s.settings.graph.includeCode)
  const updateSettings = useStore((s) => s.updateSettings)
  const setIncludeCode = (on: boolean): void => updateSettings({ graph: { includeCode: on } })
  const activePath = useStore((s) =>
    s.activeId ? (s.buffers[s.activeId]?.filePath ?? null) : null
  )
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [status, setStatus] = useState('')
  const [panelOpen, setPanelOpen] = useState(false)
  const [ctl, setCtl] = useState<Controls>(DEFAULTS)
  const [hoverNode, setHoverNode] = useState<{ node: SimNode; x: number; y: number } | null>(null)

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
  // Index-based, built once per rebuild rather than resolved through byId per
  // edge per frame, which is the per-frame Map lookup this move exists to drop.
  const workLinksRef = useRef<Link[]>([])
  const readyRef = useRef(false)
  /** Largest metric values on screen — the scale that sizing is relative to. */
  const peakRef = useRef({ pagerank: 0, betweenness: 0 })
  /** Cluster / folder → palette slot, biggest first. */
  const clusterRankRef = useRef<Map<string, number>>(new Map())
  const folderRankRef = useRef<Map<string, number>>(new Map())
  /** Set by the canvas effect, so a rescan can reach the running view. */
  const ingestRef = useRef<((data: GraphAnalysis | null) => void) | null>(null)
  /**
   * Set by the canvas effect. The one path back into a sleeping animation
   * loop, so every handler that changes the layout or the view calls this
   * rather than repeating "clear the flag, request a frame": a handler that
   * forgets to call it is a visible missing call, not a graph that silently
   * stops responding.
   */
  const wakeRef = useRef<(() => void) | null>(null)
  const zoomControlsRef = useRef<{
    zoomIn(): void
    zoomOut(): void
    resetZoom(): void
    fit(): void
  } | null>(null)

  // Derive the visible sub-graph from the current controls, preserving positions.
  const rebuild = useCallback(() => {
    const all = allByIdRef.current
    const c = ctlRef.current
    const empty = (message: string): void => {
      workNodesRef.current = []
      workEdgesRef.current = []
      workByIdRef.current = new Map()
      workLinksRef.current = []
      setStatus(message)
    }
    if (all.size === 0) return empty('')

    const { ids, edges, needsCenter } = filterGraphView(all, allEdgesRef.current, {
      ghosts: c.ghosts,
      orphans: c.orphans,
      local: c.local,
      depth: c.depth,
      center: activePath
    })
    if (needsCenter) return empty('Open a note to see its local graph')

    const nodes: SimNode[] = []
    const byId = new Map<string, SimNode>()
    const indexOf = new Map<string, number>()
    for (const id of ids) {
      const node = all.get(id)
      if (node) {
        indexOf.set(id, nodes.length)
        nodes.push(node)
        byId.set(id, node)
      }
    }
    const links: Link[] = []
    for (const e of edges) {
      const a = indexOf.get(e.from)
      const b = indexOf.get(e.to)
      // Same guard as the per-frame `if (!a || !b) continue` this replaces:
      // an edge whose end fell outside the visible set is dropped here once,
      // rather than checked on every frame.
      if (a === undefined || b === undefined) continue
      links.push({ a, b })
    }
    workNodesRef.current = nodes
    workEdgesRef.current = edges
    workByIdRef.current = byId
    workLinksRef.current = links
    // The visible set just changed shape (a node came back in, a link
    // dropped out), so a sleeping layout needs to run again to react to it.
    wakeRef.current?.()
    // Named for what is actually on the map: calling a source file a note was
    // fine while the graph only had notes in it.
    const code = nodes.filter((n) => n.kind === 'code').length
    // A vault with one source file in it read "1 files", which is the sort of
    // thing that is invisible until it is in a screenshot.
    const count = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`
    setStatus(
      code > 0
        ? `${count(nodes.length - code, 'note', 'notes')} · ${count(code, 'file', 'files')} · ${count(edges.length, 'link', 'links')}`
        : `${count(nodes.length, 'note', 'notes')} · ${count(edges.length, 'link', 'links')}`
    )
  }, [activePath])

  const rebuildRef = useRef(rebuild)
  useEffect(() => {
    rebuildRef.current = rebuild
  })

  useEffect(() => {
    if (open && readyRef.current) rebuild()
  }, [open, rebuild, ctl.orphans, ctl.ghosts, ctl.local, ctl.depth])

  useEffect(() => {
    if (!open || !rootPath) return
    const canvas = canvasRef.current
    if (!canvas) return
    // 0 means no frame is currently scheduled: set on entry to tick, so a
    // handler firing between frames can tell the loop is not about to run on
    // its own and knows to ask for one.
    let raf = 0
    let disposed = false
    let hover: SimNode | null = null
    let drag: SimNode | null = null
    let zoom = 1
    let panX = 0
    let panY = 0
    let panning = false
    // Physics runs on a fixed clock, drawing on every frame: `last` and
    // `energy` therefore have to live here rather than inside tick. A frame
    // that lands less than 16ms after the previous one steps zero times and
    // still needs last frame's energy to judge whether the layout has
    // settled, and `last` to know how much time has passed once one finally
    // does step.
    let last = performance.now()
    let energy = Infinity
    readyRef.current = false

    /**
     * Bring the loop back from a stop, or do nothing if it is already running.
     * The one path back in: every handler that changes the layout or the view
     * calls this instead of touching `raf` itself.
     */
    const wake = (): void => {
      if (disposed) return
      if (raf === 0) {
        // Start the clock fresh. `last` survives the sleep, so without this a
        // wake after a long idle would see minutes of elapsed time, clamp it,
        // and pay three catch-up steps for what is usually just a request to
        // redraw.
        last = performance.now()
        raf = requestAnimationFrame(tick)
      }
    }
    wakeRef.current = wake

    zoomControlsRef.current = {
      zoomIn: () => {
        zoom = Math.min(3, zoom * 1.25)
        wake()
      },
      zoomOut: () => {
        zoom = Math.max(0.2, zoom * 0.8)
        wake()
      },
      resetZoom: () => {
        zoom = 1
        panX = 0
        panY = 0
        wake()
      },
      fit: () => {
        const nodes = workNodesRef.current
        if (nodes.length === 0) return
        let minX = Infinity,
          maxX = -Infinity,
          minY = Infinity,
          maxY = -Infinity
        for (const n of nodes) {
          if (n.x < minX) minX = n.x
          if (n.x > maxX) maxX = n.x
          if (n.y < minY) minY = n.y
          if (n.y > maxY) maxY = n.y
        }
        const w = maxX - minX + 100
        const h = maxY - minY + 100
        zoom = Math.min(2, Math.max(0.3, Math.min(canvas.clientWidth / w, canvas.clientHeight / h)))
        panX = (-(minX + maxX) / 2) * zoom
        panY = (-(minY + maxY) / 2) * zoom
        wake()
      }
    }

    const colors = {
      edge: cssVar('--or-border'),
      node: cssVar('--or-accent'),
      ghost: cssVar('--or-fg-faint'),
      label: cssVar('--or-fg-muted'),
      labelHover: cssVar('--or-fg'),
      viz: Array.from({ length: VIZ_SLOTS }, (_, i) => cssVar(`--or-viz-${i + 1}`))
    }

    const resize = (): void => {
      const dpr = window.devicePixelRatio || 1
      canvas.width = canvas.clientWidth * dpr
      canvas.height = canvas.clientHeight * dpr
      // The canvas was just cleared by the resize itself, so a sleeping
      // layout has to redraw once even though nothing about the physics changed.
      wake()
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
    // Size by raw links, by influence (PageRank) or by bridge score
    // (betweenness). The latter two are tiny fractions, so they are scaled
    // against the largest value on screen rather than used raw.
    const radius = (n: SimNode): number => {
      const c = ctlRef.current
      if (!c.scale) return 5
      if (c.sizeBy === 'links') return 4 + Math.min(10, Math.sqrt(n.degree) * 2)
      const peak = c.sizeBy === 'influence' ? peakRef.current.pagerank : peakRef.current.betweenness
      const value = c.sizeBy === 'influence' ? n.pagerank : n.betweenness
      return 4 + 10 * Math.sqrt(peak > 0 ? value / peak : 0)
    }

    const slotColor = (rank: number | undefined): string =>
      rank !== undefined && rank < VIZ_SLOTS ? colors.viz[rank]! : colors.ghost

    const nodeColor = (n: SimNode): string => {
      const c = ctlRef.current
      if (c.colorBy === 'cluster') return slotColor(clusterRankRef.current.get(String(n.community)))
      if (c.colorBy === 'folder') return slotColor(folderRankRef.current.get(n.folder))
      // Notes and code in two colours, which is the first question anyone asks
      // of a map that has both in it.
      if (c.colorBy === 'kind') return n.kind === 'code' ? colors.viz[1]! : colors.viz[0]!
      return colors.node
    }

    const pick = (cx: number, cy: number): SimNode | null => {
      const [wx, wy] = toWorld(cx, cy)
      let best: SimNode | null = null
      let bestD = Infinity
      for (const n of workNodesRef.current) {
        const d = Math.hypot(n.x - wx, n.y - wy)
        if (d < radius(n) + 8 / zoom && d < bestD) {
          best = n
          bestD = d
        }
      }
      return best
    }

    /**
     * Run one fixed 16ms step of the force simulation and return its kinetic
     * energy: the signal `tick` uses to decide whether the layout has
     * settled.
     */
    const advance = (): number => {
      const c = ctlRef.current
      const nodes = workNodesRef.current
      const pinned = drag ? nodes.indexOf(drag) : -1
      return step(
        nodes,
        workLinksRef.current,
        { repel: c.repel, linkForce: c.linkForce, linkDistance: c.linkDistance, center: c.center },
        pinned
      )
    }

    const draw = (): void => {
      const c = ctlRef.current
      const nodes = workNodesRef.current
      const edges = workEdgesRef.current
      const byId = workByIdRef.current

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
        const isActiveNode = n.id === activePath
        ctx.globalAlpha = dimmed ? 0.2 : 1
        ctx.fillStyle = n.exists ? nodeColor(n) : colors.ghost
        ctx.beginPath()
        ctx.arc(n.x, n.y, radius(n), 0, Math.PI * 2)
        ctx.fill()

        if (isActiveNode) {
          ctx.strokeStyle = colors.node
          ctx.lineWidth = 2 / zoom
          ctx.beginPath()
          ctx.arc(n.x, n.y, radius(n) + 3 / zoom, 0, Math.PI * 2)
          ctx.stroke()
        }

        if (
          showsLabel({
            always: c.labels,
            dimmed,
            zoom,
            degree: n.degree,
            isHover: n === hover,
            isActive: isActiveNode
          })
        ) {
          const isSpecial = n === hover || isActiveNode
          const maxChars = isSpecial ? 28 : Math.max(12, Math.floor(18 * zoom))
          const displayLabel =
            n.label.length > maxChars ? `${n.label.slice(0, maxChars - 1)}…` : n.label

          ctx.fillStyle = isSpecial ? colors.labelHover : colors.label
          ctx.font = `${isSpecial ? '600 ' : '400 '}${11 / zoom}px sans-serif`
          ctx.textAlign = 'center'

          // Render subtle halo for crisp legibility over crossing link edges
          ctx.save()
          ctx.shadowColor = 'rgba(0, 0, 0, 0.5)'
          ctx.shadowBlur = 4 / zoom
          ctx.fillText(displayLabel, n.x, n.y + radius(n) + 12 / zoom)
          ctx.restore()
        }
      }
      ctx.globalAlpha = 1
    }

    const tick = (): void => {
      // No frame is pending until the bottom of this function schedules one,
      // so a handler that fires while this frame runs (it can't, JS is
      // single threaded, but between frames) sees an accurate raf === 0.
      raf = 0

      // Step the layout on a fixed 16ms clock instead of once per drawn
      // frame, so the same vault settles in the same wall-clock time on a
      // 60Hz screen and a 120Hz one. The 48ms cap is three steps: past that,
      // a backgrounded tab or a stalled machine would otherwise hand back a
      // burst of catch-up steps that flings the arrangement apart, so the
      // layout is left to arrive slightly late rather than arrive wrong.
      const now = performance.now()
      let lag = Math.min(now - last, 48)
      last = now
      while (lag >= 16) {
        energy = advance()
        lag -= 16
      }

      // Draw every scheduled frame regardless of how many of those steps
      // ran, including zero: a wake still has to produce a visible frame
      // even when less than 16ms has elapsed since the last one.
      draw()

      if (disposed) return
      // Below the threshold and nothing is being dragged or panned: stop
      // asking for frames rather than integrating a graph that is not
      // visibly moving. `wake()` is what restarts this, from any handler
      // that changes the layout or the view.
      if (energy <= SETTLED && !drag && !panning) return
      raf = requestAnimationFrame(tick)
    }

    /**
     * Take a freshly scanned graph and make it the one on screen.
     *
     * Held in a ref as well as called here, because the graph can be rescanned
     * while the view is open — switching code files on is a different walk, not
     * a filter — and the result has to reach the canvas that is already
     * running.
     */
    const ingest = (data: GraphAnalysis | null): void => {
      if (disposed || !data) return
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
      peakRef.current = {
        pagerank: Math.max(0, ...data.nodes.map((n) => n.pagerank)),
        betweenness: Math.max(0, ...data.nodes.map((n) => n.betweenness))
      }
      clusterRankRef.current = rankByFrequency(data.nodes.map((n) => n.community))
      folderRankRef.current = rankByFrequency(data.nodes.map((n) => n.folder))
      readyRef.current = true
      rebuildRef.current()
      // Fresh positions on a fresh scan: rebuild() already wakes for the new
      // node set, but a rescan of a graph that had settled needs this too in
      // case rebuild bailed out early (an empty result, say).
      wake()
    }
    ingestRef.current = ingest

    setStatus('Building graph…')
    void loadGraph().then(ingest)

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
        const found = pick(e.clientX, e.clientY)
        if (found !== hover) {
          hover = found
          // A settled graph draws no frames, so the highlight and the label
          // showsLabel grants the hovered node would never appear. Waking on
          // a change of hover rather than on every move is what keeps the
          // graph asleep while the pointer merely travels across it: the
          // mouse fires this handler continuously, and most of the time
          // somebody is looking at the graph is time spent with the pointer
          // over it, not moving off a node.
          wake()
        }
        canvas.style.cursor = hover ? 'pointer' : 'grab'
        if (hover) {
          setHoverNode({ node: hover, x: e.clientX, y: e.clientY })
        } else {
          setHoverNode(null)
        }
      }
    }
    const onDown = (e: MouseEvent): void => {
      drag = pick(e.clientX, e.clientY)
      if (!drag) panning = true
      // Either branch needs frames for the whole gesture, not just one: a
      // dragged node's new position and a pan's new offset only reach the
      // canvas if tick keeps running until the mouse comes back up.
      wake()
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
      zoom = Math.min(3, Math.max(0.2, zoom * (e.deltaY > 0 ? 0.9 : 1.1)))
      wake()
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
      zoomControlsRef.current = null
      wakeRef.current = null
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
      canvas.removeEventListener('mousemove', onMove)
      canvas.removeEventListener('mousedown', onDown)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('keydown', onKey)
      canvas.removeEventListener('wheel', onWheel)
    }
  }, [open, rootPath, activePath, loadGraph])

  if (!open) return null

  const up = (patch: Partial<Controls>): void => {
    setCtl((c) => ({ ...c, ...patch }))
    // Every Range/Check/Select goes through here, so this one call wakes a
    // sleeping layout for all of them, whether the change moves a force or
    // only what gets drawn.
    wakeRef.current?.()
  }

  return (
    <div className="modal-backdrop">
      <div className="graph" role="dialog" aria-label="Knowledge Graph View">
        <div className="graph__header">
          <div className="graph__title-group">
            <Icon name="diagram" size={16} />
            <span className="graph__title">Knowledge Graph</span>
            <span className="graph__status-pill">{status}</span>
          </div>

          <div className="graph__header-controls">
            {/* Quick search input */}
            <div className="graph__header-search">
              <Icon name="search" size={13} />
              <input
                placeholder="Filter graph notes…"
                value={ctl.query}
                onChange={(e) => up({ query: e.target.value })}
              />
              {ctl.query && (
                <button
                  className="graph__search-clear"
                  title="Clear filter"
                  aria-label="Clear filter"
                  onClick={() => up({ query: '' })}
                >
                  <Icon name="x" size={11} />
                </button>
              )}
            </div>

            {/* Local graph toggle */}
            <button
              className={`graph__header-btn${ctl.local ? ' graph__header-btn--active' : ''}`}
              title="Toggle Local Graph (around active note)"
              onClick={() => up({ local: !ctl.local })}
            >
              <span>Local</span>
            </button>

            {/* Zoom controls */}
            <div className="graph__zoom-group">
              <button
                className="icon-btn"
                title="Zoom In"
                onClick={() => zoomControlsRef.current?.zoomIn()}
              >
                <Icon name="plus" size={14} />
              </button>
              <button
                className="icon-btn"
                title="Zoom Out"
                onClick={() => zoomControlsRef.current?.zoomOut()}
              >
                <span style={{ fontWeight: 700 }}>−</span>
              </button>
              <button
                className="icon-btn"
                title="Fit to Screen"
                onClick={() => zoomControlsRef.current?.fit()}
              >
                <Icon name="maximize" size={13} />
              </button>
            </div>

            {/* Settings drawer toggle */}
            <button
              className={`icon-btn${panelOpen ? ' graph__gear--on' : ''}`}
              aria-label="Graph Physics &amp; Display Settings"
              aria-pressed={panelOpen}
              title="Graph Settings"
              onClick={() => setPanelOpen((o) => !o)}
            >
              <Icon name="sliders" size={15} />
            </button>

            <button className="icon-btn" aria-label="Close graph" onClick={close}>
              <Icon name="x" size={15} />
            </button>
          </div>
        </div>

        {rootPath ? (
          <div className="graph__body">
            <canvas ref={canvasRef} className="graph__canvas" />

            {/* Hover Tooltip Card */}
            {hoverNode && (
              <div
                className="graph__hover-card"
                style={{
                  left: hoverNode.x + 12,
                  top: hoverNode.y + 12
                }}
              >
                <div className="graph__hover-header">
                  <Icon name={hoverNode.node.exists ? 'file-text' : 'link'} size={13} />
                  <span className="graph__hover-title">{hoverNode.node.label}</span>
                </div>
                <div className="graph__hover-meta">
                  <span>
                    {hoverNode.node.inDegree} in · {hoverNode.node.outDegree} out
                  </span>
                  {hoverNode.node.exists && (
                    <span>
                      {hoverNode.node.words.toLocaleString()} words · cluster{' '}
                      {hoverNode.node.community + 1}
                    </span>
                  )}
                  {!hoverNode.node.exists && (
                    <span className="graph__hover-ghost">(Uncreated note)</span>
                  )}
                </div>
              </div>
            )}

            {panelOpen && (
              <div className="graph__panel">
                <section className="graph__section">
                  <h4 className="graph__section-title">Filters</h4>
                  <Check label="Orphan notes" on={ctl.orphans} set={(v) => up({ orphans: v })} />
                  <Check
                    label="Ghost (uncreated) notes"
                    on={ctl.ghosts}
                    set={(v) => up({ ghosts: v })}
                  />
                  <Check label="Local graph mode" on={ctl.local} set={(v) => up({ local: v })} />
                  {ctl.local && (
                    <Range
                      label={`Depth · ${ctl.depth} hops`}
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
                  <Range
                    label="Gravity (Center)"
                    value={ctl.center}
                    min={0}
                    max={2}
                    step={0.05}
                    set={(v) => up({ center: v })}
                  />
                  <Range
                    label="Node Repulsion"
                    value={ctl.repel}
                    min={0}
                    max={2}
                    step={0.05}
                    set={(v) => up({ repel: v })}
                  />
                  <Range
                    label="Link Elasticity"
                    value={ctl.linkForce}
                    min={0}
                    max={2}
                    step={0.05}
                    set={(v) => up({ linkForce: v })}
                  />
                  <Range
                    label="Link Distance"
                    value={ctl.linkDistance}
                    min={0.2}
                    max={2.5}
                    step={0.05}
                    set={(v) => up({ linkDistance: v })}
                  />
                </section>
                <section className="graph__section">
                  <h4 className="graph__section-title">Analysis</h4>
                  <Select
                    label="Size by"
                    value={ctl.sizeBy}
                    options={[
                      ['links', 'Link count'],
                      ['influence', 'Influence (PageRank)'],
                      ['bridge', 'Bridge score']
                    ]}
                    set={(v) => up({ sizeBy: v as SizeBy, scale: true })}
                  />
                  <Select
                    label="Colour by"
                    value={ctl.colorBy}
                    options={[
                      ['none', 'Nothing'],
                      ['cluster', 'Topic cluster'],
                      ['folder', 'Folder'],
                      ['kind', 'Notes or code']
                    ]}
                    set={(v) => up({ colorBy: v as ColorBy })}
                  />
                </section>
                <section className="graph__section">
                  <h4 className="graph__section-title">Display</h4>
                  <Check
                    label="Link direction arrows"
                    on={ctl.arrows}
                    set={(v) => up({ arrows: v })}
                  />
                  <Check
                    label="Always show note labels"
                    on={ctl.labels}
                    set={(v) => up({ labels: v })}
                  />
                  <Check label="Scale node size" on={ctl.scale} set={(v) => up({ scale: v })} />
                  <Check
                    label="Include code files"
                    on={includeCode}
                    set={(v) => {
                      setIncludeCode(v)
                      // A different walk, not a filter: rescan, then hand the
                      // result to the canvas that is already running.
                      void loadGraph(true).then((data) => ingestRef.current?.(data))
                    }}
                  />
                </section>
                <button
                  className="graph__reset"
                  onClick={() => {
                    setCtl({ ...DEFAULTS })
                    wakeRef.current?.()
                  }}
                >
                  Reset to defaults
                </button>
              </div>
            )}
          </div>
        ) : (
          <p className="rpanel-empty">Open a folder to see its knowledge graph.</p>
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

function Select({
  label,
  value,
  options,
  set
}: {
  label: string
  value: string
  options: [string, string][]
  set: (v: string) => void
}): React.JSX.Element {
  return (
    <label className="graph__range">
      <span className="graph__range-label">{label}</span>
      <select className="graph__select" value={value} onChange={(e) => set(e.target.value)}>
        {options.map(([id, text]) => (
          <option key={id} value={id}>
            {text}
          </option>
        ))}
      </select>
    </label>
  )
}
