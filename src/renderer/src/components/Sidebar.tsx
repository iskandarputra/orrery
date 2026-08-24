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
      <div className="sidebar__empty-icon-wrap">
        <Icon name="folder-open" size={32} className="sidebar__empty-icon" />
      </div>
      <h3 className="sidebar__empty-title">No Folder Open</h3>
      <p className="sidebar__empty-desc">Open a folder to browse and edit your markdown notes.</p>
      <button className="btn btn--primary" onClick={() => void openFolder()}>
        <Icon name="folder" size={14} />
        Open Folder
      </button>
      {recentFolders.length > 0 && (
        <div className="sidebar__recent">
          <span className="sidebar__recent-title">Recent Folders</span>
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
  const toggleGraph = useStore((s) => s.toggleGraph)
  const openPalette = useStore((s) => s.openPalette)
  const setTreeEdit = useStore((s) => s.setTreeEdit)
  const noteIndex = useStore((s) => s.noteIndex)
  const refreshTree = useStore((s) => s.refreshTree)
  const filter = useStore((s) => s.fileTreeFilter)
  const setFilter = useStore((s) => s.setFileTreeFilter)
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
        <div className="sidebar__header-top">
          <div className="sidebar__workspace-info">
            <span className="sidebar__eyebrow">Workspace</span>
            <div className="sidebar__title-row">
              <span
                className={`sidebar__title${rootPath ? '' : ' sidebar__title--empty'}`}
                title={rootPath ?? undefined}
              >
                {rootPath ? basename(rootPath) : 'No folder open'}
              </span>
              {rootPath && noteIndex.length > 0 && (
                <span className="sidebar__count-badge" title={`${noteIndex.length} notes in vault`}>
                  {noteIndex.length}
                </span>
              )}
            </div>
          </div>
          <div className="sidebar__actions">
            {rootPath && (
              <>
                <button
                  className="icon-btn"
                  title="New note (Ctrl+N)"
                  onClick={() => setTreeEdit({ type: 'create-file', dirPath: rootPath })}
                >
                  <Icon name="file-plus" size={14} />
                </button>
                <button
                  className="icon-btn"
                  title="New folder"
                  onClick={() => setTreeEdit({ type: 'create-dir', dirPath: rootPath })}
                >
                  <Icon name="folder-plus" size={14} />
                </button>
                <button className="icon-btn" title="Collapse all folders" onClick={collapseAllDirs}>
                  <Icon name="collapse-all" size={14} />
                </button>
                <button className="icon-btn" title="Refresh files" onClick={() => void refreshTree()}>
                  <Icon name="refresh" size={14} />
                </button>
              </>
            )}
            <button className="icon-btn" title="Open folder…" onClick={() => void openFolder()}>
              <Icon name="folder" size={14} />
            </button>
          </div>
        </div>

        {/* Real-time file filter input */}
        {rootPath && (
          <div className="sidebar__filter-wrap">
            <Icon name="search" size={12} className="sidebar__filter-icon" />
            <input
              type="text"
              className="sidebar__filter-input"
              placeholder="Filter notes…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setFilter('')
              }}
            />
            {filter && (
              <button
                className="sidebar__filter-clear"
                title="Clear filter (Esc)"
                onClick={() => setFilter('')}
              >
                <Icon name="x" size={11} />
              </button>
            )}
          </div>
        )}
      </div>

      <div className="sidebar__scroll">{rootPath ? <FileTree /> : <SidebarEmpty />}</div>

      <div className="sidebar__footer">
        <div className="sidebar__footer-nav">
          <button
            className="sidebar__footer-btn"
            title="Search notes or commands (Ctrl+P)"
            onClick={() => openPalette('files')}
          >
            <Icon name="search" size={14} />
            <span>Search</span>
          </button>
          <button
            className="sidebar__footer-btn"
            title="Open Graph View (Ctrl+Shift+G)"
            onClick={toggleGraph}
          >
            <Icon name="diagram" size={14} />
            <span>Graph</span>
          </button>
          <button
            className="sidebar__footer-btn"
            title="Preferences (Ctrl+,)"
            onClick={openSettings}
          >
            <Icon name="gear" size={14} />
            <span>Settings</span>
          </button>
        </div>
      </div>

      <div className="sidebar__resizer" onMouseDown={startResize} />
    </aside>
  )
}
