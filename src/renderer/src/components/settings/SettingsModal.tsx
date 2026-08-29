import { useEffect, useMemo, useState } from 'react'
import { useStore } from '@/state/store'
import { Icon, type IconName } from '../Icon'
import {
  AboutSection,
  AiSection,
  AppearanceSection,
  EditorSection,
  GeneralSection,
  KeybindingsSection,
  LanguageServersSection,
  MarkdownSection,
  McpSection,
  NotesSection
} from './sections'

type SectionId =
  | 'general'
  | 'editor'
  | 'markdown'
  | 'notes'
  | 'appearance'
  | 'ai'
  | 'mcp'
  | 'lsp'
  | 'keybindings'
  | 'about'

const SECTIONS: { id: SectionId; label: string; icon: IconName; desc: string }[] = [
  { id: 'general', label: 'General', icon: 'sliders', desc: 'Autosave, startup behavior' },
  { id: 'editor', label: 'Editor', icon: 'type', desc: 'Typography, line numbers, word wrap' },
  { id: 'markdown', label: 'Markdown', icon: 'markdown', desc: 'Live preview, tasklists, images' },
  { id: 'notes', label: 'Notes', icon: 'clock', desc: 'Daily notes and templates' },
  {
    id: 'appearance',
    label: 'Appearance',
    icon: 'palette',
    desc: 'Themes, dark mode, accent colors'
  },
  {
    id: 'ai',
    label: 'AI Assistant',
    icon: 'sparkle',
    desc: 'Claude, Ollama, DeepSeek & compatible APIs'
  },
  { id: 'lsp', label: 'Language Servers', icon: 'code', desc: 'Diagnostics for code files' },
  {
    id: 'keybindings',
    label: 'Keybindings',
    icon: 'keyboard',
    desc: 'Keyboard shortcuts customization'
  },
  { id: 'about', label: 'About', icon: 'info', desc: 'Version and system information' }
]

const CONTENT: Record<SectionId, () => React.JSX.Element> = {
  general: GeneralSection,
  editor: EditorSection,
  markdown: MarkdownSection,
  notes: NotesSection,
  appearance: AppearanceSection,
  ai: AiSection,
  mcp: McpSection,
  lsp: LanguageServersSection,
  keybindings: KeybindingsSection,
  about: AboutSection
}

export function SettingsModal(): React.JSX.Element | null {
  const open = useStore((s) => s.settingsOpen)
  const close = useStore((s) => s.closeSettings)
  const [section, setSection] = useState<SectionId>('general')
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, close])

  const filteredSections = useMemo(() => {
    if (!search.trim()) return SECTIONS
    const q = search.trim().toLowerCase()
    return SECTIONS.filter(
      (s) => s.label.toLowerCase().includes(q) || s.desc.toLowerCase().includes(q)
    )
  }, [search])

  if (!open) return null
  const Body = CONTENT[section]

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="settings" role="dialog" aria-label="Settings Preferences">
        <nav className="settings__nav">
          <div className="settings__nav-header">
            <span className="settings__nav-title">Preferences</span>
            <div className="settings__search-wrap">
              <Icon name="search" size={12} className="settings__search-icon" />
              <input
                type="text"
                className="settings__search-input"
                placeholder="Search settings…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
          <div className="settings__nav-list">
            {filteredSections.map((s) => (
              <button
                key={s.id}
                className={`settings__nav-item${section === s.id ? ' settings__nav-item--active' : ''}`}
                onClick={() => setSection(s.id)}
              >
                <Icon name={s.icon} size={15} />
                <span className="settings__nav-label">{s.label}</span>
              </button>
            ))}
          </div>
        </nav>
        <div className="settings__body">
          <header className="settings__header">
            <div className="settings__header-title-group">
              <h2>{SECTIONS.find((s) => s.id === section)?.label}</h2>
              <span className="settings__header-desc">
                {SECTIONS.find((s) => s.id === section)?.desc}
              </span>
            </div>
            <button className="icon-btn" aria-label="Close settings" onClick={close}>
              <Icon name="x" size={15} />
            </button>
          </header>
          <div className="settings__content">
            <Body />
          </div>
        </div>
      </div>
    </div>
  )
}
