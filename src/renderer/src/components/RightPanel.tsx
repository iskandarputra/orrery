import { useCallback, useMemo, useRef, useState } from 'react'
import type { BacklinkHit } from '@shared/types'
import { getActiveView } from '@/editor/active-view'
import { invoke } from '@/services/client'
import { useEditorStats } from '@/state/editor-stats'
import { useStore } from '@/state/store'
import { AiChatBody } from './AiChat'
import { BacklinksBody } from './BacklinksPanel'
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
  const stats = useEditorStats() // re-render as the doc/caret changes
  const activeId = useStore((s) => s.activeId)
  const headings = useMemo(() => (activeId ? collectHeadings() : []), [activeId, stats])
  const minLevel = headings.length ? Math.min(...headings.map((h) => h.level)) : 1

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
      <EmptyState icon="list">No headings yet. Add a # heading to build an outline.</EmptyState>
    )

  // Which heading holds the caret? (last heading at or before the cursor line)
  let activeLine = -1
  const caretLine = stats.line
  for (const h of headings) if (h.line <= caretLine) activeLine = h.line

  return (
    <div className="outline">
      {headings.map((h) => (
        <button
          key={h.line}
          className={`outline__item outline__item--l${h.level - minLevel}${
            h.line === activeLine ? ' outline__item--active' : ''
          }`}
          style={{ paddingLeft: 12 + (h.level - minLevel) * 14 }}
          onClick={() => jump(h.line)}
          title={`Line ${h.line}`}
        >
          <span className="outline__dot" />
          <span className="outline__label">{h.text}</span>
        </button>
      ))}
    </div>
  )
}

function SearchBody(): React.JSX.Element {
  const rootPath = useStore((s) => s.rootPath)
  const openPaths = useStore((s) => s.openPaths)
  const [query, setQuery] = useState('')
  const [regex, setRegex] = useState(false)
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [hits, setHits] = useState<BacklinkHit[] | null>(null)
  const [searched, setSearched] = useState('')

  const run = useCallback((): void => {
    if (!rootPath || !query.trim()) return
    setSearched(query)
    void invoke('workspace:search', { rootPath, query, regex, caseSensitive })
      .then(setHits)
      .catch(() => setHits([]))
  }, [rootPath, query, regex, caseSensitive])

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
          title="Match case"
          onClick={() => setCaseSensitive((v) => !v)}
        >
          Aa
        </button>
        <button
          className={`gsearch__opt${regex ? ' gsearch__opt--on' : ''}`}
          title="Regular expression"
          onClick={() => setRegex((v) => !v)}
        >
          .*
        </button>
      </div>
      {hits === null ? (
        <EmptyState icon="search">
          Press Enter to search. Supports regex and case toggle.
        </EmptyState>
      ) : hits.length === 0 ? (
        <EmptyState icon="search">No matches for “{searched}”.</EmptyState>
      ) : (
        <>
          <div className="rpanel-count">
            {hits.length} match{hits.length === 1 ? '' : 'es'} in {fileCount} file
            {fileCount === 1 ? '' : 's'}
          </div>
          <ResultGroups hits={hits} onOpen={(path) => void openPaths([path])} />
        </>
      )}
    </div>
  )
}

const TABS: { id: 'outline' | 'backlinks' | 'search' | 'ai'; label: string; icon: IconName }[] = [
  { id: 'outline', label: 'Outline', icon: 'list' },
  { id: 'backlinks', label: 'Links', icon: 'link' },
  { id: 'search', label: 'Search', icon: 'search' },
  { id: 'ai', label: 'AI', icon: 'sparkle' }
]

export function RightPanel(): React.JSX.Element | null {
  const panel = useStore((s) => s.sidePanel)
  const toggle = useStore((s) => s.toggleSidePanel)
  const width = useStore((s) => s.settings.rightPanel.width)
  const setWidth = useStore((s) => s.setRightPanelWidth)
  const dragging = useRef(false)

  const startResize = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault()
      dragging.current = true
      document.body.classList.add('is-resizing')
      const onMove = (e: MouseEvent): void => {
        // Panel is docked right — dragging its left edge left widens it.
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
      <div className="rpanel__tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={panel === t.id}
            title={t.label}
            className={`rpanel__tab${panel === t.id ? ' rpanel__tab--active' : ''}`}
            onClick={() => useStore.setState({ sidePanel: t.id })}
          >
            <Icon name={t.icon} size={15} />
            <span className="rpanel__tab-label">{t.label}</span>
          </button>
        ))}
        <span className="rpanel__tabs-spacer" />
        <button className="icon-btn" title="Close panel" onClick={() => toggle(panel)}>
          <Icon name="x" size={14} />
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
      </div>
    </aside>
  )
}
