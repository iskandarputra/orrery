import { fileIcon, folderIcon } from '@core/file-icons'
import { Icon } from './Icon'

/**
 * The icon for a file or a folder, drawn as its own language's mark.
 *
 * The marks are vendored SVGs under `assets/file-icons`, fetched by
 * `scripts/sync-file-icons.mjs` and committed. They are inlined into the bundle
 * at build time rather than loaded as files: a tree row is drawn hundreds of
 * times while somebody scrolls, and seventy requests for seventy small files is
 * a worse trade than thirty-four kilobytes of markup.
 *
 * A file whose type has no mark falls back to the app's own stroke glyph in the
 * language's colour, which is what every file used to get.
 */

/**
 * Every vendored mark, read at build time.
 *
 * `eager` because the alternative is a suspense boundary per row for an icon
 * that is already in the bundle, and `?raw` because what is wanted is the
 * markup rather than a URL to fetch it from.
 */
const SOURCES = import.meta.glob('../assets/file-icons/*.svg', {
  query: '?raw',
  import: 'default',
  eager: true
}) as Record<string, string>

/** What each mark draws, and the grid it was drawn on. */
interface Mark {
  viewBox: string
  inner: string
}

const MARKS: Record<string, Mark> = {}

for (const [path, source] of Object.entries(SOURCES)) {
  const name = path.slice(path.lastIndexOf('/') + 1, -'.svg'.length)
  // Upstream draws on a 16, 24 or 32 grid depending on the icon's age, so the
  // box it was drawn on is carried through rather than assumed — scaling one
  // icon by the wrong factor is how you get a whale that fills the row.
  const viewBox = /viewBox="([^"]+)"/.exec(source)?.[1]
  const inner = source.slice(source.indexOf('>') + 1, source.lastIndexOf('</svg>'))
  if (viewBox) MARKS[name] = { viewBox, inner }
}

/** The marks that were found, for the test that holds the two lists together. */
export function hasMark(name: string): boolean {
  return name in MARKS
}

function drawMark(mark: Mark, size: number, className?: string): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox={mark.viewBox}
      className={className}
      aria-hidden="true"
      // The markup is a build-time constant from a file in this repository, not
      // anything a document or a file name can reach.
      dangerouslySetInnerHTML={{ __html: mark.inner }}
    />
  )
}

export function FileTypeIcon({
  fileName,
  size = 14,
  className
}: {
  fileName: string
  size?: number
  className?: string
}): React.JSX.Element {
  const icon = fileIcon(fileName)
  const mark = icon.brand ? MARKS[icon.brand] : undefined
  if (mark) return drawMark(mark, size, className)
  return (
    <Icon
      name={icon.shape}
      size={size}
      className={className}
      // The language's own colour. Left unset for prose and unknown files so
      // they take the tree's colour and the coloured ones stand out.
      {...(icon.colour ? { style: { color: icon.colour } } : {})}
    />
  )
}

export function FolderTypeIcon({
  folderName,
  size = 15,
  className
}: {
  folderName: string
  size?: number
  className?: string
}): React.JSX.Element {
  const mark = MARKS[folderIcon(folderName)] ?? MARKS['folder-base']
  // Every folder has a mark, and `file-icons.test.ts` holds that to be true.
  // A tree that lost its icons is still a tree, so this draws the house glyph
  // rather than nothing at all.
  return mark ? (
    drawMark(mark, size, className)
  ) : (
    <Icon name="folder" size={size} className={className} />
  )
}
