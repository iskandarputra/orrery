import { useEffect, useMemo, useRef, useState } from 'react'
import { fuzzyFilter } from '@core/fuzzy'
import { getRegistry } from '@/bootstrap'
import { useStore } from '@/state/store'
import { Icon } from './Icon'

interface Entry {
  id: string
  label: string
  detail: string
  run(): void
}

/** Quick switcher (Ctrl+P) and command palette (Ctrl+Shift+P) in one. */
export function Palette(): React.JSX.Element | null {
  const mode = useStore((s) => s.paletteMode)
  if (!mode) return null
  // Keyed remount gives fresh query/selection state per open — no reset effects.
  return <PaletteInner key={mode} mode={mode} />
}

function PaletteInner({ mode }: { mode: 'files' | 'commands' }): React.JSX.Element {
  const close = useStore((s) => s.closePalette)
  const noteIndex = useStore((s) => s.noteIndex)
  const openPaths = useStore((s) => s.openPaths)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const entries = useMemo<Entry[]>(() => {
    if (mode === 'files') {
      return noteIndex.map((n) => ({
        id: n.path,
        label: n.stem,
        detail: n.path,
        run: () => void openPaths([n.path])
      }))
    }
    if (mode === 'commands') {
      const registry = getRegistry()
      return (registry?.getAll() ?? []).map((c) => ({
        id: c.id,
        label: c.title,
        detail: c.id,
        run: () => registry?.execute(c.id)
      }))
    }
    return []
  }, [mode, noteIndex, openPaths])

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
      <div className="palette" role="dialog" aria-label="Palette">
        <div className="palette__bar">
          <Icon
            name={mode === 'files' ? 'search' : 'keyboard'}
            size={15}
            className="palette__icon"
          />
          <input
            ref={inputRef}
            className="palette__input"
            placeholder={mode === 'files' ? 'Open note by name…' : 'Run a command…'}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setSelected(0)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') close()
              else if (e.key === 'ArrowDown') {
                e.preventDefault()
                setSelected((s) => Math.min(s + 1, results.length - 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setSelected((s) => Math.max(s - 1, 0))
              } else if (e.key === 'Enter') {
                pick(results[selected])
              }
            }}
          />
          <kbd>esc</kbd>
        </div>
        <div className="palette__list" ref={listRef}>
          {results.length === 0 ? (
            <p className="rpanel-empty">No matches.</p>
          ) : (
            results.map((entry, i) => (
              <button
                key={entry.id}
                className={`palette__item${i === selected ? ' palette__item--active' : ''}`}
                onMouseEnter={() => setSelected(i)}
                onClick={() => pick(entry)}
              >
                <span className="palette__label">{entry.label}</span>
                <span className="palette__detail">{entry.detail}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
