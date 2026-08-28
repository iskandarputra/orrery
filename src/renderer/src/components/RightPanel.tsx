import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { BacklinkHit } from '@shared/types'
import { getActiveView } from '@/editor/active-view'
import { invoke } from '@/services/client'
import { useEditorStats } from '@/state/editor-stats'
import { useStore } from '@/state/store'
import type { SidePanel } from '@/state/ui'
import { AiChatBody } from './AiChat'
import { BacklinksBody } from './BacklinksPanel'
import { NoteAnalysisBody } from './NoteAnalysisPanel'
import { TagsBody } from './TagsPanel'
import { Icon, type IconName } from './Icon'
import { EmptyState, ResultGroups } from './PanelBits'

interface HeadingItem {
  level: number
  text: string
  line: number
}

/** Headings of the active document (fence-aware). */
function collectHeadings(): HeadingItem[] {
  const view = getActiveView()
  if (!view) return []
  const items: HeadingItem[] = []
  let inFence = false
  for (let n = 1; n <= view.state.doc.lines; n++) {
    const text = view.state.doc.line(n).text
    if (/^\s*(```|~~~)/.test(text)) inFence = !inFence
    if (inFence) continue
    const m = text.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/)
    if (m) items.push({ level: m[1]!.length, text: m[2]!, line: n })
  }
  return items
}

function OutlineBody(): React.JSX.Element {
  const stats = useEditorStats()
  const activeId = useStore((s) => s.activeId)
  const [filter, setFilter] = useState('')
  // Re-collect headings when activeId or stats change as document edits occur
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const headings = useMemo(() => (activeId ? collectHeadings() : []), [activeId, stats])
  const minLevel = headings.length ? Math.min(...headings.map((h) => h.level)) : 1

  const filtered = useMemo(() => {
    if (!filter.trim()) return headings
    const q = filter.trim().toLowerCase()
    return headings.filter((h) => h.text.toLowerCase().includes(q))
  }, [headings, filter])

  const jump = (line: number): void => {
    const view = getActiveView()
    if (!view) return
    const pos = view.state.doc.line(line).from
    view.dispatch({ selection: { anchor: pos }, scrollIntoView: true })
    view.focus()
  }

  if (!activeId) return <EmptyState icon="list">Open a note to see its outline.</EmptyState>
  if (headings.length === 0)
    return (
      <EmptyState icon="list">No headings found. Add # Headings to create a table of contents.</EmptyState>
    )

  let activeLine = -1
  const caretLine = stats.line
  for (const h of headings) if (h.line <= caretLine) activeLine = h.line

  return (
    <div className="outline-container">
      <div className="outline-filter">
        <Icon name="search" size={12} className="outline-filter__icon" />
        <input
          type="text"
          className="outline-filter__input"
          placeholder="Filter headings…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && setFilter('')}
        />
        {filter && (
          <button
            className="outline-filter__clear"
            title="Clear filter (Esc)"
            aria-label="Clear filter"
            onClick={() => setFilter('')}
          >
            <Icon name="x" size={11} />
          </button>
        )}
      </div>

      <div className="outline-count-bar">
        <span>{filtered.length} of {headings.length} headings</span>
      </div>

      <div className="outline">
        {filtered.map((h) => (
          <button
            key={h.line}
            className={`outline__item outline__item--l${h.level - minLevel}${
              h.line === activeLine ? ' outline__item--active' : ''
            }`}
            style={{ paddingLeft: 8 + (h.level - minLevel) * 12 }}
            onClick={() => jump(h.line)}
            title={`Line ${h.line}`}
          >
            <span className="outline__level-badge">H{h.level}</span>
            <span className="outline__label">{h.text}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

function SearchBody(): React.JSX.Element {
  const rootPath = useStore((s) => s.rootPath)
  const openPaths = useStore((s) => s.openPaths)
  const seed = useStore((s) => s.searchSeed)
  const handledSeed = useRef(0)
  const [query, setQuery] = useState(seed.query)
  const [regex, setRegex] = useState(false)
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [hits, setHits] = useState<BacklinkHit[] | null>(null)
  const [searched, setSearched] = useState('')

  const run = useCallback(
    (term = query): void => {
      if (!rootPath || !term.trim()) return
      setSearched(term)
      void invoke('workspace:search', { rootPath, query: term, regex, caseSensitive })
        .then(setHits)
        .catch(() => setHits([]))
    },
    [rootPath, query, regex, caseSensitive]
  )

  // Arriving from "search the vault for this", run it without being asked.
  useEffect(() => {
    if (seed.token === handledSeed.current || !seed.query) return
    handledSeed.current = seed.token
    setQuery(seed.query)
    run(seed.query)
    // `run` is recreated on every query change; depending on it would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed])

  if (!rootPath) return <EmptyState icon="search">Open a folder to search across it.</EmptyState>

  const fileCount = new Set((hits ?? []).map((h) => h.path)).size

  return (
    <div className="gsearch">
      <div className="gsearch__bar">
        <Icon name="search" size={14} className="gsearch__icon" />
        <input
          className="gsearch__input"
          placeholder="Search vault…"
          value={query}
          autoFocus
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && run()}
        />
        <button
          className={`gsearch__opt${caseSensitive ? ' gsearch__opt--on' : ''}`}
          title="Match case (Alt+C)"
          onClick={() => setCaseSensitive((v) => !v)}
        >
          Aa
        </button>
        <button
          className={`gsearch__opt${regex ? ' gsearch__opt--on' : ''}`}
          title="Regular expression (Alt+R)"
          onClick={() => setRegex((v) => !v)}
        >
          .*
        </button>
      </div>
      {hits === null ? (
        <EmptyState icon="search">
          Press Enter to search entire workspace notes.
        </EmptyState>
      ) : hits.length === 0 ? (
        <EmptyState icon="search">No matches found for “{searched}”.</EmptyState>
      ) : (
        <>
          <div className="rpanel-count">
            <span className="rpanel-count__badge">{hits.length}</span> matches in {fileCount} note{fileCount === 1 ? '' : 's'}
          </div>
          <ResultGroups hits={hits} onOpen={(path) => void openPaths([path])} />
        </>
      )}
    </div>
  )
}

function DocStatsBody(): React.JSX.Element {
  const activeId = useStore((s) => s.activeId)
  const buffer = useStore((s) => (s.activeId ? s.buffers[s.activeId] : null))
  const stats = useEditorStats()

  if (!activeId || !buffer) {
    return <EmptyState icon="info">Open a note to see its metrics and statistics.</EmptyState>
  }

  const readingTimeMin = Math.max(1, Math.ceil(stats.words / 200))
  const speakingTimeMin = Math.max(1, Math.ceil(stats.words / 130))

  return (
    <div className="rpanel-stats">
      <div className="rpanel-stats__hero">
        <Icon name="file-text" size={24} className="rpanel-stats__hero-icon" />
        <h4 className="rpanel-stats__filename">{buffer.fileName}</h4>
        <span className="rpanel-stats__status">{buffer.isDirty ? '● Unsaved changes' : '✓ Saved'}</span>
      </div>

      <div className="rpanel-stats__grid">
        <div className="rpanel-stat-box">
          <span className="rpanel-stat-box__val">{stats.words.toLocaleString()}</span>
          <span className="rpanel-stat-box__lbl">Words</span>
        </div>
        <div className="rpanel-stat-box">
          <span className="rpanel-stat-box__val">{stats.characters.toLocaleString()}</span>
          <span className="rpanel-stat-box__lbl">Characters</span>
        </div>
        <div className="rpanel-stat-box">
          <span className="rpanel-stat-box__val">{stats.lines.toLocaleString()}</span>
          <span className="rpanel-stat-box__lbl">Lines</span>
        </div>
        <div className="rpanel-stat-box">
          <span className="rpanel-stat-box__val">~{readingTimeMin} min</span>
          <span className="rpanel-stat-box__lbl">Reading Time</span>
        </div>
        <div className="rpanel-stat-box">
          <span className="rpanel-stat-box__val">~{speakingTimeMin} min</span>
          <span className="rpanel-stat-box__lbl">Speaking Time</span>
        </div>
      </div>
    </div>
  )
}

const TABS: { id: SidePanel; label: string; icon: IconName }[] = [
  { id: 'outline', label: 'Outline', icon: 'list' },
  { id: 'backlinks', label: 'Links', icon: 'link' },
  { id: 'search', label: 'Search', icon: 'search' },
  { id: 'ai', label: 'AI', icon: 'sparkle' },
  { id: 'stats', label: 'Stats', icon: 'info' },
  { id: 'analysis', label: 'Analysis', icon: 'bar-chart' },
  { id: 'tags', label: 'Tags', icon: 'hash' }
]

export function RightPanel(): React.JSX.Element | null {
  const panel = useStore((s) => s.sidePanel)
  const toggle = useStore((s) => s.toggleSidePanel)
  const width = useStore((s) => s.settings.rightPanel.width)
  const setWidth = useStore((s) => s.setRightPanelWidth)
  const setSidePanel = useStore((s) => s.setSidePanel)
  const dragging = useRef(false)
  const activeTabRef = useRef<HTMLButtonElement>(null)

  // Keep the selected tab visible: it can be scrolled out of the row, and a
  // panel opened by a command or shortcut would otherwise show no active tab.
  useEffect(() => {
    activeTabRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [panel])

  // Which way the row can still travel, so the edge that has more tabs behind
  // it fades instead of simply ending — a hard cut reads as a clipped label
  // rather than as something to scroll.
  const tabsRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const row = tabsRef.current
    if (!row) return
    const update = (): void => {
      const more = row.scrollWidth - row.clientWidth
      const left = row.scrollLeft > 1
      const right = row.scrollLeft < more - 1
      row.dataset['overflow'] = left && right ? 'both' : left ? 'left' : right ? 'right' : 'none'
    }
    update()
    row.addEventListener('scroll', update, { passive: true })
    const observer = new ResizeObserver(update)
    observer.observe(row)
    return () => {
      row.removeEventListener('scroll', update)
      observer.disconnect()
    }
  }, [panel])

  const startResize = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault()
      dragging.current = true
      document.body.classList.add('is-resizing')
      const onMove = (e: MouseEvent): void => {
        if (dragging.current) setWidth(Math.min(720, Math.max(220, window.innerWidth - e.clientX)))
      }
      const onUp = (): void => {
        dragging.current = false
        document.body.classList.remove('is-resizing')
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [setWidth]
  )

  if (!panel) return null
  const active = TABS.find((t) => t.id === panel)

  return (
    <aside className="rpanel" style={{ width }}>
      <div className="rpanel__resizer" onMouseDown={startResize} />
      <div className="rpanel__tabs">
        {/* The tabs scroll on their own so the close button stays put: seven
            tabs do not fit a panel narrowed to its 220px minimum, and a row
            that scrolled as a whole would carry the close button off-screen. */}
        <div className="rpanel__tabs-scroll" role="tablist" ref={tabsRef}>
          {TABS.map((t) => (
            <button
              key={t.id}
              ref={panel === t.id ? activeTabRef : undefined}
              role="tab"
              aria-selected={panel === t.id}
              title={t.label}
              className={`rpanel__tab${panel === t.id ? ' rpanel__tab--active' : ''}`}
              onClick={() => setSidePanel(t.id)}
            >
              <Icon name={t.icon} size={14} />
              <span className="rpanel__tab-label">{t.label}</span>
            </button>
          ))}
        </div>
        <button className="icon-btn rpanel__close-btn" title="Close panel" onClick={() => toggle(panel)}>
          <Icon name="x" size={13} />
        </button>
      </div>
      <div className="rpanel__title-row">
        {active && <Icon name={active.icon} size={13} className="rpanel__title-icon" />}
        <span className="rpanel__title">{active?.label}</span>
      </div>
      <div className="rpanel__scroll">
        {panel === 'outline' && <OutlineBody />}
        {panel === 'backlinks' && <BacklinksBody />}
        {panel === 'search' && <SearchBody />}
        {panel === 'ai' && <AiChatBody />}
        {panel === 'stats' && <DocStatsBody />}
        {panel === 'analysis' && <NoteAnalysisBody />}
        {panel === 'tags' && <TagsBody />}
      </div>
    </aside>
  )
}
