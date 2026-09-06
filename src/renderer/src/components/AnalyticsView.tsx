import { useEffect, useMemo } from 'react'
import type { AnalyzedGraphNode, GraphAnalysis, RankedNote } from '@shared/types'
import { useStore } from '@/state/store'
import { Icon } from './Icon'

/** Palette slots available for cluster colour — matches the graph overlay. */
const VIZ_SLOTS = 8
/** Longest link-count bucket worth plotting; the tail folds into the last bar. */
const HISTOGRAM_CAP = 10

function formatNumber(value: number): string {
  return value.toLocaleString()
}

/** 0.0731 → "7.3%" — PageRank as a readable share of vault influence. */
function formatShare(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}

/**
 * Vault analytics: what the link graph says about the shape of the vault, and
 * what to do about it. Reads the shared analysis cache, so opening this after
 * the graph costs nothing.
 */
export function AnalyticsView(): React.JSX.Element | null {
  const open = useStore((s) => s.analyticsOpen)
  const close = useStore((s) => s.toggleAnalytics)
  const rootPath = useStore((s) => s.rootPath)
  const analysis = useStore((s) => s.graph)
  const loading = useStore((s) => s.graphLoading)
  const error = useStore((s) => s.graphError)
  const loadGraph = useStore((s) => s.loadGraph)
  const openPaths = useStore((s) => s.openPaths)

  useEffect(() => {
    if (open && rootPath) void loadGraph()
  }, [open, rootPath, loadGraph])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, close])

  if (!open) return null

  const openNote = (note: RankedNote): void => {
    if (!note.exists) return // no file behind it yet
    void openPaths([note.id])
    close()
  }

  return (
    <div className="modal-backdrop">
      <div className="graph analytics" role="dialog" aria-label="Vault Analytics">
        <div className="graph__header">
          <div className="graph__title-group">
            <Icon name="bar-chart" size={16} />
            <span className="graph__title">Vault Analytics</span>
            {analysis && (
              <span className="graph__status-pill">
                {formatNumber(analysis.stats.notes)} notes · {formatNumber(analysis.stats.links)}{' '}
                links
              </span>
            )}
          </div>
          <div className="graph__header-controls">
            <button
              className="icon-btn"
              title="Rescan vault"
              aria-label="Rescan vault"
              onClick={() => void loadGraph(true)}
            >
              <Icon name="refresh" size={14} />
            </button>
            <button className="icon-btn" aria-label="Close analytics" onClick={close}>
              <Icon name="x" size={15} />
            </button>
          </div>
        </div>

        {!rootPath ? (
          <p className="rpanel-empty">Open a folder to analyse its knowledge graph.</p>
        ) : error ? (
          <p className="rpanel-empty">Could not read the vault: {error}</p>
        ) : !analysis ? (
          <p className="rpanel-empty">{loading ? 'Analysing vault…' : 'No analysis yet.'}</p>
        ) : (
          <AnalyticsBody analysis={analysis} onOpen={openNote} />
        )}
      </div>
    </div>
  )
}

function AnalyticsBody({
  analysis,
  onOpen
}: {
  analysis: GraphAnalysis
  onOpen: (note: RankedNote) => void
}): React.JSX.Element {
  const { stats, insights, nodes } = analysis

  const clusters = useMemo(() => summariseClusters(nodes), [nodes])
  const histogram = useMemo(() => foldHistogram(stats.linkHistogram), [stats.linkHistogram])
  const isolated = stats.components - 1
  // NoteList's row format only sees the RankedNote shape it maps brokenLinks
  // into, which drops `kind`; look it back up by id rather than widening that
  // shared shape for one list.
  const brokenLinkKind = useMemo(
    () => new Map(insights.brokenLinks.map((b) => [b.id, b.kind])),
    [insights.brokenLinks]
  )

  return (
    <div className="analytics__body">
      <section className="analytics__tiles">
        <Tile value={formatNumber(stats.notes)} label="Notes" />
        <Tile value={formatNumber(stats.links)} label="Links" />
        <Tile value={formatNumber(stats.words)} label="Words" />
        <Tile value={stats.avgOutDegree.toFixed(1)} label="Links per note" />
        <Tile value={formatNumber(stats.modified.last7)} label="Touched this week" />
        <Tile
          value={`${Math.round(stats.largestComponentShare * 100)}%`}
          label="In the main island"
        />
      </section>

      <div className="analytics__columns">
        <section className="analytics__card">
          <h3 className="analytics__card-title">
            <Icon name="alert-triangle" size={13} /> Needs attention
          </h3>
          <NoteList
            heading="Orphans"
            hint="No links in or out — nothing will lead you back here."
            notes={insights.orphans}
            empty="No orphaned notes."
            format={(n) => `${formatNumber(n.score)} words`}
            onOpen={onOpen}
          />
          <NoteList
            heading="Dead ends"
            hint="Linked from elsewhere, but they link nowhere."
            notes={insights.deadEnds}
            empty="Every linked note links onward."
            format={(n) => `${n.score} in`}
            onOpen={onOpen}
          />
          <NoteList
            heading="Broken links"
            hint="A wikilink to a note nobody's written, or an import to a path that's gone."
            notes={insights.brokenLinks.map((b) => ({
              id: b.id,
              label: b.label,
              score: b.from.length,
              exists: false
            }))}
            empty="No broken links."
            format={(n) => {
              const kind = brokenLinkKind.get(n.id)
              const why = kind === 'import' ? 'path not found' : 'not written yet'
              return `${n.score} ref${n.score === 1 ? '' : 's'} · ${why}`
            }}
            onOpen={onOpen}
          />
          {isolated > 0 && (
            <p className="analytics__note">
              {isolated} disconnected island{isolated === 1 ? ' sits' : 's sit'} outside the main
              graph.
            </p>
          )}
        </section>

        <section className="analytics__card">
          <h3 className="analytics__card-title">
            <Icon name="git-branch" size={13} /> Most connected
          </h3>
          <NoteList
            heading="Hubs"
            hint="Highest share of vault influence (PageRank)."
            notes={insights.hubs}
            empty="No links yet."
            format={(n) => formatShare(n.score)}
            bars
            onOpen={onOpen}
          />
          <NoteList
            heading="Bridges"
            hint="Remove one and parts of the vault stop connecting."
            notes={insights.connectors}
            empty="No bridging notes."
            format={(n) => n.score.toFixed(2)}
            bars
            onOpen={onOpen}
          />
        </section>
      </div>

      <div className="analytics__columns">
        <section className="analytics__card">
          <h3 className="analytics__card-title">
            <Icon name="bar-chart" size={13} /> Links per note
          </h3>
          <p className="analytics__hint">How many notes have how many outgoing links.</p>
          <Histogram buckets={histogram} total={stats.notes} />
        </section>

        <section className="analytics__card">
          <h3 className="analytics__card-title">
            <Icon name="layers" size={13} /> Topic clusters
          </h3>
          <p className="analytics__hint">
            Groups the link structure falls into — the same colours the graph uses.
          </p>
          <ul className="analytics__clusters">
            {clusters.map((cluster) => (
              <li key={cluster.rank} className="analytics__cluster">
                <span
                  className="analytics__swatch"
                  style={{
                    background:
                      cluster.rank < VIZ_SLOTS
                        ? `var(--or-viz-${cluster.rank + 1})`
                        : 'var(--or-fg-faint)'
                  }}
                />
                <span className="analytics__cluster-label">{cluster.label}</span>
                <span className="analytics__cluster-count">
                  {cluster.size} note{cluster.size === 1 ? '' : 's'}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  )
}

function Tile({ value, label }: { value: string; label: string }): React.JSX.Element {
  return (
    <div className="analytics__tile">
      <span className="analytics__tile-value">{value}</span>
      <span className="analytics__tile-label">{label}</span>
    </div>
  )
}

function NoteList({
  heading,
  hint,
  notes,
  empty,
  format,
  bars = false,
  onOpen
}: {
  heading: string
  hint: string
  notes: RankedNote[]
  empty: string
  format: (note: RankedNote) => string
  bars?: boolean
  onOpen: (note: RankedNote) => void
}): React.JSX.Element {
  const peak = Math.max(...notes.map((n) => n.score), 0)
  return (
    <div className="analytics__list">
      <h4 className="analytics__list-title">
        {heading}
        <span className="analytics__list-count">{notes.length}</span>
      </h4>
      <p className="analytics__hint">{hint}</p>
      {notes.length === 0 ? (
        <p className="analytics__empty">{empty}</p>
      ) : (
        <ul>
          {notes.map((note) => (
            <li key={note.id}>
              <button
                className="analytics__row"
                onClick={() => onOpen(note)}
                title={note.exists ? note.id : 'This note does not exist yet'}
              >
                {bars && (
                  <span
                    className="analytics__row-bar"
                    style={{ width: `${peak > 0 ? (note.score / peak) * 100 : 0}%` }}
                  />
                )}
                <span className="analytics__row-label">{note.label}</span>
                <span className="analytics__row-value">{format(note)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

interface Bucket {
  /** Out-link count this bar stands for; `capped` marks the "or more" bar. */
  links: number
  notes: number
  capped: boolean
}

function Histogram({ buckets, total }: { buckets: Bucket[]; total: number }): React.JSX.Element {
  const peak = Math.max(...buckets.map((b) => b.notes), 1)
  return (
    <div
      className="analytics__hist"
      role="img"
      aria-label="Distribution of outgoing links per note"
    >
      {buckets.map((bucket) => {
        const share = total > 0 ? Math.round((bucket.notes / total) * 100) : 0
        const label = bucket.capped ? `${bucket.links}+` : String(bucket.links)
        return (
          <div
            key={bucket.links}
            className="analytics__hist-col"
            title={`${bucket.notes} note${bucket.notes === 1 ? '' : 's'} with ${label} link${bucket.links === 1 && !bucket.capped ? '' : 's'} · ${share}%`}
          >
            <span className="analytics__hist-value">{bucket.notes || ''}</span>
            <span
              className={`analytics__hist-bar${bucket.notes === 0 ? ' analytics__hist-bar--empty' : ''}`}
              style={{ height: `${(bucket.notes / peak) * 100}%` }}
            />
            <span className="analytics__hist-label">{label}</span>
          </div>
        )
      })}
    </div>
  )
}

/** Everything past the cap becomes one "10+" bar so the axis stays readable. */
function foldHistogram(histogram: number[]): Bucket[] {
  const buckets: Bucket[] = []
  for (let links = 0; links < Math.min(histogram.length, HISTOGRAM_CAP); links++) {
    buckets.push({ links, notes: histogram[links] ?? 0, capped: false })
  }
  const tail = histogram.slice(HISTOGRAM_CAP).reduce((sum, count) => sum + (count ?? 0), 0)
  if (tail > 0) buckets.push({ links: HISTOGRAM_CAP, notes: tail, capped: true })
  return buckets
}

interface ClusterSummary {
  /** Palette slot — biggest cluster first, matching the graph overlay. */
  rank: number
  label: string
  size: number
}

/** Name each cluster after its most-linked member, the way you'd describe it. */
function summariseClusters(nodes: AnalyzedGraphNode[]): ClusterSummary[] {
  const groups = new Map<number, AnalyzedGraphNode[]>()
  for (const node of nodes) {
    const group = groups.get(node.community)
    if (group) group.push(node)
    else groups.set(node.community, [node])
  }
  return [...groups.values()]
    .sort(
      (a, b) =>
        b.length - a.length || String(a[0]?.community).localeCompare(String(b[0]?.community))
    )
    .slice(0, VIZ_SLOTS + 2)
    .map((members, rank) => {
      const lead = [...members].sort(
        (a, b) => b.pagerank - a.pagerank || a.label.localeCompare(b.label)
      )[0]
      return { rank, label: lead?.label ?? 'Cluster', size: members.length }
    })
}
