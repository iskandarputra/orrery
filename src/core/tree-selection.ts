/**
 * Selecting in the file tree: which rows are selected, and where the keyboard
 * is. Pure, over the tree's shape and the order its rows are drawn in.
 *
 * VS Code's explorer is the model, because it is the one everyone arriving
 * here has in their fingers: a click selects one, Ctrl or Cmd adds and removes,
 * Shift takes everything from the last plain click to this one, and the arrow
 * keys move one row, opening and closing folders on the way.
 */

/** Just enough of a tree node to walk: the shape `FileNode` already has. */
export interface TreeShape {
  path: string
  kind: 'file' | 'directory'
  children?: TreeShape[]
}

export interface TreeSelection {
  /** Selected rows, in the order they were chosen. */
  paths: string[]
  /** Where a Shift range starts: the last row chosen without Shift. */
  anchor: string | null
  /** The row the keyboard is on. */
  focus: string | null
}

export const EMPTY_SELECTION: TreeSelection = { paths: [], anchor: null, focus: null }

/** The rows as drawn, top to bottom: a folder, then its contents if it is open. */
export function visiblePaths(root: TreeShape, isOpen: (path: string) => boolean): string[] {
  const out: string[] = []
  const walk = (nodes: TreeShape[] | undefined): void => {
    for (const node of nodes ?? []) {
      out.push(node.path)
      if (node.kind === 'directory' && isOpen(node.path)) walk(node.children)
    }
  }
  walk(root.children)
  return out
}

/** The node at `path`, anywhere in the part of the tree that has been read. */
export function findRow<T extends TreeShape>(root: T, path: string): T | null {
  if (root.path === path) return root
  for (const child of (root.children ?? []) as T[]) {
    const found = findRow(child, path)
    if (found) return found
  }
  return null
}

/** Every row from `a` to `b` inclusive, in drawn order, whichever comes first. */
function between(order: readonly string[], a: string, b: string): string[] {
  const i = order.indexOf(a)
  const j = order.indexOf(b)
  if (i === -1 || j === -1) return [b]
  return order.slice(Math.min(i, j), Math.max(i, j) + 1)
}

/**
 * The selection after a click on `target`.
 *
 * `toggle` is Ctrl or Cmd, `range` is Shift. A range runs from the anchor, and
 * leaves the anchor where it was, so Shift-clicking further along extends or
 * shrinks the same run rather than starting a new one from each click.
 */
export function clickSelect(
  current: TreeSelection,
  target: string,
  mods: { toggle: boolean; range: boolean },
  order: readonly string[]
): TreeSelection {
  if (mods.range) {
    const anchor = current.anchor ?? target
    return { paths: between(order, anchor, target), anchor, focus: target }
  }
  if (mods.toggle) {
    const has = current.paths.includes(target)
    return {
      paths: has ? current.paths.filter((p) => p !== target) : [...current.paths, target],
      anchor: target,
      focus: target
    }
  }
  return { paths: [target], anchor: target, focus: target }
}

/**
 * The row an arrow key moves the keyboard to, or null to stay put.
 *
 * `step` is +1 for down and -1 for up; it stops at either end rather than
 * wrapping, as a list does. With no row focused yet, down starts at the top
 * and up at the bottom.
 */
export function stepFocus(
  order: readonly string[],
  focus: string | null,
  step: 1 | -1
): string | null {
  if (order.length === 0) return null
  const at = focus ? order.indexOf(focus) : -1
  if (at === -1) return step === 1 ? order[0]! : order[order.length - 1]!
  const next = at + step
  return next < 0 || next >= order.length ? null : order[next]!
}

/** The keyboard moved to `target`: Shift extends from the anchor, otherwise it selects just that row. */
export function moveSelect(
  current: TreeSelection,
  target: string,
  extend: boolean,
  order: readonly string[]
): TreeSelection {
  if (extend) return clickSelect(current, target, { toggle: false, range: true }, order)
  return { paths: [target], anchor: target, focus: target }
}

/**
 * The folder a row sits in, if that folder is itself a row: where Left goes
 * from a file or a closed folder. Null at the top level, which has no row.
 */
export function parentRow(order: readonly string[], path: string): string | null {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  if (cut <= 0) return null
  const parent = path.slice(0, cut)
  return order.includes(parent) ? parent : null
}

/**
 * The selected rows that still exist, and none that sit inside another selected
 * folder: a folder and a file in it cut together is the folder moving, and
 * moving the file first would pull it out of the folder on the way.
 */
export function topmostSelected(paths: readonly string[], order: readonly string[]): string[] {
  const present = paths.filter((p) => order.includes(p))
  return present.filter(
    (p) => !present.some((q) => q !== p && (p.startsWith(`${q}/`) || p.startsWith(`${q}\\`)))
  )
}
