import { useEffect, useState } from 'react'
import { useStore } from '@/state/store'
import { Icon, type IconName } from '../Icon'
import {
  AboutSection,
  AiSection,
  AppearanceSection,
  EditorSection,
  GeneralSection,
  KeybindingsSection,
  MarkdownSection
} from './sections'

type SectionId = 'general' | 'editor' | 'markdown' | 'appearance' | 'ai' | 'keybindings' | 'about'

const SECTIONS: { id: SectionId; label: string; icon: IconName }[] = [
  { id: 'general', label: 'General', icon: 'sliders' },
  { id: 'editor', label: 'Editor', icon: 'type' },
  { id: 'markdown', label: 'Markdown', icon: 'markdown' },
  { id: 'appearance', label: 'Appearance', icon: 'palette' },
  { id: 'ai', label: 'AI', icon: 'search' },
  { id: 'keybindings', label: 'Keybindings', icon: 'keyboard' },
  { id: 'about', label: 'About', icon: 'info' }
]

const CONTENT: Record<SectionId, () => React.JSX.Element> = {
  general: GeneralSection,
  editor: EditorSection,
  markdown: MarkdownSection,
  appearance: AppearanceSection,
  ai: AiSection,
  keybindings: KeybindingsSection,
  about: AboutSection
}

export function SettingsModal(): React.JSX.Element | null {
  const open = useStore((s) => s.settingsOpen)
  const close = useStore((s) => s.closeSettings)
  const [section, setSection] = useState<SectionId>('general')

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, close])

  if (!open) return null
  const Body = CONTENT[section]

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="settings" role="dialog" aria-label="Settings">
        <nav className="settings__nav">
          <div className="settings__nav-title">Settings</div>
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              className={`settings__nav-item${section === s.id ? ' settings__nav-item--active' : ''}`}
              onClick={() => setSection(s.id)}
            >
              <Icon name={s.icon} size={15} />
              {s.label}
            </button>
          ))}
        </nav>
        <div className="settings__body">
          <header className="settings__header">
            <h2>{SECTIONS.find((s) => s.id === section)?.label}</h2>
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
