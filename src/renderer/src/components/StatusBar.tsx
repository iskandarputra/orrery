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
          title={`${m.label} mode (${m.id === 'source' ? 'Source' : m.id === 'live' ? 'Live Preview' : 'Reading'})`}
          className={`viewmode__btn${viewMode === m.id ? ' viewmode__btn--active' : ''}`}
          onClick={() => update({ editor: { ...editor, viewMode: m.id } })}
        >
          <Icon name={m.icon} size={12} />
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
  const setDocStatsOpen = useStore((s) => s.setDocStatsOpen)

  const readingTimeMin = Math.max(1, Math.ceil(stats.words / 200))

  return (
    <footer className="status-bar">
      <div className="status-bar__left">
        <span className="status-bar__path" title={active?.filePath ?? ''}>
          {active ? (
            <>
              <Icon name="file-text" size={12} className="status-bar__file-icon" />
              <span>{active.fileName}</span>
              {active.isDirty && <span className="status-bar__dirty-badge">● Modified</span>}
            </>
          ) : (
            <span className="status-bar__ready">zymd ready</span>
          )}
        </span>
      </div>

      <span className="status-bar__spacer" />

      <div className="status-bar__right">
        {active && <ViewModeSwitch />}

        {active && (
          <button
            className="status-bar__stats-btn"
            title="Click to view detailed metrics"
            onClick={() => setDocStatsOpen(true)}
          >
            <span>Ln {stats.line}, Col {stats.column}</span>
            <span className="status-bar__sep">·</span>
            <span>{stats.words.toLocaleString()} words</span>
            <span className="status-bar__sep">·</span>
            <span>{stats.characters.toLocaleString()} chars</span>
            <span className="status-bar__sep">·</span>
            <span>~{readingTimeMin}m</span>
          </button>
        )}

        <button
          className={`status-bar__btn${sidePanel ? ' status-bar__btn--on' : ''}`}
          title="Toggle side panel — outline, backlinks, search, AI (Ctrl+Shift+B)"
          onClick={() => toggleSidePanel(sidePanel ?? 'outline')}
        >
          <Icon name="columns" size={12} />
          <span>Panel</span>
        </button>

        <button
          className="status-bar__btn"
          title={`Appearance: ${mode} — click to cycle`}
          onClick={() =>
            setThemeMode(mode === 'dark' ? 'light' : mode === 'light' ? 'system' : 'dark')
          }
        >
          <Icon name={MODE_ICON[mode] ?? 'monitor'} size={12} />
          <span className="status-bar__theme-label">{mode}</span>
        </button>
      </div>
    </footer>
  )
}
