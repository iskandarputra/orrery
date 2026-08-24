import { useState, useMemo } from 'react'
import { invoke, parseIpcError } from '@/services/client'
import { useStore } from '@/state/store'
import { resolveTheme, THEMES, type ThemeSpec } from '@/themes/themes'
import { Icon } from '../Icon'
import { NumberField, SegmentedControl, SettingRow, TextField, Toggle } from './controls'

export function GeneralSection(): React.JSX.Element {
  const settings = useStore((s) => s.settings)
  const update = useStore((s) => s.updateSettings)
  const g = settings.general

  return (
    <>
      <h3 className="set-group">Files</h3>
      <SettingRow label="Autosave" description="Save documents automatically after you stop typing">
        <Toggle
          checked={g.autosave}
          onChange={(autosave) => update({ general: { ...g, autosave } })}
        />
      </SettingRow>
      {g.autosave && (
        <SettingRow label="Autosave delay" description="Idle time before an automatic save">
          <NumberField
            value={g.autosaveDelay}
            min={250}
            max={30000}
            step={250}
            suffix="ms"
            onChange={(autosaveDelay) => update({ general: { ...g, autosaveDelay } })}
          />
        </SettingRow>
      )}
      <h3 className="set-group">Startup</h3>
      <SettingRow
        label="Restore last folder"
        description="Reopen the previous workspace when zymd starts"
      >
        <Toggle
          checked={g.restoreLastFolder}
          onChange={(restoreLastFolder) => update({ general: { ...g, restoreLastFolder } })}
        />
      </SettingRow>
    </>
  )
}

export function EditorSection(): React.JSX.Element {
  const settings = useStore((s) => s.settings)
  const update = useStore((s) => s.updateSettings)
  const e = settings.editor

  return (
    <>
      <h3 className="set-group">Typography</h3>
      <SettingRow label="Font size">
        <NumberField
          value={e.fontSize}
          min={8}
          max={48}
          suffix="px"
          onChange={(fontSize) => update({ editor: { ...e, fontSize } })}
        />
      </SettingRow>
      <SettingRow label="Font family" description="Leave empty for the default prose font (Inter)">
        <TextField
          value={e.fontFamily}
          placeholder="Inter, Newsreader, JetBrains Mono…"
          onChange={(fontFamily) => update({ editor: { ...e, fontFamily } })}
        />
      </SettingRow>
      <SettingRow label="Line height">
        <NumberField
          value={e.lineHeight}
          min={1}
          max={3}
          step={0.1}
          onChange={(lineHeight) => update({ editor: { ...e, lineHeight } })}
        />
      </SettingRow>

      {/* Typography Live Preview Sandbox */}
      <div className="typography-preview">
        <span className="typography-preview__label">Live Typography Preview</span>
        <div
          className="typography-preview__box"
          style={{
            fontSize: `${e.fontSize}px`,
            lineHeight: e.lineHeight,
            fontFamily: e.fontFamily || 'var(--zy-prose-font)'
          }}
        >
          <h4 style={{ margin: '0 0 0.3em 0', fontSize: '1.25em' }}>The quick brown fox jumps</h4>
          <p style={{ margin: '0 0 0.3em 0' }}>
            Markdown note with <strong>bold</strong>, <em>italic</em> and <code>inline code</code> formatting.
          </p>
        </div>
      </div>

      <h3 className="set-group">Layout</h3>
      <SettingRow
        label="Canvas width"
        description="Readable column presets, edge-to-edge, or an exact width"
      >
        <SegmentedControl
          value={e.lineWidth}
          onChange={(lineWidth) => update({ editor: { ...e, lineWidth } })}
          options={[
            { value: 'narrow', label: 'Narrow' },
            { value: 'normal', label: 'Normal' },
            { value: 'wide', label: 'Wide' },
            { value: 'full', label: 'Full' },
            { value: 'custom', label: 'Custom' }
          ]}
        />
      </SettingRow>
      {e.lineWidth === 'custom' && (
        <SettingRow label="Custom width" description="Exact width of the editing column">
          <NumberField
            value={e.customLineWidth}
            min={400}
            max={3000}
            step={20}
            suffix="px"
            onChange={(customLineWidth) => update({ editor: { ...e, customLineWidth } })}
          />
        </SettingRow>
      )}
      <h3 className="set-group">Behavior</h3>
      <SettingRow label="Word wrap" description="Wrap long lines instead of scrolling horizontally">
        <Toggle
          checked={e.wordWrap}
          onChange={(wordWrap) => update({ editor: { ...e, wordWrap } })}
        />
      </SettingRow>
      <SettingRow label="Line numbers">
        <Toggle
          checked={e.lineNumbers}
          onChange={(lineNumbers) => update({ editor: { ...e, lineNumbers } })}
        />
      </SettingRow>
      <SettingRow label="Highlight active line" description="Subtle tint on the line being edited">
        <Toggle
          checked={e.highlightActiveLine}
          onChange={(highlightActiveLine) => update({ editor: { ...e, highlightActiveLine } })}
        />
      </SettingRow>
      <SettingRow label="Tab size">
        <NumberField
          value={e.tabSize}
          min={1}
          max={8}
          onChange={(tabSize) => update({ editor: { ...e, tabSize } })}
        />
      </SettingRow>
      <h3 className="set-group">Modes</h3>
      <SettingRow
        label="Default view mode"
        description="Edit (source) · Hybrid (live preview) · Reading (view only)"
      >
        <SegmentedControl
          value={e.viewMode}
          onChange={(viewMode) => update({ editor: { ...e, viewMode } })}
          options={[
            { value: 'source', label: 'Edit' },
            { value: 'live', label: 'Hybrid' },
            { value: 'reading', label: 'Reading' }
          ]}
        />
      </SettingRow>
      <SettingRow label="Typewriter" description="Keep the writing line vertically centered">
        <Toggle
          checked={e.typewriter}
          onChange={(typewriter) => update({ editor: { ...e, typewriter } })}
        />
      </SettingRow>
      <SettingRow label="Focus mode" description="Dim everything except the active paragraph">
        <Toggle
          checked={e.focusMode}
          onChange={(focusMode) => update({ editor: { ...e, focusMode } })}
        />
      </SettingRow>
    </>
  )
}

export function MarkdownSection(): React.JSX.Element {
  const settings = useStore((s) => s.settings)
  const update = useStore((s) => s.updateSettings)
  const m = settings.markdown

  return (
    <>
      <h3 className="set-group">Live preview</h3>
      <SettingRow
        label="Live preview"
        description="Render formatting inline while editing — headings, bold, links and more"
      >
        <Toggle
          checked={m.livePreview}
          onChange={(livePreview) => update({ markdown: { ...m, livePreview } })}
        />
      </SettingRow>
      <SettingRow label="Round bullets" description="Show list markers (-, *, +) as bullets">
        <Toggle
          checked={m.fancyBullets}
          onChange={(fancyBullets) => update({ markdown: { ...m, fancyBullets } })}
        />
      </SettingRow>
      <SettingRow
        label="Interactive checkboxes"
        description="Render task markers as clickable checkboxes"
      >
        <Toggle
          checked={m.interactiveCheckboxes}
          onChange={(interactiveCheckboxes) =>
            update({ markdown: { ...m, interactiveCheckboxes } })
          }
        />
      </SettingRow>
      <SettingRow label="Show images" description="Render ![alt](path) images inline">
        <Toggle
          checked={m.showImages}
          onChange={(showImages) => update({ markdown: { ...m, showImages } })}
        />
      </SettingRow>
      <SettingRow
        label="Reflow paragraphs"
        description="Fill the canvas width like a preview — soft line breaks become spaces"
      >
        <Toggle
          checked={m.reflowParagraphs}
          onChange={(reflowParagraphs) => update({ markdown: { ...m, reflowParagraphs } })}
        />
      </SettingRow>
    </>
  )
}

export function AiSection(): React.JSX.Element {
  const settings = useStore((s) => s.settings)
  const update = useStore((s) => s.updateSettings)
  const a = settings.ai

  return (
    <>
      <h3 className="set-group">Provider</h3>
      <SettingRow
        label="AI provider"
        description="Powers chat-with-vault; keys stay on this machine"
      >
        <SegmentedControl
          value={a.provider}
          onChange={(provider) => update({ ai: { ...a, provider } })}
          options={[
            { value: 'none', label: 'Off' },
            { value: 'claude', label: 'Claude' },
            { value: 'ollama', label: 'Ollama' }
          ]}
        />
      </SettingRow>
      {a.provider === 'claude' && (
        <>
          <SettingRow label="API key" description="From console.anthropic.com — stored locally">
            <TextField
              value={a.apiKey}
              placeholder="sk-ant-…"
              onChange={(apiKey) => update({ ai: { ...a, apiKey } })}
            />
          </SettingRow>
          <SettingRow label="Model">
            <TextField
              value={a.model}
              placeholder="claude-sonnet-5"
              onChange={(model) => update({ ai: { ...a, model } })}
            />
          </SettingRow>
        </>
      )}
      {a.provider === 'ollama' && (
        <>
          <SettingRow label="Ollama URL" description="Local server — private and offline">
            <TextField
              value={a.ollamaUrl}
              placeholder="http://localhost:11434"
              onChange={(ollamaUrl) => update({ ai: { ...a, ollamaUrl } })}
            />
          </SettingRow>
          <SettingRow label="Model">
            <TextField
              value={a.ollamaModel}
              placeholder="llama3.1"
              onChange={(ollamaModel) => update({ ai: { ...a, ollamaModel } })}
            />
          </SettingRow>
        </>
      )}
      {a.provider !== 'none' && (
        <>
          <h3 className="set-group">Retrieval</h3>
          <SettingRow
            label="Semantic search"
            description="Retrieve context by meaning (embeddings) instead of keywords"
          >
            <Toggle
              checked={a.semanticSearch}
              onChange={(semanticSearch) => update({ ai: { ...a, semanticSearch } })}
            />
          </SettingRow>
          {a.semanticSearch && (
            <>
              <SettingRow
                label="Embedding model"
                description="Local Ollama model — run: ollama pull nomic-embed-text"
              >
                <TextField
                  value={a.embedModel}
                  placeholder="nomic-embed-text"
                  onChange={(embedModel) => update({ ai: { ...a, embedModel } })}
                />
              </SettingRow>
              <ReindexRow />
            </>
          )}
        </>
      )}
      <p className="set-note">
        Open the chat with Ctrl+Shift+A. Answers are grounded in your active note and matching vault
        snippets, with [file:line] citations.
      </p>
    </>
  )
}

function ReindexRow(): React.JSX.Element {
  const rootPath = useStore((s) => s.rootPath)
  const [status, setStatus] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const reindex = (): void => {
    if (!rootPath) {
      setStatus('Open a folder first.')
      return
    }
    setBusy(true)
    setStatus('Indexing…')
    void invoke('embeddings:reindex', { rootPath })
      .then((r) => setStatus(`Indexed ${r.chunks} chunks from ${r.files} notes.`))
      .catch((err) => setStatus(parseIpcError(err).message))
      .finally(() => setBusy(false))
  }
  return (
    <SettingRow label="Index" description="Rebuild embeddings for the open vault">
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
        <button className="btn" disabled={busy} onClick={reindex}>
          {busy ? 'Indexing…' : 'Reindex vault'}
        </button>
        {status && <span className="set-row__desc">{status}</span>}
      </div>
    </SettingRow>
  )
}

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
  const [themeFilter, setThemeFilter] = useState('')

  const dark = useMemo(() => {
    const q = themeFilter.trim().toLowerCase()
    return THEMES.filter((t) => t.appearance === 'dark' && (!q || t.name.toLowerCase().includes(q)))
  }, [themeFilter])

  const light = useMemo(() => {
    const q = themeFilter.trim().toLowerCase()
    return THEMES.filter((t) => t.appearance === 'light' && (!q || t.name.toLowerCase().includes(q)))
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

      <div className="theme-filter-row">
        <h3 className="set-group" style={{ margin: 0 }}>Palettes ({THEMES.length})</h3>
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
    return BINDABLE.filter((b) => b.label.toLowerCase().includes(q) || b.id.toLowerCase().includes(q))
  }, [filter])

  return (
    <>
      <div className="kb-header-row">
        <h3 className="set-group" style={{ margin: 0 }}>Shortcuts</h3>
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

export function AboutSection(): React.JSX.Element {
  return (
    <>
      <h3 className="set-group">zymd</h3>
      <div className="about-hero">
        <div className="about-hero__badge">v0.1.0</div>
        <p className="set-note" style={{ margin: 0 }}>
          High-performance, feature-rich markdown editor and knowledge base with interactive live preview.
          <br />
          Crafted with Electron, React, and CodeMirror 6.
        </p>
      </div>
      <div className="about-links">
        <span className="about-links__tag">MIT License</span>
        <span className="about-links__tag">Offline First</span>
        <span className="about-links__tag">Local Storage</span>
      </div>
    </>
  )
}
