import { changedFileCount } from '@core/change-totals'
import { useStore } from '@/state/store'
import { Icon, type IconName } from './Icon'

/**
 * The strip down the left edge, which outlives the sidebar it drives.
 *
 * The same bargain the right-hand rail makes: closing the panel should not cost
 * you the way back into it, or the way into anything else that lives on this
 * side. Collapsing the file tree used to leave a bare editor and a keyboard
 * shortcut you had to remember; now it leaves four icons.
 *
 * Vertical because the edge of the window is a column, and because it is the
 * shape everyone arriving from another editor already knows.
 */

interface RailItem {
  id: string
  label: string
  icon: IconName
  /** Drawn as pressed when this is what the sidebar is showing. */
  active?: boolean
  /** A count on the icon; nothing is drawn for none. */
  badge?: number
  run(): void
}

export function SidebarRail(): React.JSX.Element {
  const visible = useStore((s) => s.settings.sidebar.visible)
  const view = useStore((s) => s.settings.sidebar.view)
  const showSidebarView = useStore((s) => s.showSidebarView)
  const openPalette = useStore((s) => s.openPalette)
  const toggleGraph = useStore((s) => s.toggleGraph)
  const openSettings = useStore((s) => s.openSettings)
  const setSidePanel = useStore((s) => s.setSidePanel)

  const showingFiles = visible && view === 'files'
  const showingGit = visible && view === 'git'
  // For the vault on screen only: a count read for the last vault is not
  // about this one.
  const changed = useStore((s) =>
    s.gitStatus && s.gitStatus.rootPath === s.rootPath && s.gitStatus.isRepo
      ? changedFileCount(s.gitStatus.status)
      : 0
  )
  const changedLabel = changed ? ` (${changed} changed file${changed === 1 ? '' : 's'})` : ''

  const items: RailItem[] = [
    {
      id: 'files',
      label: showingFiles ? 'Hide files (Ctrl+B)' : 'Show files (Ctrl+B)',
      icon: 'folder',
      active: showingFiles,
      run: () => showSidebarView('files')
    },
    {
      id: 'source-control',
      // The count in the name too, so it is not only a number drawn on an icon.
      label: `${showingGit ? 'Hide Source Control' : 'Source Control'}${changedLabel}`,
      icon: 'git-branch',
      active: showingGit,
      badge: changed,
      run: () => showSidebarView('git')
    },
    {
      id: 'search',
      label: 'Search the vault (Ctrl+Shift+F)',
      icon: 'search',
      run: () => setSidePanel('search')
    },
    {
      id: 'quick-open',
      label: 'Open a file by name (Ctrl+P)',
      icon: 'file-text',
      run: () => openPalette('files')
    },
    { id: 'graph', label: 'Graph view (Ctrl+Shift+G)', icon: 'diagram', run: toggleGraph },
    { id: 'settings', label: 'Preferences (Ctrl+,)', icon: 'gear', run: openSettings }
  ]

  return (
    <nav className="sidebar-rail" aria-label="Workspace">
      {items.map((item) => (
        <button
          key={item.id}
          className={`sidebar-rail__btn${item.active ? ' sidebar-rail__btn--active' : ''}`}
          aria-label={item.label}
          aria-pressed={item.active}
          // Drawn by the element rather than by the operating system: a native
          // `title` waits about a second, which on a strip of icons is a second
          // of not knowing what anything is.
          data-tip={item.label}
          onClick={item.run}
        >
          <Icon name={item.icon} size={17} />
          {item.badge ? (
            <span className="sidebar-rail__badge" aria-hidden="true">
              {item.badge > 99 ? '99+' : item.badge}
            </span>
          ) : null}
        </button>
      ))}
    </nav>
  )
}
