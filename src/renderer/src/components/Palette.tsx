import { useEffect, useMemo, useRef, useState } from 'react'
import { fuzzyFilter } from '@core/fuzzy'
import { buildNoteIndex } from '@core/notes'
import { insertTemplate } from '@/notes/daily'
import { invoke } from '@/services/client'
import { getRegistry } from '@/bootstrap'
import { useStore } from '@/state/store'
import type { PaletteMode } from '@/state/ui'
import { Icon, type IconName } from './Icon'

interface Entry {
  id: string
  label: string
  detail: string
  icon: IconName
  badge?: string
  run(): void
}

/** Quick switcher (Ctrl+P) and command palette (Ctrl+Shift+P) in one. */
export function Palette(): React.JSX.Element | null {
  const mode = useStore((s) => s.paletteMode)
  if (!mode) return null
  return <PaletteInner key={mode} initialMode={mode} />
}

function PaletteInner({ initialMode }: { initialMode: PaletteMode }): React.JSX.Element {
  const close = useStore((s) => s.closePalette)
  const noteIndex = useStore((s) => s.noteIndex)
  const openPaths = useStore((s) => s.openPaths)
  const settings = useStore((s) => s.settings)
  const picking = initialMode === 'templates'
  const [activeTab, setActiveTab] = useState<'all' | 'files' | 'commands'>(
    initialMode === 'files' ? 'files' : 'commands'
  )
  const templates = useTemplateFiles(picking)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const entries = useMemo<Entry[]>(() => {
    const list: Entry[] = []

    if (picking) {
      templates.forEach((t) => {
        list.push({
          id: `tpl:${t.path}`,
          label: t.stem,
          detail: t.path,
          icon: 'copy',
          run: () => void insertTemplate(t.path)
        })
      })
      return list
    }

    if (activeTab === 'all' || activeTab === 'files') {
      noteIndex.forEach((n) => {
        list.push({
          id: `file:${n.path}`,
          label: n.stem,
          detail: n.path,
          icon: 'file-text',
          run: () => void openPaths([n.path])
        })
      })
    }

    if (activeTab === 'all' || activeTab === 'commands') {
      const registry = getRegistry()
      const kb = settings.keybindings
      ;(registry?.getAll() ?? []).forEach((c) => {
        list.push({
          id: `cmd:${c.id}`,
          label: c.title,
          detail: c.id,
          icon: 'keyboard',
          badge: kb[c.id],
          run: () => registry?.execute(c.id)
        })
      })
    }

    return list
  }, [picking, templates, activeTab, noteIndex, openPaths, settings.keybindings])

  const results = useMemo(() => fuzzyFilter(query, entries, (e) => e.label), [query, entries])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    listRef.current?.querySelector('.palette__item--active')?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  const pick = (entry: Entry | undefined): void => {
    if (!entry) return
    close()
    entry.run()
  }

  return (
    <div
      className="modal-backdrop modal-backdrop--top"
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <div className="palette" role="dialog" aria-label="Quick Switcher & Command Palette">
        <div className="palette__bar">
          <Icon
            name={activeTab === 'commands' ? 'keyboard' : 'search'}
            size={16}
            className="palette__icon"
          />
          <input
            ref={inputRef}
            className="palette__input"
            placeholder={
              picking
                ? 'Insert a template…'
                : activeTab === 'files'
                ? 'Open note by name…'
                : activeTab === 'commands'
                  ? 'Run a command…'
                  : 'Search notes and commands…'
            }
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setSelected(0)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') close()
              else if (e.key === 'ArrowDown') {
                e.preventDefault()
                setSelected((s) => Math.min(s + 1, Math.max(0, results.length - 1)))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setSelected((s) => Math.max(s - 1, 0))
              } else if (e.key === 'Enter') {
                pick(results[selected])
              } else if (e.key === 'Tab' && !picking) {
                e.preventDefault()
                setActiveTab((t) => (t === 'files' ? 'commands' : t === 'commands' ? 'all' : 'files'))
                setSelected(0)
              }
            }}
          />
          <div className="palette__tabs" hidden={picking}>
            <button
              className={`palette__tab${activeTab === 'files' ? ' palette__tab--active' : ''}`}
              onClick={() => {
                setActiveTab('files')
                setSelected(0)
              }}
            >
              Notes
            </button>
            <button
              className={`palette__tab${activeTab === 'commands' ? ' palette__tab--active' : ''}`}
              onClick={() => {
                setActiveTab('commands')
                setSelected(0)
              }}
            >
              Commands
            </button>
            <button
              className={`palette__tab${activeTab === 'all' ? ' palette__tab--active' : ''}`}
              onClick={() => {
                setActiveTab('all')
                setSelected(0)
              }}
            >
              All
            </button>
          </div>
          <kbd className="palette__esc">esc</kbd>
        </div>

        <div className="palette__list" ref={listRef}>
          {results.length === 0 ? (
            <div className="palette__empty">
              <Icon name="search" size={24} className="palette__empty-icon" />
              <p>No matching notes or commands found.</p>
            </div>
          ) : (
            results.map((entry, i) => (
              <button
                key={entry.id}
                className={`palette__item${i === selected ? ' palette__item--active' : ''}`}
                onMouseEnter={() => setSelected(i)}
                onClick={() => pick(entry)}
              >
                <Icon name={entry.icon} size={15} className="palette__item-icon" />
                <span className="palette__label">{entry.label}</span>
                <span className="palette__detail">{entry.detail}</span>
                {entry.badge && <kbd className="palette__badge">{entry.badge}</kbd>}
              </button>
            ))
          )}
        </div>

        <div className="palette__footer">
          <span className="palette__hint">
            <kbd>↑</kbd> <kbd>↓</kbd> navigate
          </span>
          <span className="palette__hint">
            <kbd>↵</kbd> select
          </span>
          <span className="palette__hint">
            <kbd>Tab</kbd> switch tab
          </span>
          <span className="palette__hint">
            <kbd>Esc</kbd> close
          </span>
        </div>
      </div>
    </div>
  )
}

/** Template notes from the configured folder, loaded when the picker opens. */
function useTemplateFiles(active: boolean): { path: string; stem: string }[] {
  const rootPath = useStore((s) => s.rootPath)
  const folder = useStore((s) => s.settings.templates.folder)
  const [files, setFiles] = useState<{ path: string; stem: string }[]>([])

  useEffect(() => {
    if (!active || !rootPath) return
    let stale = false
    const dir = [rootPath, folder].filter((part) => part.trim() !== '').join('/')
    void invoke('fs:readTree', { path: dir })
      .then((tree) => !stale && setFiles(buildNoteIndex(tree)))
      .catch(() => !stale && setFiles([]))
    return () => {
      stale = true
    }
  }, [active, rootPath, folder])

  return files
}
