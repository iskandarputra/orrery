/**
 * Named layouts: which files are open, in which panes, with which side panel.
 *
 * Saved by path rather than by buffer id, because ids live and die with a
 * session and a workspace is meant to outlive one. Restoring therefore has to
 * cope with a file that has since been renamed or deleted, which is why nothing
 * here throws: a workspace is a wish, and whatever of it still exists is
 * granted.
 */

import { MAX_PANES, settle, type TabLayout } from './tab-layout'
import { fitSizes } from './pane-sizes'

export interface Workspace {
  /** Every open tab, in tab-bar order. */
  openPaths: string[]
  /** What each pane showed, left to right. An empty string is an empty pane. */
  panePaths: string[]
  /** The file being edited when the workspace was saved. */
  activePath: string
  focusedPane: number
  /** Right-hand panel, or null for none. Kept loose: the names live in `shared`. */
  sidePanel: string | null
  /** Column widths, as fractions. Empty means whatever the panes default to. */
  paneSizes: number[]
}

export interface Capture {
  openPaths: string[]
  panePaths: (string | null)[]
  activePath: string | null
  focusedPane: number
  sidePanel: string | null
  paneSizes: number[]
}

/** Take a workspace from the live layout. */
export function captureWorkspace(input: Capture): Workspace {
  return {
    // Unsaved buffers have no path, so they cannot be reopened and are not
    // pretended to be. Duplicates would reopen the same file twice.
    openPaths: [...new Set(input.openPaths.filter(Boolean))],
    panePaths: input.panePaths.slice(0, MAX_PANES).map((path) => path ?? ''),
    activePath: input.activePath ?? '',
    focusedPane: Math.max(0, Math.trunc(input.focusedPane) || 0),
    sidePanel: input.sidePanel,
    paneSizes: [...input.paneSizes]
  }
}

/**
 * The files to open before the layout can be restored, in the order they should
 * become tabs.
 */
export function pathsToOpen(workspace: Workspace): string[] {
  const paths = [...workspace.openPaths]
  for (const path of [...workspace.panePaths, workspace.activePath]) {
    if (path && !paths.includes(path)) paths.push(path)
  }
  return paths
}

/**
 * Rebuild the layout once the files are open.
 *
 * `idFor` answers with the buffer now holding a path, or null if opening it
 * failed — a file deleted since the workspace was saved. Those panes collapse
 * rather than showing an empty column.
 */
/**
 * The column widths to restore, fitted to the panes that survived.
 *
 * Separate from `restoreLayout` because the layout decides how many panes there
 * are, and the widths can only be fitted once that is known.
 */
export function restoreSizes(workspace: Workspace, paneCount: number): number[] {
  return fitSizes(workspace.paneSizes, paneCount)
}

export function restoreLayout(
  workspace: Workspace,
  idFor: (path: string) => string | null
): TabLayout {
  const resolve = (path: string): string | null => (path ? idFor(path) : null)

  const tabOrder: string[] = []
  for (const path of pathsToOpen(workspace)) {
    const id = resolve(path)
    if (id !== null && !tabOrder.includes(id)) tabOrder.push(id)
  }

  const paneIds = workspace.panePaths.slice(0, MAX_PANES).map(resolve)
  return settle({
    tabOrder,
    activeId: resolve(workspace.activePath),
    paneIds: paneIds.length > 0 ? paneIds : [null],
    focusedPane: workspace.focusedPane
  })
}
