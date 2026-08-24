import { useCallback, useRef } from 'react'
import { basename } from '@core/paths'
import { useStore } from '@/state/store'
import { FileTree } from './FileTree'
import { Icon } from './Icon'

/** Empty-workspace state: open a folder, or jump back to a recent one. */
function SidebarEmpty(): React.JSX.Element {
  const openFolder = useStore((s) => s.openFolder)
  const recentFolders = useStore((s) => s.settings.recentFolders)
  return (
    <div className="sidebar__empty">
      <Icon name="folder-open" size={28} className="sidebar__empty-icon" />
      <p>Open a folder to browse and edit its markdown files.</p>
      <button className="btn btn--primary" onClick={() => void openFolder()}>
        Open Folder
      </button>
      {recentFolders.length > 0 && (
        <div className="sidebar__recent">
          <span className="sidebar__recent-title">Recent</span>
          {recentFolders.slice(0, 6).map((path) => (
            <button
              key={path}
              className="sidebar__recent-item"
              title={path}
              onClick={() => void openFolder(path)}
            >
              <Icon name="folder" size={14} className="tree-icon" />
              <span className="tree-label">{basename(path)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function Sidebar(): React.JSX.Element | null {
  const visible = useStore((s) => s.settings.sidebar.visible)
  const width = useStore((s) => s.settings.sidebar.width)
  const rootPath = useStore((s) => s.rootPath)
  const openFolder = useStore((s) => s.openFolder)
  const setSidebarWidth = useStore((s) => s.setSidebarWidth)
  const collapseAllDirs = useStore((s) => s.collapseAllDirs)
  const openSettings = useStore((s) => s.openSettings)
  const setTreeEdit = useStore((s) => s.setTreeEdit)
  const dragging = useRef(false)

  const startResize = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault()
      dragging.current = true
      document.body.classList.add('is-resizing')
      const onMove = (e: MouseEvent): void => {
        if (dragging.current) setSidebarWidth(Math.min(600, Math.max(160, e.clientX)))
      }
      const onUp = (): void => {
        dragging.current = false
        document.body.classList.remove('is-resizing')
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [setSidebarWidth]
  )

  if (!visible) return null

  return (
    <aside className="sidebar" style={{ width }}>
      <div className="sidebar__header">
        <span className="sidebar__eyebrow">Workspace</span>
        <div className="sidebar__header-row">
          <span
            className={`sidebar__title${rootPath ? '' : ' sidebar__title--empty'}`}
            title={rootPath ?? undefined}
          >
            {rootPath ? basename(rootPath) : 'No folder open'}
          </span>
          <div className="sidebar__actions">
            {rootPath && (
              <>
                <button
                  className="icon-btn"
                  title="New file"
                  onClick={() => setTreeEdit({ type: 'create-file', dirPath: rootPath })}
                >
                  <Icon name="file-plus" size={15} />
                </button>
                <button
                  className="icon-btn"
                  title="New folder"
                  onClick={() => setTreeEdit({ type: 'create-dir', dirPath: rootPath })}
                >
                  <Icon name="folder-plus" size={15} />
                </button>
                <button className="icon-btn" title="Collapse folders" onClick={collapseAllDirs}>
                  <Icon name="collapse-all" size={15} />
                </button>
              </>
            )}
            <button className="icon-btn" title="Open folder…" onClick={() => void openFolder()}>
              <Icon name="folder" size={15} />
            </button>
          </div>
        </div>
      </div>

      <div className="sidebar__scroll">{rootPath ? <FileTree /> : <SidebarEmpty />}</div>

      <div className="sidebar__footer">
        <button className="sidebar__footer-btn" onClick={openSettings}>
          <Icon name="gear" size={15} />
          Settings
        </button>
      </div>

      <div className="sidebar__resizer" onMouseDown={startResize} />
    </aside>
  )
}
