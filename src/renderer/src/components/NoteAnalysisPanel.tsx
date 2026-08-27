import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AnalyzedGraphNode, GraphAnalysis, LinkSuggestion } from '@shared/types'
import { stem } from '@core/paths'
import { getActiveView } from '@/editor/active-view'
import { invoke } from '@/services/client'
import { useStore } from '@/state/store'
import { Icon } from './Icon'
import { EmptyState } from './PanelBits'

/** Palette slots shared with the graph overlay and the analytics view. */
const VIZ_SLOTS = 8
const MAX_NEIGHBOURS = 8
const MAX_MENTIONS = 8
const MAX_SUGGESTIONS = 5

interface Neighbour {
  id: string
  label: string
  /** Which way the link runs, from the active note's point of view. */
  direction: 'in' | 'out' | 'both'
}

/**
 * What the vault's structure says about the note you have open: how central it
 * is, who it sits with, and the notes that mention it without linking. Reads
 * the shared analysis cache — the same numbers the graph and analytics show.
 */
export function NoteAnalysisBody(): React.JSX.Element {
  const rootPath = useStore((s) => s.rootPath)
  const activePath = useStore((s) => (s.activeId ? (s.buffers[s.activeId]?.filePath ?? null) : null))
  const analysis = useStore((s) => s.graph)
  const loading = useStore((s) => s.graphLoading)
  const loadGraph = useStore((s) => s.loadGraph)
  const openPaths = useStore((s) => s.openPaths)

  useEffect(() => {
    if (rootPath) void loadGraph()
  }, [rootPath, loadGraph])

  const note = useMemo(
    () => analysis?.nodes.find((n) => n.id === activePath) ?? null,
    [analysis, activePath]
  )

  const mentions = useUnlinkedMentions(analysis, activePath, rootPath)
  const suggestions = useLinkSuggestions(activePath, rootPath)

  if (!activePath) return <EmptyState icon="link">Open a note to analyse it.</EmptyState>
  if (!analysis) {
    return <EmptyState icon="link">{loading ? 'Analysing vault…' : 'No analysis yet.'}</EmptyState>
  }
  if (!note) {
    return (
      <EmptyState icon="link">
        This note isn&apos;t in the analysis yet — save it, then rescan.
        <button className="analytics__rescan" onClick={() => void loadGraph(true)}>
          Rescan vault
        </button>
      </EmptyState>
    )
  }

  const ranked = [...analysis.nodes]
    .filter((n) => n.exists)
    .sort((a, b) => b.pagerank - a.pagerank || a.id.localeCompare(b.id))
  const rank = ranked.findIndex((n) => n.id === note.id) + 1
  const cluster = describeCluster(analysis.nodes, note)
  const neighbours = collectNeighbours(analysis, note.id)

  return (
    <div className="note-analysis">
      <div className="analytics__tiles note-analysis__tiles">
        <Metric value={`#${rank}`} label={`of ${ranked.length} by influence`} />
        <Metric value={`${(note.pagerank * 100).toFixed(1)}%`} label="Vault influence" />
        <Metric value={String(note.inDegree)} label="Links in" />
        <Metric value={String(note.outDegree)} label="Links out" />
      </div>

      <section className="note-analysis__section">
        <h4 className="analytics__list-title">Cluster</h4>
        <div className="analytics__cluster">
          <span
            className="analytics__swatch"
            style={{
              background:
                cluster.rank < VIZ_SLOTS ? `var(--or-viz-${cluster.rank + 1})` : 'var(--or-fg-faint)'
            }}
          />
          <span className="analytics__cluster-label">{cluster.label}</span>
          <span className="analytics__cluster-count">
            {cluster.size} note{cluster.size === 1 ? '' : 's'}
          </span>
        </div>
        {note.betweenness > 0 && (
          <p className="analytics__hint">
            Bridge score {note.betweenness.toFixed(2)} — it sits on paths between other notes.
          </p>
        )}
      </section>

      <section className="note-analysis__section">
        <h4 className="analytics__list-title">
          Neighbours
          <span className="analytics__list-count">{neighbours.length}</span>
        </h4>
        {neighbours.length === 0 ? (
          <p className="analytics__empty">Nothing links here and it links nowhere.</p>
        ) : (
          <ul className="note-analysis__list">
            {neighbours.slice(0, MAX_NEIGHBOURS).map((n) => (
              <li key={n.id}>
                <button
                  className="analytics__row"
                  onClick={() => n.id.startsWith('ghost:') || void openPaths([n.id])}
                  title={n.id}
                >
                  <Icon
                    name={n.direction === 'in' ? 'arrow-left' : 'external-link'}
                    size={11}
                    className="note-analysis__dir"
                  />
                  <span className="analytics__row-label">{n.label}</span>
                  <span className="analytics__row-value">
                    {n.direction === 'both' ? 'both ways' : n.direction}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="note-analysis__section">
        <h4 className="analytics__list-title">
          Suggested links
          <span className="analytics__list-count">{suggestions.length}</span>
        </h4>
        <p className="analytics__hint">
          Notes about the same thing that this one doesn&apos;t link to yet.
        </p>
        {suggestions.length === 0 ? (
          <p className="analytics__empty">
            None. Semantic suggestions need the vault index — Settings → AI → Reindex vault.
          </p>
        ) : (
          <ul className="note-analysis__list">
            {suggestions.slice(0, MAX_SUGGESTIONS).map((s) => (
              <li key={s.id}>
                <div className="note-analysis__suggestion">
                  <button className="analytics__row" onClick={() => void openPaths([s.id])} title={s.id}>
                    <span className="analytics__row-label">{s.label}</span>
                    <span className="analytics__row-value">
                      {Math.round(s.similarity * 100)}% · {describeDistance(s.hops)}
                    </span>
                  </button>
                  <button
                    className="note-analysis__link-btn"
                    title={`Insert [[${s.label}]] at the cursor`}
                    onClick={() => insertWikilink(s.label)}
                  >
                    <Icon name="link" size={12} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="note-analysis__section">
        <h4 className="analytics__list-title">
          Unlinked mentions
          <span className="analytics__list-count">{mentions.length}</span>
        </h4>
        <p className="analytics__hint">
          Notes that say “{stem(activePath)}” without linking it.
        </p>
        {mentions.length === 0 ? (
          <p className="analytics__empty">None — every mention is already a link.</p>
        ) : (
          <ul className="note-analysis__list">
            {mentions.slice(0, MAX_MENTIONS).map((path) => (
              <li key={path}>
                <button className="analytics__row" onClick={() => void openPaths([path])} title={path}>
                  <span className="analytics__row-label">{stem(path)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

/** "4 hops away" reads better than a bare number, and null means no path at all. */
function describeDistance(hops: number | null): string {
  if (hops === null) return 'not connected'
  return `${hops} hop${hops === 1 ? '' : 's'} away`
}

/** Write the link into the note at the cursor — the point of the suggestion. */
function insertWikilink(label: string): void {
  const view = getActiveView()
  if (!view) return
  const { from, to } = view.state.selection.main
  view.dispatch({
    changes: { from, to, insert: `[[${label}]]` },
    selection: { anchor: from + label.length + 4 }
  })
  view.focus()
}

function Metric({ value, label }: { value: string; label: string }): React.JSX.Element {
  return (
    <div className="analytics__tile">
      <span className="analytics__tile-value">{value}</span>
      <span className="analytics__tile-label">{label}</span>
    </div>
  )
}

/** Both directions of every link touching the note, in one list. */
function collectNeighbours(analysis: GraphAnalysis, id: string): Neighbour[] {
  const labels = new Map(analysis.nodes.map((n) => [n.id, n.label]))
  const directions = new Map<string, 'in' | 'out' | 'both'>()
  const add = (other: string, direction: 'in' | 'out'): void => {
    const seen = directions.get(other)
    directions.set(other, seen && seen !== direction ? 'both' : direction)
  }
  for (const edge of analysis.edges) {
    if (edge.from === id) add(edge.to, 'out')
    else if (edge.to === id) add(edge.from, 'in')
  }
  return [...directions.entries()]
    .map(([other, direction]) => ({ id: other, label: labels.get(other) ?? other, direction }))
    .sort((a, b) => a.label.localeCompare(b.label))
}

/** The note's cluster: its palette slot, size, and most influential member. */
function describeCluster(
  nodes: AnalyzedGraphNode[],
  note: AnalyzedGraphNode
): { rank: number; label: string; size: number } {
  const sizes = new Map<number, number>()
  for (const n of nodes) sizes.set(n.community, (sizes.get(n.community) ?? 0) + 1)
  const order = [...sizes.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])
  const rank = order.findIndex(([community]) => community === note.community)
  const members = nodes.filter((n) => n.community === note.community)
  const lead = [...members].sort(
    (a, b) => b.pagerank - a.pagerank || a.label.localeCompare(b.label)
  )[0]
  return { rank: rank < 0 ? 0 : rank, label: lead?.label ?? note.label, size: members.length }
}

/**
 * Notes whose text names this one but never links it — the cheapest links you
 * can add. Found by reusing the workspace search, minus everything that already
 * links here.
 */
function useUnlinkedMentions(
  analysis: GraphAnalysis | null,
  activePath: string | null,
  rootPath: string | null
): string[] {
  const [mentions, setMentions] = useState<{ key: string; paths: string[] }>({ key: '', paths: [] })
  const key = `${rootPath}|${activePath}`

  const scan = useCallback((): void => {
    if (!rootPath || !activePath || !analysis) return
    const linked = new Set(
      analysis.edges.filter((e) => e.to === activePath).map((e) => e.from)
    )
    void invoke('workspace:search', {
      rootPath,
      query: stem(activePath),
      regex: false,
      caseSensitive: false
    })
      .then((hits) => {
        const paths = [...new Set(hits.map((h) => h.path))].filter(
          (path) => path !== activePath && !linked.has(path)
        )
        setMentions({ key: `${rootPath}|${activePath}`, paths })
      })
      .catch(() => setMentions({ key: `${rootPath}|${activePath}`, paths: [] }))
  }, [rootPath, activePath, analysis])

  useEffect(() => scan(), [scan])
  return mentions.key === key ? mentions.paths : []
}

/**
 * Semantic link suggestions for the open note. Needs no model call — the main
 * process already holds the vectors and the graph — but returns nothing until
 * the vault has been indexed at least once.
 */
function useLinkSuggestions(activePath: string | null, rootPath: string | null): LinkSuggestion[] {
  const [state, setState] = useState<{ key: string; items: LinkSuggestion[] }>({
    key: '',
    items: []
  })
  const key = `${rootPath}|${activePath}`

  useEffect(() => {
    if (!rootPath || !activePath) return
    let stale = false
    void invoke('embeddings:suggestLinks', { rootPath, path: activePath, limit: MAX_SUGGESTIONS })
      .then((items) => !stale && setState({ key: `${rootPath}|${activePath}`, items }))
      .catch(() => !stale && setState({ key: `${rootPath}|${activePath}`, items: [] }))
    return () => {
      stale = true
    }
  }, [rootPath, activePath])

  return state.key === key ? state.items : []
}
