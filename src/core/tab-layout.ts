/**
 * Which tabs exist, which is showing, and in which pane.
 *
 * Pulled out of the store because it is a set of decisions, not a set of
 * effects: closing a tab has to choose the next one, keep the left pane from
 * becoming a hole, and make sure whatever is active is actually on screen. Each
 * of those is a rule with edges — closing the last tab, closing the one in the
 * right pane, closing a tab that is not the active one — and none of them was
 * reachable from a unit test while it lived inside a `set()` callback.
 *
 * Everything here is total and pure: given a layout it returns a layout, and an
 * id that is not in the layout is not an error, because the caller races with a
 * file being deleted underneath it.
 */

export type PaneIndex = 0 | 1

export interface TabLayout {
  /** Tabs left to right. The order the tab bar draws. */
  tabOrder: string[]
  /** The buffer the user is editing, always one of `paneIds` when non-null. */
  activeId: string | null
  /** What each pane shows. `[x, null]` is unsplit. */
  paneIds: [string | null, string | null]
  focusedPane: PaneIndex
}

const other = (pane: PaneIndex): PaneIndex => (pane === 0 ? 1 : 0)

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
  const paneIds: [string | null, string | null] = [
    layout.paneIds[0] === id ? null : layout.paneIds[0],
    layout.paneIds[1] === id ? null : layout.paneIds[1]
  ]
  // Never leave a hole on the left; slide the survivor over.
  if (paneIds[0] === null && paneIds[1] !== null) {
    paneIds[0] = paneIds[1]
    paneIds[1] = null
  }

  let activeId = layout.activeId
  if (activeId === id) {
    // A surviving pane wins over the tab order. Closing the left half of a
    // split should leave you looking at the right half — picking the next tab
    // instead would drop a file you had deliberately put on screen and replace
    // it with one you never asked for.
    activeId =
      paneIds.find((pane) => pane !== null) ??
      tabOrder[Math.min(index, tabOrder.length - 1)] ??
      null
  }
  // Whatever is active has to be somewhere it can be seen.
  if (activeId && !paneIds.includes(activeId)) paneIds[0] = activeId

  return { tabOrder, activeId, paneIds, focusedPane: 0 }
}

/**
 * Show a tab.
 *
 * If it is already open in the other pane, focus moves there rather than
 * opening it twice — two editors over one buffer would give it two diverging
 * histories, and an undo in one would not be an undo in the other.
 */
export function activate(layout: TabLayout, id: string): TabLayout {
  if (!layout.tabOrder.includes(id)) return layout

  const away = other(layout.focusedPane)
  if (layout.paneIds[away] === id) {
    return { ...layout, activeId: id, focusedPane: away }
  }
  const paneIds: [string | null, string | null] = [...layout.paneIds]
  paneIds[layout.focusedPane] = id
  return { ...layout, activeId: id, paneIds }
}

/** Split in two, or collapse back to one keeping whichever pane you were in. */
export function toggleSplit(layout: TabLayout): TabLayout {
  if (layout.paneIds[1] !== null) {
    const kept = layout.paneIds[layout.focusedPane] ?? layout.paneIds[0]
    return { ...layout, paneIds: [kept, null], focusedPane: 0, activeId: kept }
  }
  const beside = layout.tabOrder.find((id) => id !== layout.paneIds[0]) ?? null
  return { ...layout, paneIds: [layout.paneIds[0], beside] }
}

/** Move focus to a pane. An empty pane cannot take focus. */
export function focusPane(layout: TabLayout, pane: PaneIndex): TabLayout {
  const id = layout.paneIds[pane]
  if (id === null) return layout
  return { ...layout, focusedPane: pane, activeId: id }
}

export function focusOtherPane(layout: TabLayout): TabLayout {
  return focusPane(layout, other(layout.focusedPane))
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
