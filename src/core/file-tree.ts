import type { FileNode } from '@shared/types'

/**
 * Editing a lazily-read file tree.
 *
 * The tree arrives a directory at a time, so it is a shape with holes in it: a
 * directory with no `children` has not been read, which is not the same as a
 * directory with none. Everything here preserves that distinction, and returns
 * a new tree rather than mutating the old one, because the renderer's state is
 * compared by identity to decide what to redraw.
 */

/** Replace one directory's children, leaving the rest of the tree alone. */
export function withChildren(tree: FileNode, dirPath: string, children: FileNode[]): FileNode {
  if (tree.path === dirPath) return { ...tree, children }
  if (!tree.children) return tree

  let changed = false
  const next = tree.children.map((child) => {
    if (child.kind !== 'directory') return child
    // Only walk into the branch that contains the target: a vault can be deep,
    // and rebuilding every sibling on every expansion is work nobody sees.
    if (!isInside(dirPath, child.path)) return child
    const updated = withChildren(child, dirPath, children)
    if (updated !== child) changed = true
    return updated
  })
  return changed ? { ...tree, children: next } : tree
}

/** Every directory whose children have been read, deepest last. */
export function loadedDirs(tree: FileNode | null): string[] {
  const found: string[] = []
  const walk = (node: FileNode): void => {
    if (node.kind !== 'directory' || !node.children) return
    found.push(node.path)
    node.children.forEach(walk)
  }
  if (tree) walk(tree)
  return found
}

/** The directory a path sits in, in the same separator style it arrived in. */
export function parentDir(filePath: string): string {
  const cut = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'))
  return cut <= 0 ? filePath : filePath.slice(0, cut)
}

/** Whether `path` is `dir` itself or somewhere beneath it. */
export function isInside(path: string, dir: string): boolean {
  if (path === dir) return true
  const prefix = dir.endsWith('/') || dir.endsWith('\\') ? dir : `${dir}/`
  return path.startsWith(prefix) || path.startsWith(prefix.replace(/\/$/, '\\'))
}
