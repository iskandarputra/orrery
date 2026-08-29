/**
 * Which tabs exist, which is showing, and in which pane.
 *
 * Pulled out of the store because it is a set of decisions, not a set of
 * effects: closing a tab has to choose the next one, keep the panes from
 * becoming holes, and make sure whatever is active is actually on screen. Each
 * of those is a rule with edges — closing the last tab, closing the one in the
 * pane you are not looking at, closing a tab that is not active — and none of
 * them was reachable from a unit test while it lived inside a `set()` callback.
 *
 * Panes are a list rather than a pair. Two was a limit nobody asked for: a note
 * beside the code it describes beside the test that pins it is three, and the
 * rules do not change with the count.
 *
 * Everything here is total and pure: given a layout it returns a layout, and an
 * id that is not in the layout is not an error, because the caller races with a
 * file being deleted underneath it.
 */

/** How many panes are worth having open. Beyond this each is too narrow to read. */
export const MAX_PANES = 4

export interface TabLayout {
  /** Tabs left to right. The order the tab bar draws. */
  tabOrder: string[]
  /** The buffer the user is editing, always one of `paneIds` when non-null. */
  activeId: string | null
  /** What each pane shows, left to right. Never empty. */
  paneIds: (string | null)[]
  /** Index into `paneIds`. Always addresses a pane that exists. */
  focusedPane: number
}

/**
 * Put a layout back into a state the rest of the app can rely on.
 *
 * Empty panes are dropped, because a column showing nothing beside one showing
 * a file is a rendering of a bookkeeping mistake. One pane always remains, even
 * when it is empty, so there is somewhere for the next file to open. The
 * focused index is clamped, and whatever is active is given a pane if it has
 * none — a tab that is active and invisible is the worst of both.
 *
 * Exported because restoring a saved workspace builds a layout from paths that
 * may no longer resolve, and it needs the same rules rather than its own.
 */
export function settle(layout: TabLayout): TabLayout {
  const kept = layout.paneIds.filter((id) => id !== null)
  const paneIds: (string | null)[] = kept.length > 0 ? kept : [null]
  let focusedPane = Math.min(Math.max(0, layout.focusedPane), paneIds.length - 1)

  let activeId = layout.activeId
  if (activeId !== null && !paneIds.includes(activeId)) {
    paneIds[focusedPane] = activeId
  }
  if (activeId === null) {
    activeId = paneIds[focusedPane] ?? null
  } else {
    // Focus follows what is active, so the two never disagree about which pane
    // the user is in.
    const at = paneIds.indexOf(activeId)
    if (at !== -1) focusedPane = at
  }
  return { ...layout, paneIds, focusedPane, activeId }
}

/**
 * Close a tab.
 *
 * The successor is the tab that slides into its place, not the one before it:
 * closing the third of five leaves you on the new third, which is where you
 * were looking. Closing the last leaves you on the new last.
 */
export function closeTab(layout: TabLayout, id: string): TabLayout {
  const index = layout.tabOrder.indexOf(id)
  if (index === -1) return layout

  const tabOrder = layout.tabOrder.filter((t) => t !== id)
  const paneIds = layout.paneIds.map((pane) => (pane === id ? null : pane))

  let activeId = layout.activeId
  if (activeId === id) {
    // A surviving pane wins over the tab order. Closing one half of a split
    // should leave you looking at the other half — picking the next tab instead
    // would drop a file you had deliberately put on screen and replace it with
    // one you never asked for.
    activeId =
      paneIds.find((pane) => pane !== null) ??
      tabOrder[Math.min(index, tabOrder.length - 1)] ??
      null
  }
  return settle({ ...layout, tabOrder, paneIds, activeId })
}

/**
 * Show a tab.
 *
 * If it is already open in another pane, focus moves there rather than opening
 * it twice — two editors over one buffer would give it two diverging histories,
 * and an undo in one would not be an undo in the other.
 */
export function activate(layout: TabLayout, id: string): TabLayout {
  if (!layout.tabOrder.includes(id)) return layout

  const already = layout.paneIds.indexOf(id)
  if (already !== -1) return { ...layout, activeId: id, focusedPane: already }

  const paneIds = [...layout.paneIds]
  paneIds[layout.focusedPane] = id
  return settle({ ...layout, activeId: id, paneIds })
}

/**
 * A new pane to the right of the focused one, showing another tab.
 *
 * Beside rather than at the end: splitting is a statement about the pane you
 * are in, and a new column appearing at the far right would not be.
 *
 * `id` names the tab to move there — the one whose menu was used. Without it
 * the first tab that is not already on screen goes, which is what the keyboard
 * split means. Either way a tab already visible cannot be chosen: one buffer in
 * two editors is two histories of the same file.
 */
export function splitRight(layout: TabLayout, id?: string): TabLayout {
  if (layout.paneIds.length >= MAX_PANES) return layout
  const beside =
    id === undefined
      ? (layout.tabOrder.find((tab) => !layout.paneIds.includes(tab)) ?? null)
      : layout.tabOrder.includes(id) && !layout.paneIds.includes(id)
        ? id
        : null
  if (beside === null) return layout

  const paneIds = [...layout.paneIds]
  paneIds.splice(layout.focusedPane + 1, 0, beside)
  return settle({ ...layout, paneIds, focusedPane: layout.focusedPane + 1, activeId: beside })
}

/**
 * Close one pane, leaving its tab open.
 *
 * The tab stays in the bar: closing a column is a statement about the layout,
 * not about the file, and losing unsaved work to a layout change would be
 * indefensible.
 */
export function closePane(layout: TabLayout, index: number): TabLayout {
  if (layout.paneIds.length <= 1) return layout
  if (index < 0 || index >= layout.paneIds.length) return layout
  const paneIds = layout.paneIds.filter((_, i) => i !== index)
  const focusedPane = Math.min(layout.focusedPane, paneIds.length - 1)
  return settle({ ...layout, paneIds, focusedPane, activeId: paneIds[focusedPane] ?? null })
}

/** Split in two, or collapse back to one keeping whichever pane you were in. */
export function toggleSplit(layout: TabLayout): TabLayout {
  if (layout.paneIds.length > 1) {
    const kept = layout.paneIds[layout.focusedPane] ?? layout.paneIds[0] ?? null
    return settle({ ...layout, paneIds: [kept], focusedPane: 0, activeId: kept })
  }
  return splitRight(layout)
}

/** Move focus to a pane. An empty pane cannot take focus. */
export function focusPane(layout: TabLayout, pane: number): TabLayout {
  const id = layout.paneIds[pane]
  if (id === undefined || id === null) return layout
  return { ...layout, focusedPane: pane, activeId: id }
}

/** The next pane along, wrapping at the end. */
export function focusNextPane(layout: TabLayout): TabLayout {
  if (layout.paneIds.length <= 1) return layout
  return focusPane(layout, (layout.focusedPane + 1) % layout.paneIds.length)
}

/** Every tab but this one, in tab order. */
export function otherTabs(layout: TabLayout, id: string): string[] {
  return layout.tabOrder.filter((t) => t !== id)
}

/** The tabs to the right of this one. Empty if it is the last, or absent. */
export function tabsToRight(layout: TabLayout, id: string): string[] {
  const index = layout.tabOrder.indexOf(id)
  return index === -1 ? [] : layout.tabOrder.slice(index + 1)
}
