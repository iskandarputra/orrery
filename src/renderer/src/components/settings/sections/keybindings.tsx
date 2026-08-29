import { useState, useMemo } from 'react'
import { useStore } from '@/state/store'
import { Icon } from '../../Icon'

const BINDABLE: { id: string; label: string; dflt: string }[] = [
  { id: 'file.new', label: 'New file', dflt: 'CmdOrCtrl+N' },
  { id: 'app.quickOpen', label: 'Quick open note', dflt: 'CmdOrCtrl+P' },
  { id: 'app.commandPalette', label: 'Command palette', dflt: 'CmdOrCtrl+Shift+P' },
  { id: 'file.open', label: 'Open file', dflt: 'CmdOrCtrl+O' },
  { id: 'workspace.openFolder', label: 'Open folder', dflt: 'CmdOrCtrl+Shift+O' },
  { id: 'file.save', label: 'Save', dflt: 'CmdOrCtrl+S' },
  { id: 'file.saveAs', label: 'Save as', dflt: 'CmdOrCtrl+Shift+S' },
  { id: 'tab.close', label: 'Close tab', dflt: 'CmdOrCtrl+W' },
  { id: 'app.openSettings', label: 'Preferences', dflt: 'CmdOrCtrl+,' },
  { id: 'find.open', label: 'Find', dflt: 'CmdOrCtrl+F' },
  { id: 'find.replace', label: 'Replace', dflt: 'CmdOrCtrl+H' },
  { id: 'format.highlight', label: 'Highlight selection', dflt: 'CmdOrCtrl+Shift+H' },
  { id: 'note.extractSelection', label: 'Extract to note', dflt: 'CmdOrCtrl+Alt+N' },
  { id: 'view.toggleSidebar', label: 'Toggle sidebar', dflt: 'CmdOrCtrl+B' },
  { id: 'view.toggleTerminal', label: 'Toggle terminal', dflt: 'CmdOrCtrl+`' },
  { id: 'view.toggleBacklinks', label: 'Backlinks panel', dflt: 'CmdOrCtrl+Shift+B' },
  { id: 'view.toggleOutline', label: 'Outline panel', dflt: 'CmdOrCtrl+Shift+U' },
  { id: 'view.toggleSearch', label: 'Workspace search', dflt: 'CmdOrCtrl+Shift+F' },
  { id: 'ai.openChat', label: 'AI chat', dflt: 'CmdOrCtrl+Shift+A' },
  { id: 'view.toggleGraph', label: 'Graph view', dflt: 'CmdOrCtrl+Shift+G' }
]

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
