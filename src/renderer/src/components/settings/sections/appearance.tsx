import { useState, useMemo } from 'react'
import { useStore } from '@/state/store'
import { resolveTheme, THEMES, type ThemeSpec } from '@/themes/themes'
import { Icon } from '../../Icon'
import { SegmentedControl, SettingRow, Toggle } from '../controls'

function ThemeCard({ spec }: { spec: ThemeSpec }): React.JSX.Element {
  const settings = useStore((s) => s.settings)
  const selectTheme = useStore((s) => s.selectTheme)
  const resolved = resolveTheme(spec)
  const active =
    settings.theme === 'system'
      ? spec.appearance === 'dark'
        ? settings.darkTheme === spec.id
        : settings.lightTheme === spec.id
      : settings.theme === spec.appearance &&
        (spec.appearance === 'dark'
          ? settings.darkTheme === spec.id
          : settings.lightTheme === spec.id)

  return (
    <button
      className={`theme-card${active ? ' theme-card--active' : ''}`}
      onClick={() => selectTheme(spec.id)}
      title={spec.name}
    >
      <span
        className="theme-card__preview"
        style={{ background: resolved['editor-bg'], borderColor: resolved.border }}
      >
        <span className="theme-card__strip" style={{ background: resolved['panel-bg'] }} />
        <span className="theme-card__lines">
          <span style={{ background: resolved.fg, width: '55%' }} />
          <span style={{ background: resolved.accent, width: '38%' }} />
          <span style={{ background: resolved['fg-faint'], width: '70%' }} />
        </span>
      </span>
      <span className="theme-card__name">
        {spec.name}
        {active && <Icon name="check" size={12} />}
      </span>
    </button>
  )
}

export function AppearanceSection(): React.JSX.Element {
  const mode = useStore((s) => s.settings.theme)
  const setThemeMode = useStore((s) => s.setThemeMode)
  const highContrastCode = useStore((s) => s.settings.highContrastCode)
  const updateSettings = useStore((s) => s.updateSettings)
  const [themeFilter, setThemeFilter] = useState('')

  const dark = useMemo(() => {
    const q = themeFilter.trim().toLowerCase()
    return THEMES.filter((t) => t.appearance === 'dark' && (!q || t.name.toLowerCase().includes(q)))
  }, [themeFilter])

  const light = useMemo(() => {
    const q = themeFilter.trim().toLowerCase()
    return THEMES.filter(
      (t) => t.appearance === 'light' && (!q || t.name.toLowerCase().includes(q))
    )
  }, [themeFilter])

  return (
    <>
      <h3 className="set-group">Mode</h3>
      <SettingRow
        label="Appearance"
        description="System follows your OS; the palettes below apply per mode"
      >
        <SegmentedControl
          value={mode}
          onChange={setThemeMode}
          options={[
            { value: 'light', label: <Icon name="sun" size={14} /> },
            { value: 'dark', label: <Icon name="moon" size={14} /> },
            { value: 'system', label: <Icon name="monitor" size={14} /> }
          ]}
        />
      </SettingRow>

      <SettingRow
        label="High-contrast code"
        description="Deepen syntax colours until they meet WCAG AA. Most palettes ship at least one colour below it, so this trades a little of a theme's character for readability."
      >
        <Toggle
          checked={highContrastCode}
          onChange={(value) => updateSettings({ highContrastCode: value })}
        />
      </SettingRow>

      <div className="theme-filter-row">
        <h3 className="set-group" style={{ margin: 0 }}>
          Palettes ({THEMES.length})
        </h3>
        <div className="theme-filter-input-wrap">
          <Icon name="search" size={12} />
          <input
            type="text"
            placeholder="Search themes…"
            value={themeFilter}
            onChange={(e) => setThemeFilter(e.target.value)}
          />
        </div>
      </div>

      <h4 className="theme-group-title">Dark themes ({dark.length})</h4>
      <div className="theme-grid">
        {dark.map((t) => (
          <ThemeCard key={t.id} spec={t} />
        ))}
      </div>

      <h4 className="theme-group-title">Light themes ({light.length})</h4>
      <div className="theme-grid">
        {light.map((t) => (
          <ThemeCard key={t.id} spec={t} />
        ))}
      </div>
    </>
  )
}
