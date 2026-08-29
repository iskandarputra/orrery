import { basename, dirname } from '@core/paths'
import { fileIcon } from '@core/file-icons'
import { useStore } from '@/state/store'
import { Icon } from './Icon'
import { EmptyState } from './PanelBits'

/**
 * Files pinned on purpose.
 *
 * Distinct from recent files, which the app decides for you. A bookmark is a
 * statement that this one matters, so it stays until it is unpinned.
 */
export function BookmarksBody(): React.JSX.Element {
  const bookmarks = useStore((s) => s.settings.bookmarks)
  const toggleBookmark = useStore((s) => s.toggleBookmark)
  const openPaths = useStore((s) => s.openPaths)
  const rootPath = useStore((s) => s.rootPath)

  if (bookmarks.length === 0)
    return (
      <EmptyState icon="bookmark">
        Nothing pinned. Right-click a file in the tree or a tab to bookmark it.
      </EmptyState>
    )

  /** Shown relative to the vault, which is how anyone thinks about their notes. */
  const shown = (path: string): string =>
    rootPath && path.startsWith(`${rootPath}/`) ? path.slice(rootPath.length + 1) : path

  return (
    <div className="bookmarks">
      <div className="rpanel-count">
        <span className="rpanel-count__badge">{bookmarks.length}</span> pinned
      </div>
      {bookmarks.map((path) => {
        const icon = fileIcon(basename(path))
        return (
          <div className="bookmarks__row" key={path}>
            <button className="bookmarks__open" title={path} onClick={() => void openPaths([path])}>
              <Icon
                name={icon.shape}
                size={13}
                {...(icon.colour ? { style: { color: icon.colour } } : {})}
              />
              <span className="bookmarks__name">{basename(path)}</span>
              <span className="bookmarks__dir">{dirname(shown(path))}</span>
            </button>
            <button
              className="bookmarks__drop"
              aria-label={`Remove bookmark for ${basename(path)}`}
              title="Remove bookmark"
              onClick={() => toggleBookmark(path)}
            >
              <Icon name="x" size={12} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
