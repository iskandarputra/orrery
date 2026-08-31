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
  run(): void
}

export function SidebarRail(): React.JSX.Element {
  const visible = useStore((s) => s.settings.sidebar.visible)
  const toggleSidebar = useStore((s) => s.toggleSidebar)
  const openPalette = useStore((s) => s.openPalette)
  const toggleGraph = useStore((s) => s.toggleGraph)
  const openSettings = useStore((s) => s.openSettings)
  const setSidePanel = useStore((s) => s.setSidePanel)

  const items: RailItem[] = [
    {
      id: 'files',
      label: visible ? 'Hide files (Ctrl+B)' : 'Show files (Ctrl+B)',
      icon: 'folder',
      active: visible,
      run: toggleSidebar
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
        </button>
      ))}
    </nav>
  )
}
