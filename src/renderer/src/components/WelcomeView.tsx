import { useEffect, useState } from 'react'
import { basename } from '@core/paths'
import { invoke } from '@/services/client'
import { useStore } from '@/state/store'
import { Icon, type IconName } from './Icon'
import { Logo } from './Logo'

const ACTIONS: {
  label: string
  hint: string
  icon: IconName
  desc: string
  run: (s: ReturnType<typeof useStore.getState>) => void
}[] = [
  {
    label: 'New Note',
    hint: 'Ctrl N',
    icon: 'file-plus',
    desc: 'Create an untitled note in the editor',
    run: (s) => s.newUntitled()
  },
  {
    label: 'Open File',
    hint: 'Ctrl O',
    icon: 'file-text',
    desc: 'Open a markdown file from disk',
    run: (s) => void s.openFileDialog()
  },
  {
    label: 'Open Vault Folder',
    hint: 'Ctrl ⇧ O',
    icon: 'folder-open',
    desc: 'Open a folder as your knowledge base',
    run: (s) => void s.openFolder()
  },
  {
    label: 'Command Palette',
    hint: 'Ctrl ⇧ P',
    icon: 'keyboard',
    desc: 'Search all commands and shortcuts',
    run: (s) => s.openPalette('commands')
  }
]

const CHEATSHEET = [
  { syntax: '# Heading 1', effect: 'H1 Title' },
  { syntax: '**bold** / *italic*', effect: 'Bold / Italic text' },
  { syntax: '==highlight==', effect: 'Marker pen highlight' },
  { syntax: '- [ ] Task item', effect: 'Interactive checklist' },
  { syntax: '[[Note Title]]', effect: 'Wikilink to note' },
  { syntax: '> [!NOTE]', effect: 'Admonition callout box' },
  { syntax: '$$ E = mc^2 $$', effect: 'KaTeX Math formula' },
  { syntax: '```mermaid', effect: 'Flowchart / Diagram' }
]

export function WelcomeView(): React.JSX.Element {
  const openPaths = useStore((s) => s.openPaths)
  const openFolder = useStore((s) => s.openFolder)
  const recentFolders = useStore((s) => s.settings.recentFolders)
  const [recentFiles, setRecentFiles] = useState<string[]>([])
  const [showCheatSheet, setShowCheatSheet] = useState(false)

  useEffect(() => {
    void invoke('app:getRecentFiles', undefined).then(setRecentFiles)
  }, [])

  return (
    <div className="welcome">
      <div className="welcome__hero">
        <Logo size={56} />
        <div className="welcome__title">
          <h1 className="welcome__wordmark">orrery</h1>
          <p className="welcome__tagline">High-performance, live-preview markdown editor &amp; knowledge base</p>
        </div>
      </div>

      <div className="welcome__actions-grid">
        {ACTIONS.map((a) => (
          <button
            key={a.label}
            className="welcome__action-card"
            onClick={() => a.run(useStore.getState())}
          >
            <div className="welcome__action-card-header">
              <span className="welcome__action-icon">
                <Icon name={a.icon} size={18} />
              </span>
              <kbd className="welcome__action-kbd">{a.hint}</kbd>
            </div>
            <span className="welcome__action-label">{a.label}</span>
            <span className="welcome__action-desc">{a.desc}</span>
          </button>
        ))}
      </div>

      <div className="welcome__lists">
        {recentFolders.length > 0 && (
          <div className="welcome__recent-col">
            <div className="welcome__col-header">
              <Icon name="folder" size={14} />
              <h2>Recent Vaults</h2>
            </div>
            <div className="welcome__recent-items">
              {recentFolders.slice(0, 5).map((path) => (
                <button
                  key={path}
                  className="welcome__recent-item"
                  title={path}
                  onClick={() => void openFolder(path)}
                >
                  <Icon name="folder" size={14} className="welcome__recent-icon" />
                  <div className="welcome__recent-meta">
                    <span className="welcome__recent-name">{basename(path)}</span>
                    <span className="welcome__recent-path">{path}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {recentFiles.length > 0 && (
          <div className="welcome__recent-col">
            <div className="welcome__col-header">
              <Icon name="file-text" size={14} />
              <h2>Recent Notes</h2>
            </div>
            <div className="welcome__recent-items">
              {recentFiles.slice(0, 5).map((path) => (
                <button
                  key={path}
                  className="welcome__recent-item"
                  title={path}
                  onClick={() => void openPaths([path])}
                >
                  <Icon name="file-text" size={14} className="welcome__recent-icon" />
                  <div className="welcome__recent-meta">
                    <span className="welcome__recent-name">{basename(path)}</span>
                    <span className="welcome__recent-path">{path}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Markdown Cheat Sheet Drawer / Toggle */}
      <div className="welcome__cheatsheet-section">
        <button
          className="welcome__cheatsheet-toggle"
          onClick={() => setShowCheatSheet((s) => !s)}
        >
          <Icon name="markdown" size={15} />
          <span>Markdown Syntax Guide</span>
          <Icon name={showCheatSheet ? 'chevron-up' : 'chevron-down'} size={13} />
        </button>
        {showCheatSheet && (
          <div className="welcome__cheatsheet-grid">
            {CHEATSHEET.map((c) => (
              <div key={c.syntax} className="welcome__cheatsheet-row">
                <code>{c.syntax}</code>
                <span>{c.effect}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
