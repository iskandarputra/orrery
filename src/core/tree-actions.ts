import { basename, dirname, extname } from './paths'

/**
 * The decisions behind the file tree's context menu: where a pasted file goes
 * and what it is called, what a path is relative to the vault, and which files
 * "Find in Folder" searches.
 *
 * Paths use either separator, as the rest of `core/paths` does.
 */

export type ClipboardMode = 'cut' | 'copy'

/**
 * What a drag out of the file tree carries its paths under, so a drop
 * somewhere else in the app can tell one of its rows from any other text.
 */
export const TREE_DRAG_TYPE = 'application/x-orrery-paths'

export type PastePlan =
  /** Write it to this name inside the target folder. */
  | { kind: 'paste'; name: string }
  /** Cut and pasted back where it already is: nothing to do. */
  | { kind: 'nothing' }
  | { kind: 'refused'; reason: 'into-itself' | 'exists' }

const normal = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '')

/** Whether `path` is `dir` itself or somewhere under it. */
export function isSameOrInside(path: string, dir: string): boolean {
  const p = normal(path)
  const d = normal(dir)
  // The separator in the prefix is what keeps `notes-archive` out of `notes`.
  return p === d || p.startsWith(d + '/')
}

/**
 * The name a copy takes when its own is in use: `a.md`, then `a copy.md`, then
 * `a copy 2.md`, as VS Code names them. The last extension stays at the end,
 * so `a.test.ts` becomes `a.test copy.ts`, and a name that is all extension,
 * like `.gitignore`, keeps it whole.
 */
export function copyName(name: string, taken: ReadonlySet<string>): string {
  if (!taken.has(name)) return name
  const ext = extname(name)
  const stem = ext ? name.slice(0, -ext.length) : name
  for (let n = 1; ; n++) {
    const candidate = `${stem} copy${n === 1 ? '' : ` ${n}`}${ext}`
    if (!taken.has(candidate)) return candidate
  }
}

/**
 * What pasting `from` into `toDir` should do.
 *
 * A copy never overwrites: its own folder or another, a name in use gets
 * " copy" added, which is what anyone pasting twice expects. A move is refused
 * instead, because renaming a file on its way somewhere would quietly break
 * every link to it. And neither may put a folder inside itself, which for a
 * copy would recurse until the disk was full.
 *
 * `taken` is the names already in `toDir`.
 */
export function planPaste(
  mode: ClipboardMode,
  from: string,
  toDir: string,
  taken: ReadonlySet<string>
): PastePlan {
  if (isSameOrInside(toDir, from)) return { kind: 'refused', reason: 'into-itself' }
  const name = basename(from)
  const samePlace = normal(dirname(from)) === normal(toDir)
  if (mode === 'cut') {
    if (samePlace) return { kind: 'nothing' }
    return taken.has(name) ? { kind: 'refused', reason: 'exists' } : { kind: 'paste', name }
  }
  return { kind: 'paste', name: copyName(name, taken) }
}

/** A path relative to the vault, with `/` whatever the platform; `''` for the vault itself. */
export function relativeToRoot(root: string, path: string): string {
  if (!isSameOrInside(path, root)) return normal(path)
  return normal(path).slice(normal(root).length).replace(/^\/+/, '')
}

/**
 * The search include that means "only this folder".
 *
 * Search's globs have no way to escape a character, so the two that would
 * change what the pattern means are replaced rather than passed through. A
 * comma would split it into two patterns, so it becomes `?`, which matches the
 * comma along with any other single character: a folder named `a,b` also finds
 * files under `a;b`, which is a small price against searching the wrong place.
 * `*` and `?` in a folder name already match themselves among others.
 */
export function folderInclude(relativeDir: string): string {
  const dir = normal(relativeDir).replace(/^\/+/, '')
  if (!dir) return ''
  return `${dir.replace(/,/g, '?')}/**`
}

/**
 * The folder a drop on a row means: the folder itself, or the one a file sits
 * in. Dropping onto a file is common by accident, and landing the drop beside
 * that file is what anyone aiming at it meant.
 */
export function dropDir(row: { path: string; kind: 'file' | 'directory' }): string {
  return row.kind === 'directory' ? row.path : dirname(row.path)
}

/**
 * Whether a drag of `dragged` may be dropped into `into`.
 *
 * Refused for a folder dropped into itself or into something it contains, and
 * for a move that would not move anything, so the row under the pointer says
 * so before the mouse is released. The per-file decisions, names in use
 * included, are still `planPaste`'s.
 */
export function canDropInto(
  dragged: readonly string[],
  into: string,
  mode: ClipboardMode
): boolean {
  if (dragged.length === 0) return false
  if (dragged.some((p) => isSameOrInside(into, p))) return false
  // A copy into the same folder is a duplicate, which is worth doing; a move
  // there is not.
  if (mode === 'cut' && dragged.every((p) => normal(dirname(p)) === normal(into))) return false
  return true
}
