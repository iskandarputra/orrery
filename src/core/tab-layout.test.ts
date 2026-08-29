import { describe, expect, it } from 'vitest'
import {
  activate,
  closePane,
  closeTab,
  focusNextPane,
  focusPane,
  MAX_PANES,
  otherTabs,
  splitRight,
  tabsToRight,
  toggleSplit,
  type TabLayout
} from './tab-layout'

const layout = (over: Partial<TabLayout> = {}): TabLayout => ({
  tabOrder: ['a', 'b', 'c'],
  activeId: 'b',
  paneIds: ['b'],
  focusedPane: 0,
  ...over
})

describe('closeTab', () => {
  it('moves to the tab that takes its place, not the one before it', () => {
    // Closing the middle of three leaves you on the new middle, which is where
    // you were looking.
    const after = closeTab(layout(), 'b')
    expect(after.tabOrder).toEqual(['a', 'c'])
    expect(after.activeId).toBe('c')
  })

  it('moves left when the last tab closes', () => {
    expect(closeTab(layout({ activeId: 'c', paneIds: ['c'] }), 'c').activeId).toBe('b')
  })

  it('leaves one empty pane when the last tab of all closes', () => {
    const after = closeTab(layout({ tabOrder: ['a'], activeId: 'a', paneIds: ['a'] }), 'a')
    expect(after.tabOrder).toEqual([])
    expect(after.activeId).toBeNull()
    // Somewhere for the next file to open.
    expect(after.paneIds).toEqual([null])
  })

  it('keeps the active tab when a different one closes', () => {
    expect(closeTab(layout(), 'a').activeId).toBe('b')
  })

  it('drops the pane rather than leaving a column showing nothing', () => {
    const after = closeTab(layout({ paneIds: ['a', 'c'], activeId: 'a' }), 'a')
    expect(after.paneIds).toEqual(['c'])
    // The surviving pane wins over the tab order: you were looking at `c`.
    expect(after.activeId).toBe('c')
  })

  it('closes a pane in the middle of three', () => {
    const after = closeTab(layout({ paneIds: ['a', 'b', 'c'], activeId: 'b' }), 'b')
    expect(after.paneIds).toEqual(['a', 'c'])
  })

  it('ignores a tab that is not open', () => {
    expect(closeTab(layout(), 'zzz')).toEqual(layout())
  })
})

describe('activate', () => {
  it('shows the tab in the focused pane', () => {
    expect(activate(layout(), 'c').paneIds).toEqual(['c'])
  })

  it('moves focus instead of opening the same buffer twice', () => {
    // Two editors over one buffer would give it two diverging histories.
    const after = activate(layout({ paneIds: ['a', 'c'], focusedPane: 0, activeId: 'a' }), 'c')
    expect(after.focusedPane).toBe(1)
    expect(after.paneIds).toEqual(['a', 'c'])
  })

  it('finds it in the third pane just as well as the second', () => {
    const three = layout({ paneIds: ['a', 'b', 'c'], focusedPane: 0, activeId: 'a' })
    expect(activate(three, 'c').focusedPane).toBe(2)
  })

  it('ignores a tab that is not open', () => {
    expect(activate(layout(), 'zzz')).toEqual(layout())
  })
})

describe('splitRight', () => {
  it('opens a pane beside the focused one, not at the end', () => {
    // Splitting is a statement about the pane you are in.
    const three = layout({ paneIds: ['a', 'c'], focusedPane: 0, activeId: 'a' })
    expect(splitRight(three).paneIds).toEqual(['a', 'b', 'c'])
    expect(splitRight(three).focusedPane).toBe(1)
  })

  it('shows a tab that is not already on screen', () => {
    expect(splitRight(layout()).paneIds).toEqual(['b', 'a'])
  })

  it('moves the tab it is given, not the first one free', () => {
    expect(splitRight(layout(), 'c').paneIds).toEqual(['b', 'c'])
  })

  it('refuses a tab that is already in a pane, which would split its history', () => {
    const two = layout({ paneIds: ['a', 'b'], activeId: 'a', focusedPane: 0 })
    expect(splitRight(two, 'b')).toEqual(two)
  })

  it('refuses a tab that is not open', () => {
    expect(splitRight(layout(), 'zzz')).toEqual(layout())
  })

  it('refuses when every tab is already shown', () => {
    const all = layout({ paneIds: ['a', 'b', 'c'], activeId: 'a', focusedPane: 0 })
    expect(splitRight(all)).toEqual(all)
  })

  it('stops at the maximum, past which a pane is too narrow to read', () => {
    let current = layout({ tabOrder: ['a', 'b', 'c', 'd', 'e'], paneIds: ['a'], activeId: 'a' })
    for (let i = 0; i < 10; i++) current = splitRight(current)
    expect(current.paneIds).toHaveLength(MAX_PANES)
  })
})

describe('closePane', () => {
  it('closes a pane and keeps its tab open', () => {
    // Closing a column is a statement about the layout, not about the file.
    const after = closePane(layout({ paneIds: ['a', 'b'], activeId: 'a' }), 1)
    expect(after.paneIds).toEqual(['a'])
    expect(after.tabOrder).toContain('b')
  })

  it('refuses to close the only pane', () => {
    const one = layout()
    expect(closePane(one, 0)).toEqual(one)
  })

  it('ignores an index that is not a pane', () => {
    const two = layout({ paneIds: ['a', 'b'], activeId: 'a' })
    expect(closePane(two, 5)).toEqual(two)
  })

  it('keeps focus inside the panes that remain', () => {
    const after = closePane(layout({ paneIds: ['a', 'b'], focusedPane: 1, activeId: 'b' }), 1)
    expect(after.focusedPane).toBe(0)
    expect(after.activeId).toBe('a')
  })
})

describe('toggleSplit', () => {
  it('opens a second pane', () => {
    expect(toggleSplit(layout()).paneIds).toEqual(['b', 'a'])
  })

  it('splits to nothing when there is only one tab', () => {
    const one = layout({ tabOrder: ['a'], paneIds: ['a'], activeId: 'a' })
    expect(toggleSplit(one).paneIds).toEqual(['a'])
  })

  it('collapsing keeps the pane you were in', () => {
    const after = toggleSplit(layout({ paneIds: ['a', 'c'], focusedPane: 1, activeId: 'c' }))
    expect(after.paneIds).toEqual(['c'])
    expect(after.activeId).toBe('c')
    expect(after.focusedPane).toBe(0)
  })

  it('collapses three panes to the one you were in', () => {
    const after = toggleSplit(layout({ paneIds: ['a', 'b', 'c'], focusedPane: 2, activeId: 'c' }))
    expect(after.paneIds).toEqual(['c'])
  })
})

describe('focus', () => {
  it('moves between panes', () => {
    const split = layout({ paneIds: ['a', 'c'], focusedPane: 0, activeId: 'a' })
    expect(focusPane(split, 1)).toMatchObject({ focusedPane: 1, activeId: 'c' })
  })

  it('wraps at the end', () => {
    const three = layout({ paneIds: ['a', 'b', 'c'], focusedPane: 2, activeId: 'c' })
    expect(focusNextPane(three).focusedPane).toBe(0)
  })

  it('does nothing with one pane', () => {
    expect(focusNextPane(layout())).toEqual(layout())
  })

  it('refuses a pane that is not there', () => {
    expect(focusPane(layout(), 3)).toEqual(layout())
  })
})

describe('tab ranges', () => {
  it('lists the others and the ones to the right', () => {
    expect(otherTabs(layout(), 'b')).toEqual(['a', 'c'])
    expect(tabsToRight(layout(), 'a')).toEqual(['b', 'c'])
    expect(tabsToRight(layout(), 'c')).toEqual([])
  })

  it('reports nothing to the right of a tab that is not open', () => {
    expect(tabsToRight(layout(), 'zzz')).toEqual([])
  })
})
