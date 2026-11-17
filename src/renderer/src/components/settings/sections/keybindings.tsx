import { useState, useMemo } from 'react'
import { DEFAULT_SHORTCUTS } from '@shared/keybindings'
import { builtinCommands } from '@/commands/builtins'
import { useStore } from '@/state/store'
import { Icon } from '../../Icon'

/**
 * Every command that ships with a key, named by its own title.
 *
 * Built from the table the menu is built from. This page used to keep a list
 * of its own, 24 of the 38 keys, and the two disagreed.
 */
const BINDABLE: { id: string; label: string; dflt: string }[] = Object.entries(
  DEFAULT_SHORTCUTS
).map(([id, dflt]) => ({
  id,
  label: builtinCommands.find((c) => c.id === id)?.title ?? id,
  dflt
}))

export function KeybindingsSection(): React.JSX.Element {
  const settings = useStore((s) => s.settings)
  const update = useStore((s) => s.updateSettings)
  const kb = settings.keybindings
  const [filter, setFilter] = useState('')

  const setBinding = (id: string, dflt: string, value: string): void => {
    const next = { ...kb }
    if (!value.trim() || value.trim() === dflt) delete next[id]
    else next[id] = value.trim()
    update({ keybindings: next })
  }

  const filtered = useMemo(() => {
    if (!filter.trim()) return BINDABLE
    const q = filter.trim().toLowerCase()
    return BINDABLE.filter(
      (b) => b.label.toLowerCase().includes(q) || b.id.toLowerCase().includes(q)
    )
  }, [filter])

  return (
    <>
      <div className="kb-header-row">
        <h3 className="set-group" style={{ margin: 0 }}>
          Shortcuts
        </h3>
        <div className="theme-filter-input-wrap">
          <Icon name="search" size={12} />
          <input
            type="text"
            placeholder="Filter shortcuts…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
      </div>
      <p className="set-note">
        Electron accelerator format (e.g. <code>CmdOrCtrl+Shift+X</code>). Clear a field to restore
        the default. Applied immediately.
      </p>
      <div className="kb-table">
        {filtered.map((b) => (
          <div className="kb-row" key={b.id}>
            <span className="kb-action">{b.label}</span>
            <input
              className="kb-input"
              defaultValue={kb[b.id] ?? b.dflt}
              placeholder={b.dflt}
              onBlur={(e) => setBinding(b.id, b.dflt, e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            />
          </div>
        ))}
      </div>
    </>
  )
}
