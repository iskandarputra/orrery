import { useCallback, useRef } from 'react'
import { basename } from '@core/paths'
import { useStore } from '@/state/store'
import { FileTree } from './FileTree'
import { Icon } from './Icon'
import { SourceControlPanel } from './SourceControlPanel'

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

/** Narrower than this and the tree is unreadable; wider and it is a document. */
const MIN_WIDTH = 160
const MAX_WIDTH = 600

/**
 * The file tree and everything that belongs to it: the workspace name, the
 * buttons that act on the tree, and the filter over it.
 *
 * Split out of `Sidebar` when the sidebar gained a second view. None of this
 * is about the sidebar — it is about files — and leaving it in the shell meant
 * the shell had to know which view it was drawing a header for.
 */
function FilesView(): React.JSX.Element {
  const rootPath = useStore((s) => s.rootPath)
  const openFolder = useStore((s) => s.openFolder)
  const collapseAllDirs = useStore((s) => s.collapseAllDirs)
  const setTreeEdit = useStore((s) => s.setTreeEdit)
  const noteIndex = useStore((s) => s.noteIndex)
  const refreshTree = useStore((s) => s.refreshTree)
  const filter = useStore((s) => s.fileTreeFilter)
  const setFilter = useStore((s) => s.setFileTreeFilter)

  return (
    <>
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
                <button
                  className="icon-btn"
                  title="Refresh files"
                  onClick={() => void refreshTree()}
                >
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
    </>
  )
}

/**
 * The sidebar itself: how wide it is, and which of its views is showing.
 *
 * Deliberately knows nothing about files or about git — a view renders its own
 * header and its own scrolling region, because the header of one is not the
 * header of the other.
 */
export function Sidebar(): React.JSX.Element | null {
  const visible = useStore((s) => s.settings.sidebar.visible)
  const view = useStore((s) => s.settings.sidebar.view)
  const width = useStore((s) => s.settings.sidebar.width)
  const setSidebarWidth = useStore((s) => s.setSidebarWidth)
  const dragging = useRef(false)
  const asideRef = useRef<HTMLElement>(null)

  /**
   * Resize by writing to the element, and save once at the end.
   *
   * The width used to be a setting written on every mouse move, which meant a
   * store update, a re-render of everything subscribed to settings, an IPC
   * message and a debounced disk write per pixel of drag. That is what made it
   * feel like it was catching up rather than following.
   */
  const startResize = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault()
      const el = asideRef.current
      if (!el) return
      dragging.current = true
      document.body.classList.add('is-resizing')
      // Where the pointer sits inside the handle, so the edge does not jump to
      // the cursor on the first pixel of movement.
      const grip = event.clientX - el.getBoundingClientRect().right
      let latest = el.getBoundingClientRect().width

      const onMove = (e: MouseEvent): void => {
        if (!dragging.current) return
        latest = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, e.clientX - grip))
        el.style.width = `${latest}px`
      }
      const onUp = (): void => {
        dragging.current = false
        document.body.classList.remove('is-resizing')
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
        setSidebarWidth(Math.round(latest))
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [setSidebarWidth]
  )

  if (!visible) return null

  return (
    <aside className="sidebar" ref={asideRef} style={{ width }}>
      {view === 'git' ? <SourceControlPanel /> : <FilesView />}
      <div className="sidebar__resizer" onMouseDown={startResize} />
    </aside>
  )
}
