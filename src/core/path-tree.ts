/**
 * Grouping a flat list of paths into folders, for the "view as tree" mode.
 *
 * Git hands every UI the same thing — a list of full paths — and a flat list is
 * the honest rendering of it right up until a change touches thirty files in
 * six directories, at which point the shared prefixes are all a reader sees.
 *
 * Generic over what hangs off a leaf: this module knows about paths and nothing
 * else, so the same tree carries a working-tree change with its stage button
 * and a commit's file with its status letter, and neither leaks in here.
 */

export interface PathTreeFile<T> {
  kind: 'file'
  /** The full path, as it arrived — what a click still needs to act on. */
  path: string
  /** The last segment, which is all the row shows. */
  name: string
  item: T
}

export interface PathTreeDir<T> {
  kind: 'directory'
  /** The full path of the deepest segment in the row, for a stable key. */
  path: string
  /** The segments this row stands for, joined: `src/renderer/components`. */
  name: string
  children: PathTreeNode<T>[]
}

export type PathTreeNode<T> = PathTreeDir<T> | PathTreeFile<T>

/** A directory mid-build: a map keeps insertion cheap, sorting comes after. */
interface Building<T> {
  dirs: Map<string, Building<T>>
  files: PathTreeFile<T>[]
}

const emptyDir = <T>(): Building<T> => ({ dirs: new Map(), files: [] })

/**
 * Nest `items` by the directories in their paths.
 *
 * Separators are forward slashes because these paths come from git, which uses
 * them on every platform.
 */
export function buildPathTree<T>(items: T[], getPath: (item: T) => string): PathTreeNode<T>[] {
  const root = emptyDir<T>()

  for (const item of items) {
    const path = getPath(item)
    // A trailing or doubled slash would otherwise become a directory named "".
    const segments = path.split('/').filter((segment) => segment !== '')
    const name = segments.pop()
    if (name === undefined) continue

    let dir = root
    for (const segment of segments) {
      let next = dir.dirs.get(segment)
      if (!next) {
        next = emptyDir<T>()
        dir.dirs.set(segment, next)
      }
      dir = next
    }
    dir.files.push({ kind: 'file', path, name, item })
  }

  return childrenOf(root, '')
}

/** One level, ordered the way every file tree orders one: folders, then files. */
function childrenOf<T>(dir: Building<T>, prefix: string): PathTreeNode<T>[] {
  const dirs = [...dir.dirs].map(([name, child]) =>
    compact(name, child, prefix === '' ? name : `${prefix}/${name}`)
  )
  dirs.sort((a, b) => a.name.localeCompare(b.name))
  const files = [...dir.files].sort((a, b) => a.name.localeCompare(b.name))
  return [...dirs, ...files]
}

/**
 * Fold a chain of directories that each hold only the next one into a single row.
 *
 * `src` → `renderer` → `components` is three rows of which two say nothing on
 * their own, and in a panel this narrow the indent alone would eat the names.
 * The chain stops as soon as a directory holds a file or branches, because at
 * that point each level is a real choice about where to look.
 */
function compact<T>(name: string, dir: Building<T>, path: string): PathTreeDir<T> {
  if (dir.files.length === 0 && dir.dirs.size === 1) {
    const [childName, child] = [...dir.dirs][0]!
    return compact(`${name}/${childName}`, child, `${path}/${childName}`)
  }
  return { kind: 'directory', name, path, children: childrenOf(dir, path) }
}
