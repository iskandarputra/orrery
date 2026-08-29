import { describe, expect, it } from 'vitest'
import {
  activate,
  closeTab,
  focusOtherPane,
  focusPane,
  otherTabs,
  tabsToRight,
  toggleSplit,
  type TabLayout
} from './tab-layout'

const layout = (over: Partial<TabLayout> = {}): TabLayout => ({
  tabOrder: ['a', 'b', 'c'],
  activeId: 'b',
  paneIds: ['b', null],
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
    const after = closeTab(layout({ activeId: 'c', paneIds: ['c', null] }), 'c')
    expect(after.activeId).toBe('b')
  })

  it('leaves nothing active when the last tab of all closes', () => {
    const after = closeTab(layout({ tabOrder: ['a'], activeId: 'a', paneIds: ['a', null] }), 'a')
    expect(after.tabOrder).toEqual([])
    expect(after.activeId).toBeNull()
    expect(after.paneIds).toEqual([null, null])
  })

  it('keeps the active tab when a different one closes', () => {
    const after = closeTab(layout(), 'a')
    expect(after.activeId).toBe('b')
  })

  it('slides the right pane over rather than leaving a hole on the left', () => {
    // A split with the left pane closed must not render an empty column beside
    // a full one — and you should be left looking at the half that survived,
    // not at whatever tab happens to be next in the bar.
    const after = closeTab(layout({ paneIds: ['a', 'c'], activeId: 'a' }), 'a')
    expect(after.paneIds).toEqual(['c', null])
    expect(after.activeId).toBe('c')
  })

  it('closes the right pane without disturbing the left', () => {
    const after = closeTab(layout({ paneIds: ['a', 'c'], activeId: 'a' }), 'c')
    expect(after.paneIds).toEqual(['a', null])
    expect(after.activeId).toBe('a')
  })

  it('puts the newly active tab somewhere it can be seen', () => {
    // The successor was in no pane, so it has to be given one — otherwise the
    // editor shows a tab that is active and invisible.
    const after = closeTab(layout({ paneIds: ['b', null], activeId: 'b' }), 'b')
    expect(after.paneIds[0]).toBe(after.activeId)
  })

  it('ignores a tab that is not open', () => {
    expect(closeTab(layout(), 'zzz')).toEqual(layout())
  })
})

describe('activate', () => {
  it('shows the tab in the focused pane', () => {
    expect(activate(layout(), 'c').paneIds).toEqual(['c', null])
  })

  it('moves focus instead of opening the same buffer twice', () => {
    // Two editors over one buffer would give it two diverging histories.
    const after = activate(layout({ paneIds: ['a', 'c'], focusedPane: 0 }), 'c')
    expect(after.focusedPane).toBe(1)
    expect(after.paneIds).toEqual(['a', 'c'])
  })

  it('ignores a tab that is not open', () => {
    expect(activate(layout(), 'zzz')).toEqual(layout())
  })
})

describe('toggleSplit', () => {
  it('opens a second pane on another tab', () => {
    expect(toggleSplit(layout({ paneIds: ['b', null] })).paneIds).toEqual(['b', 'a'])
  })

  it('splits to nothing when there is only one tab', () => {
    const one = layout({ tabOrder: ['a'], paneIds: ['a', null], activeId: 'a' })
    expect(toggleSplit(one).paneIds).toEqual(['a', null])
  })

  it('collapsing keeps the pane you were in', () => {
    const after = toggleSplit(layout({ paneIds: ['a', 'c'], focusedPane: 1, activeId: 'c' }))
    expect(after.paneIds).toEqual(['c', null])
    expect(after.activeId).toBe('c')
    expect(after.focusedPane).toBe(0)
  })
})

describe('focus', () => {
  it('moves between panes', () => {
    const split = layout({ paneIds: ['a', 'c'], focusedPane: 0, activeId: 'a' })
    expect(focusPane(split, 1)).toMatchObject({ focusedPane: 1, activeId: 'c' })
    expect(focusOtherPane(split)).toMatchObject({ focusedPane: 1, activeId: 'c' })
  })

  it('refuses an empty pane, which would leave nothing active', () => {
    expect(focusPane(layout(), 1)).toEqual(layout())
    expect(focusOtherPane(layout())).toEqual(layout())
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
