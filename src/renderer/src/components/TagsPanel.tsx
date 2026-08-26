import { useEffect, useMemo, useState } from 'react'
import { useStore } from '@/state/store'
import { EmptyState } from './PanelBits'

/**
 * Every tag in the vault, most used first. Built from the cached graph
 * analysis — the scan already reads each note, so tags cost nothing extra —
 * and clicking one searches the vault for it.
 */
export function TagsBody(): React.JSX.Element {
  const rootPath = useStore((s) => s.rootPath)
  const analysis = useStore((s) => s.graph)
  const loading = useStore((s) => s.graphLoading)
  const loadGraph = useStore((s) => s.loadGraph)
  const searchVaultFor = useStore((s) => s.searchVaultFor)
  const [filter, setFilter] = useState('')

  useEffect(() => {
    if (rootPath) void loadGraph()
  }, [rootPath, loadGraph])

  const tags = useMemo(() => {
    const counts = new Map<string, number>()
    for (const node of analysis?.nodes ?? []) {
      for (const tag of node.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
    }
    return [...counts.entries()]
      .map(([tag, notes]) => ({ tag, notes }))
      .sort((a, b) => b.notes - a.notes || a.tag.localeCompare(b.tag))
  }, [analysis])

  const shown = tags.filter((t) => t.tag.toLowerCase().includes(filter.trim().toLowerCase()))

  if (!rootPath) return <EmptyState icon="hash">Open a folder to see its tags.</EmptyState>
  if (!analysis) {
    return <EmptyState icon="hash">{loading ? 'Reading the vault…' : 'No tags yet.'}</EmptyState>
  }
  if (tags.length === 0) {
    return (
      <EmptyState icon="hash">
        No tags yet. Write <code>#like-this</code> in a note.
      </EmptyState>
    )
  }

  return (
    <div className="tags-panel">
      <input
        className="tags-panel__filter"
        placeholder="Filter tags…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      <div className="rpanel-count">
        {tags.length} tag{tags.length === 1 ? '' : 's'}
      </div>
      <ul className="tags-panel__list">
        {shown.map(({ tag, notes }) => (
          <li key={tag}>
            <button className="tags-panel__tag" onClick={() => searchVaultFor(`#${tag}`)}>
              <span className="tags-panel__name">#{tag}</span>
              <span className="tags-panel__count">{notes}</span>
            </button>
          </li>
        ))}
        {shown.length === 0 && <li className="analytics__empty">No tag matches “{filter}”.</li>}
      </ul>
    </div>
  )
}
