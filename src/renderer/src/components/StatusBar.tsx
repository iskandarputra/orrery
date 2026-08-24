import type { Settings } from '@shared/settings'
import { useEditorStats } from '@/state/editor-stats'
import { useStore } from '@/state/store'
import { Icon, type IconName } from './Icon'

const MODE_ICON: Record<string, IconName> = { dark: 'moon', light: 'sun', system: 'monitor' }

type ViewMode = Settings['editor']['viewMode']
const VIEW_MODES: { id: ViewMode; icon: IconName; label: string }[] = [
  { id: 'source', icon: 'pencil', label: 'Edit' },
  { id: 'live', icon: 'columns', label: 'Hybrid' },
  { id: 'reading', icon: 'eye', label: 'Read' }
]

function ViewModeSwitch(): React.JSX.Element {
  const viewMode = useStore((s) => s.settings.editor.viewMode)
  const update = useStore((s) => s.updateSettings)
  const editor = useStore((s) => s.settings.editor)
  return (
    <div className="viewmode" role="radiogroup" aria-label="View mode">
      {VIEW_MODES.map((m) => (
        <button
          key={m.id}
          role="radio"
          aria-checked={viewMode === m.id}
          title={`${m.label} mode`}
          className={`viewmode__btn${viewMode === m.id ? ' viewmode__btn--active' : ''}`}
          onClick={() => update({ editor: { ...editor, viewMode: m.id } })}
        >
          <Icon name={m.icon} size={13} />
          <span className="viewmode__label">{m.label}</span>
        </button>
      ))}
    </div>
  )
}

export function StatusBar(): React.JSX.Element {
  const stats = useEditorStats()
  const active = useStore((s) => (s.activeId ? s.buffers[s.activeId] : null))
  const mode = useStore((s) => s.settings.theme)
  const setThemeMode = useStore((s) => s.setThemeMode)
  const sidePanel = useStore((s) => s.sidePanel)
  const toggleSidePanel = useStore((s) => s.toggleSidePanel)

  return (
    <footer className="status-bar">
      <span className="status-bar__path" title={active?.filePath ?? ''}>
        {active ? (active.filePath ?? 'Unsaved') + (active.isDirty ? ' — modified' : '') : ''}
      </span>
      <span className="status-bar__spacer" />
      {active && <ViewModeSwitch />}
      {active && (
        <>
          <span>
            Ln {stats.line}, Col {stats.column}
          </span>
          <span>{stats.words} words</span>
          <span>{stats.characters} chars</span>
        </>
      )}
      <button
        className={`status-bar__theme${sidePanel ? ' status-bar__btn--on' : ''}`}
        title="Toggle side panel — outline, backlinks, search (Ctrl+Shift+B)"
        onClick={() => toggleSidePanel(sidePanel ?? 'outline')}
      >
        <Icon name="link" size={13} />
        panel
      </button>
      <button
        className="status-bar__theme"
        title={`Appearance: ${mode} — click to cycle`}
        onClick={() =>
          setThemeMode(mode === 'dark' ? 'light' : mode === 'light' ? 'system' : 'dark')
        }
      >
        <Icon name={MODE_ICON[mode] ?? 'monitor'} size={13} />
        {mode}
      </button>
    </footer>
  )
}
