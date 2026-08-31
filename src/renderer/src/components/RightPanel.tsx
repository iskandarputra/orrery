import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { BacklinkHit } from '@shared/types'
import { parseSearchQuery } from '@core/search-operators'
import { documentSymbols } from '@core/symbols'
import { surfaceForKind } from '@/plugins/registry'
import { getActiveView } from '@/editor/active-view'
import { invoke } from '@/services/client'
import { useEditorStats } from '@/state/editor-stats'
import { useStore } from '@/state/store'
import type { SidePanel } from '@/state/ui'
import { AiChatBody } from './AiChat'
import { BacklinksBody } from './BacklinksPanel'
import { BookmarksBody } from './BookmarksPanel'
import { McpBody } from './McpPanel'
import { OutgoingBody } from './OutgoingPanel'
import { NoteAnalysisBody } from './NoteAnalysisPanel'
import { TagsBody } from './TagsPanel'
import { Icon, type IconName } from './Icon'
import { EmptyState, ResultGroups } from './PanelBits'
import { SourceControlPanel } from './SourceControlPanel'

/**
 * The outline: headings in a note, declarations in a code file.
 *
 * Both come from the same reader. A code file has structure too, and the panel
 * used to answer a request for it by explaining that markdown headings were not
 * present, which is true and no help at all.
 */
function OutlineBody(): React.JSX.Element {
  const stats = useEditorStats()
  const activeId = useStore((s) => s.activeId)
  const fileName = useStore((s) => (s.activeId ? (s.buffers[s.activeId]?.fileName ?? '') : ''))
  const isCode = useStore((s) => (s.activeId ? s.buffers[s.activeId]?.kind === 'code' : false))
  // A board, a drawing or a table has no outline to read, and telling someone
  // to add "# Headings" to a spreadsheet is advice that would corrupt it.
  const surface = useStore((s) =>
    s.activeId ? surfaceForKind(s.buffers[s.activeId]?.kind ?? '') : null
  )
  const [filter, setFilter] = useState('')
  const symbols = useMemo(() => {
    const view = getActiveView()
    if (!activeId || !view) return []
    return documentSymbols(view.state.doc.toString(), fileName)
    // `stats` ticks on every edit and is the trigger rather than an input: the
    // document it stands for is read imperatively above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, fileName, stats])
  const minDepth = symbols.length ? Math.min(...symbols.map((s) => s.depth)) : 0

  const filtered = useMemo(() => {
    if (!filter.trim()) return symbols
    const q = filter.trim().toLowerCase()
    return symbols.filter((s) => s.name.toLowerCase().includes(q))
  }, [symbols, filter])

  const jump = (line: number): void => {
    const view = getActiveView()
    if (!view) return
    const pos = view.state.doc.line(line).from
    view.dispatch({ selection: { anchor: pos }, scrollIntoView: true })
    view.focus()
  }

  if (!activeId) return <EmptyState icon="list">Open a file to see its outline.</EmptyState>
  if (surface)
    return (
      <EmptyState icon="list">{`An outline is for text; this is a ${surface.label}.`}</EmptyState>
    )
  if (symbols.length === 0)
    return (
      <EmptyState icon="list">
        {isCode
          ? 'Nothing to outline: no functions, classes or types found in this file.'
          : 'No headings found. Add # Headings to create a table of contents.'}
      </EmptyState>
    )

  let activeLine = -1
  const caretLine = stats.line
  for (const s of symbols) if (s.line <= caretLine) activeLine = s.line

  return (
    <div className="outline-container">
      <div className="outline-filter">
        <Icon name="search" size={12} className="outline-filter__icon" />
        <input
          type="text"
          className="outline-filter__input"
          placeholder={isCode ? 'Filter symbols…' : 'Filter headings…'}
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
        <span>
          {filtered.length} of {symbols.length} {isCode ? 'symbols' : 'headings'}
        </span>
      </div>

      <div className="outline">
        {filtered.map((symbol) => (
          <button
            key={`${symbol.line}:${symbol.name}`}
            className={`outline__item outline__item--l${symbol.depth - minDepth}${
              symbol.line === activeLine ? ' outline__item--active' : ''
            }`}
            style={{ paddingLeft: 8 + (symbol.depth - minDepth) * 12 }}
            onClick={() => jump(symbol.line)}
            title={`Line ${symbol.line}`}
          >
            <span className="outline__level-badge">
              {symbol.kind === 'heading' ? `H${symbol.depth + 1}` : <Icon name="code" size={10} />}
            </span>
            <span className="outline__label">{symbol.name}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

function SearchBody(): React.JSX.Element {
  const rootPath = useStore((s) => s.rootPath)
  const openPaths = useStore((s) => s.openPaths)
  const openPdfAt = useStore((s) => s.openPdfAt)
  const seed = useStore((s) => s.searchSeed)
  const handledSeed = useRef(0)
  const [query, setQuery] = useState(seed.query)
  const [regex, setRegex] = useState(false)
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [wholeWord, setWholeWord] = useState(false)
  const [include, setInclude] = useState('')
  const [exclude, setExclude] = useState('')
  // The filters are collapsed until wanted, and stay open once a filter is set
  // — hiding a filter that is narrowing the results is how you get a search
  // that appears to be broken.
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [hits, setHits] = useState<BacklinkHit[] | null>(null)
  const [searched, setSearched] = useState('')

  const run = useCallback(
    (term = query): void => {
      if (!rootPath || !term.trim()) return
      setSearched(term)
      // Operators are translated in front of the search rather than taught to
      // it: there are two implementations, and neither has to learn anything.
      const parsed = parseSearchQuery(term, regex)
      // Typed filters add to the boxes rather than replacing them, so
      // `path:src` and an exclude set by hand both apply.
      const bothIncludes = [include, parsed.include].filter(Boolean).join(', ')
      const bothExcludes = [exclude, parsed.exclude].filter(Boolean).join(', ')
      if (!parsed.query && !bothIncludes && !bothExcludes) return

      void invoke('workspace:search', {
        rootPath,
        // A query of only filters means "show me what is in there", which is a
        // pattern matching every line rather than a search for empty text.
        query: parsed.query || '.',
        regex: parsed.query ? parsed.regex : true,
        caseSensitive,
        wholeWord: parsed.query ? wholeWord : false,
        include: bothIncludes,
        exclude: bothExcludes
      })
        .then(setHits)
        .catch(() => setHits([]))
    },
    [rootPath, query, regex, caseSensitive, wholeWord, include, exclude]
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
          placeholder="Search vault… (path: file: tag:)"
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
          className={`gsearch__opt${wholeWord ? ' gsearch__opt--on' : ''}`}
          title="Match whole word"
          aria-pressed={wholeWord}
          aria-label="Match whole word"
          onClick={() => setWholeWord((v) => !v)}
        >
          ab
        </button>
        <button
          className={`gsearch__opt${regex ? ' gsearch__opt--on' : ''}`}
          title="Regular expression (Alt+R)"
          aria-pressed={regex}
          aria-label="Use regular expression"
          onClick={() => setRegex((v) => !v)}
        >
          .*
        </button>
        <button
          className={`gsearch__opt${filtersOpen || include || exclude ? ' gsearch__opt--on' : ''}`}
          title="Files to include and exclude"
          aria-expanded={filtersOpen}
          aria-label="Toggle file filters"
          onClick={() => setFiltersOpen((v) => !v)}
        >
          <Icon name="filter" size={13} />
        </button>
      </div>

      {(filtersOpen || include || exclude) && (
        <div className="gsearch__filters">
          <label className="gsearch__filter">
            <span className="gsearch__filter-label">include</span>
            <input
              className="gsearch__filter-input"
              placeholder="*.md, src/**"
              value={include}
              onChange={(e) => setInclude(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && run()}
            />
          </label>
          <label className="gsearch__filter">
            <span className="gsearch__filter-label">exclude</span>
            <input
              className="gsearch__filter-input"
              placeholder="**/*.lock, dist"
              value={exclude}
              onChange={(e) => setExclude(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && run()}
            />
          </label>
        </div>
      )}
      {hits === null ? (
        <EmptyState icon="search">Press Enter to search every text file in the vault.</EmptyState>
      ) : hits.length === 0 ? (
        <EmptyState icon="search">No matches found for “{searched}”.</EmptyState>
      ) : (
        <>
          <div className="rpanel-count">
            <span className="rpanel-count__badge">{hits.length}</span> matches in {fileCount} file
            {fileCount === 1 ? '' : 's'}
          </div>
          <ResultGroups
            hits={hits}
            onOpen={(path, hit) => (hit?.page ? openPdfAt(path, hit.page) : void openPaths([path]))}
          />
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
        <span className="rpanel-stats__status">
          {buffer.isDirty ? '● Unsaved changes' : '✓ Saved'}
        </span>
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

/** The rail beside the panel, which the pointer's distance from the edge includes. */
const RAIL_WIDTH = 44

const TABS: { id: SidePanel; label: string; icon: IconName }[] = [
  { id: 'outline', label: 'Outline', icon: 'list' },
  { id: 'backlinks', label: 'Links', icon: 'link' },
  { id: 'outgoing', label: 'Outgoing', icon: 'external-link' },
  { id: 'bookmarks', label: 'Bookmarks', icon: 'bookmark' },
  { id: 'search', label: 'Search', icon: 'search' },
  { id: 'ai', label: 'AI', icon: 'sparkle' },
  { id: 'stats', label: 'Stats', icon: 'info' },
  { id: 'analysis', label: 'Analysis', icon: 'bar-chart' },
  { id: 'tags', label: 'Tags', icon: 'hash' },
  { id: 'git', label: 'Git', icon: 'git-branch' },
  { id: 'mcp', label: 'Tools', icon: 'zap' }
]

export function RightPanel(): React.JSX.Element {
  const panel = useStore((s) => s.sidePanel)
  const toggle = useStore((s) => s.toggleSidePanel)
  const width = useStore((s) => s.settings.rightPanel.width)
  const setWidth = useStore((s) => s.setRightPanelWidth)
  const dragging = useRef(false)
  const asideRef = useRef<HTMLElement>(null)

  /**
   * As the sidebar does it: the element's own width while dragging, the
   * setting once at the end. A width written per mouse move is a store update,
   * an IPC message and a disk write per pixel.
   */
  const startResize = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault()
      const el = asideRef.current
      if (!el) return
      dragging.current = true
      document.body.classList.add('is-resizing')
      const grip = event.clientX - el.getBoundingClientRect().left
      let latest = el.getBoundingClientRect().width

      const onMove = (e: MouseEvent): void => {
        if (!dragging.current) return
        latest = Math.min(720, Math.max(220, window.innerWidth - (e.clientX - grip) - RAIL_WIDTH))
        el.style.width = `${latest}px`
      }
      const onUp = (): void => {
        dragging.current = false
        document.body.classList.remove('is-resizing')
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
        setWidth(Math.round(latest))
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [setWidth]
  )

  const active = TABS.find((t) => t.id === panel)

  return (
    <>
      {panel && (
        <aside className="rpanel" ref={asideRef} style={{ width }}>
          <div className="rpanel__resizer" onMouseDown={startResize} />
          <div className="rpanel__title-row">
            {active && <Icon name={active.icon} size={13} className="rpanel__title-icon" />}
            <span className="rpanel__title">{active?.label}</span>
            <button
              className="icon-btn rpanel__close-btn"
              title="Close panel"
              aria-label="Close panel"
              onClick={() => toggle(panel)}
            >
              <Icon name="x" size={13} />
            </button>
          </div>
          <div className="rpanel__scroll">
            {panel === 'outline' && <OutlineBody />}
            {panel === 'backlinks' && <BacklinksBody />}
            {panel === 'outgoing' && <OutgoingBody />}
            {panel === 'bookmarks' && <BookmarksBody />}
            {panel === 'mcp' && <McpBody />}
            {panel === 'search' && <SearchBody />}
            {panel === 'ai' && <AiChatBody />}
            {panel === 'stats' && <DocStatsBody />}
            {panel === 'analysis' && <NoteAnalysisBody />}
            {panel === 'tags' && <TagsBody />}
            {panel === 'git' && <SourceControlPanel />}
          </div>
        </aside>
      )}

      {/* The rail outlives the panel it drives, the way an activity bar does:
          every view stays one click away instead of needing the panel reopened
          first to find out what is in it. Vertical because eight tabs have room
          to be a column and never had room to be a row — the old one scrolled
          sideways and hid half of itself at the panel's minimum width. */}
      <nav className="rpanel-rail" role="tablist" aria-label="Side panel">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={panel === t.id}
            aria-label={t.label}
            // As the left-hand rail does: drawn here, so it appears at once.
            data-tip={t.label}
            className={`rpanel__tab rail-tip${panel === t.id ? ' rpanel__tab--active' : ''}`}
            onClick={() => toggle(t.id)}
          >
            <Icon name={t.icon} size={17} />
          </button>
        ))}
      </nav>
    </>
  )
}
