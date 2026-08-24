import { useEditorStats } from '@/state/editor-stats'
import { useStore } from '@/state/store'
import { getTheme } from '@/themes/themes'
import { Icon, type IconName } from './Icon'

const MODE_ICON: Record<string, IconName> = { dark: 'moon', light: 'sun', system: 'monitor' }

export function StatusBar(): React.JSX.Element {
  const stats = useEditorStats()
  const active = useStore((s) => (s.activeId ? s.buffers[s.activeId] : null))
  const tabSize = useStore((s) => s.settings.editor.tabSize)
  const mode = useStore((s) => s.settings.theme)
  const darkTheme = useStore((s) => s.settings.darkTheme)
  const lightTheme = useStore((s) => s.settings.lightTheme)
  const setThemeMode = useStore((s) => s.setThemeMode)
  const setDocStatsOpen = useStore((s) => s.setDocStatsOpen)

  const activeThemeId = mode === 'dark' ? darkTheme : lightTheme
  const activeThemeName = getTheme(activeThemeId).name

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
        {active && (
          <>
            {/* Cursor position */}
            <span className="status-bar__item" title="Current cursor position">
              Ln {stats.line}, Col {stats.column}
            </span>

            <span className="status-bar__sep">·</span>

            {/* Word count metric pill */}
            <button
              className="status-bar__stats-btn"
              title="Click to view detailed document metrics"
              onClick={() => setDocStatsOpen(true)}
            >
              <span>{stats.words.toLocaleString()} words</span>
            </button>

            <span className="status-bar__sep">·</span>

            {/* Indentation & Encoding */}
            <span className="status-bar__item" title="Tab indentation width">
              Spaces: {tabSize}
            </span>

            <span className="status-bar__sep">·</span>

            <span className="status-bar__item" title="File encoding">
              UTF-8
            </span>

            <span className="status-bar__sep">·</span>

            <span className="status-bar__item" title="Language mode">
              Markdown
            </span>
          </>
        )}

        {/* Theme pill */}
        <button
          className="status-bar__btn"
          title={`Active theme: ${activeThemeName} (${mode}) — click to toggle mode`}
          onClick={() =>
            setThemeMode(mode === 'dark' ? 'light' : mode === 'light' ? 'system' : 'dark')
          }
        >
          <Icon name={MODE_ICON[mode] ?? 'monitor'} size={12} />
          <span className="status-bar__theme-label">{activeThemeName}</span>
        </button>
      </div>
    </footer>
  )
}
