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
  run: (s: ReturnType<typeof useStore.getState>) => void
}[] = [
  { label: 'New file', hint: 'Ctrl N', icon: 'file-plus', run: (s) => s.newUntitled() },
  { label: 'Open file', hint: 'Ctrl O', icon: 'file-text', run: (s) => void s.openFileDialog() },
  { label: 'Open folder', hint: 'Ctrl ⇧ O', icon: 'folder-open', run: (s) => void s.openFolder() }
]

export function WelcomeView(): React.JSX.Element {
  const openPaths = useStore((s) => s.openPaths)
  const openFolder = useStore((s) => s.openFolder)
  const recentFolders = useStore((s) => s.settings.recentFolders)
  const [recentFiles, setRecentFiles] = useState<string[]>([])

  useEffect(() => {
    void invoke('app:getRecentFiles', undefined).then(setRecentFiles)
  }, [])

  return (
    <div className="welcome">
      <div className="welcome__hero">
        <Logo size={64} />
        <div className="welcome__title">
          <h1 className="welcome__wordmark">zymd</h1>
          <p className="welcome__tagline">A fast, friendly markdown editor &amp; knowledge base</p>
        </div>
      </div>

      <div className="welcome__actions">
        {ACTIONS.map((a) => (
          <button
            key={a.label}
            className="welcome__action"
            onClick={() => a.run(useStore.getState())}
          >
            <span className="welcome__action-icon">
              <Icon name={a.icon} size={18} />
            </span>
            <span className="welcome__action-label">{a.label}</span>
            <span className="welcome__action-hint">{a.hint}</span>
          </button>
        ))}
      </div>

      <div className="welcome__lists">
        {recentFolders.length > 0 && (
          <div className="welcome__recent">
            <h2>Recent folders</h2>
            {recentFolders.slice(0, 6).map((path) => (
              <button
                key={path}
                className="welcome__recent-item"
                title={path}
                onClick={() => void openFolder(path)}
              >
                <Icon name="folder" size={14} className="welcome__recent-icon" />
                <span className="welcome__recent-name">{basename(path)}</span>
                <span className="welcome__recent-path">{path}</span>
              </button>
            ))}
          </div>
        )}

        {recentFiles.length > 0 && (
          <div className="welcome__recent">
            <h2>Recent files</h2>
            {recentFiles.slice(0, 6).map((path) => (
              <button
                key={path}
                className="welcome__recent-item"
                title={path}
                onClick={() => void openPaths([path])}
              >
                <Icon name="file-text" size={14} className="welcome__recent-icon" />
                <span className="welcome__recent-name">{basename(path)}</span>
                <span className="welcome__recent-path">{path}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
