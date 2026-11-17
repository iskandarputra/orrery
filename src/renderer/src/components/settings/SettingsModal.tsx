import { useEffect, useMemo, useState } from 'react'
import { useStore } from '@/state/store'
import type { SettingsSection } from '@/state/ui'
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

type SectionId = SettingsSection

/**
 * Every page of the dialog, in menu order, with what it renders.
 *
 * One list rather than a menu list and a separate table of pages. With two,
 * the MCP page went into the table and not the menu, so it rendered for
 * nobody, while the Tools panel and docs/mcp.md both sent people to it.
 */
const SECTIONS: {
  id: SectionId
  label: string
  icon: IconName
  desc: string
  Body: () => React.JSX.Element
}[] = [
  {
    id: 'general',
    label: 'General',
    icon: 'sliders',
    desc: 'Autosave, startup behavior',
    Body: GeneralSection
  },
  {
    id: 'editor',
    label: 'Editor',
    icon: 'type',
    desc: 'Typography, line numbers, word wrap',
    Body: EditorSection
  },
  {
    id: 'markdown',
    label: 'Markdown',
    icon: 'markdown',
    desc: 'Live preview, tasklists, images',
    Body: MarkdownSection
  },
  {
    id: 'notes',
    label: 'Notes',
    icon: 'clock',
    desc: 'Daily notes and templates',
    Body: NotesSection
  },
  {
    id: 'appearance',
    label: 'Appearance',
    icon: 'palette',
    desc: 'Themes, dark mode, accent colors',
    Body: AppearanceSection
  },
  {
    id: 'ai',
    label: 'AI Assistant',
    icon: 'sparkle',
    desc: 'Claude, Ollama, DeepSeek & compatible APIs',
    Body: AiSection
  },
  {
    id: 'mcp',
    label: 'MCP',
    icon: 'zap',
    desc: 'Servers, their tools, and what they may run',
    Body: McpSection
  },
  {
    id: 'lsp',
    label: 'Language Servers',
    icon: 'code',
    desc: 'Diagnostics for code files',
    Body: LanguageServersSection
  },
  {
    id: 'keybindings',
    label: 'Keybindings',
    icon: 'keyboard',
    desc: 'Keyboard shortcuts customization',
    Body: KeybindingsSection
  },
  {
    id: 'about',
    label: 'About',
    icon: 'info',
    desc: 'Version and system information',
    Body: AboutSection
  }
]

export function SettingsModal(): React.JSX.Element | null {
  const open = useStore((s) => s.settingsOpen)
  const close = useStore((s) => s.closeSettings)
  const section = useStore((s) => s.settingsSection)
  const setSection = useStore((s) => s.showSettingsSection)
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
  const Body = (SECTIONS.find((s) => s.id === section) ?? SECTIONS[0]!).Body

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
