import { describe, expect, it } from 'vitest'
import {
  captureWorkspace,
  pathsToOpen,
  restoreLayout,
  restoreSizes,
  type Workspace
} from './workspaces'

const ws = (over: Partial<Workspace> = {}): Workspace => ({
  openPaths: ['a.md', 'b.md'],
  panePaths: ['a.md', 'b.md'],
  activePath: 'b.md',
  focusedPane: 1,
  sidePanel: 'outline',
  paneSizes: [0.6, 0.4],
  ...over
})

const ids = (paths: string[]) => (path: string) => (paths.includes(path) ? `id:${path}` : null)

describe('captureWorkspace', () => {
  it('records the panes and what was active', () => {
    const saved = captureWorkspace({
      openPaths: ['a.md', 'b.md'],
      panePaths: ['a.md', 'b.md'],
      activePath: 'b.md',
      focusedPane: 1,
      sidePanel: 'git',
      paneSizes: [0.6, 0.4]
    })
    expect(saved).toEqual(ws({ sidePanel: 'git' }))
  })

  it('leaves out unsaved buffers, which have no path to reopen', () => {
    const saved = captureWorkspace({
      openPaths: ['a.md', ''],
      panePaths: ['a.md', null],
      activePath: null,
      focusedPane: 0,
      sidePanel: null,
      paneSizes: [1]
    })
    expect(saved.openPaths).toEqual(['a.md'])
    expect(saved.panePaths).toEqual(['a.md', ''])
    expect(saved.activePath).toBe('')
    expect(saved.sidePanel).toBeNull()
  })
})

describe('pathsToOpen', () => {
  it('opens what a pane needs even when it is missing from the tab list', () => {
    expect(pathsToOpen(ws({ openPaths: ['a.md'] }))).toEqual(['a.md', 'b.md'])
  })

  it('opens each file once', () => {
    expect(pathsToOpen(ws())).toEqual(['a.md', 'b.md'])
  })
})

describe('restoreSizes', () => {
  it('gives back the widths that were saved', () => {
    expect(restoreSizes(ws(), 2)).toEqual([0.6, 0.4])
  })

  it('fits them to the panes that survived', () => {
    // One file was deleted, so its pane is gone and its width with it.
    const fitted = restoreSizes(ws(), 1)
    expect(fitted).toEqual([1])
  })

  it('falls back to equal columns for a workspace saved before widths existed', () => {
    expect(restoreSizes(ws({ paneSizes: [] }), 2)).toEqual([0.5, 0.5])
  })
})

describe('restoreLayout', () => {
  it('puts each file back in its pane', () => {
    const layout = restoreLayout(ws(), ids(['a.md', 'b.md']))
    expect(layout.paneIds).toEqual(['id:a.md', 'id:b.md'])
    expect(layout.activeId).toBe('id:b.md')
    expect(layout.focusedPane).toBe(1)
    expect(layout.tabOrder).toEqual(['id:a.md', 'id:b.md'])
  })

  it('collapses a pane whose file has been deleted since', () => {
    // Rather than a column showing nothing next to one showing a file.
    const layout = restoreLayout(ws(), ids(['b.md']))
    expect(layout.paneIds).toEqual(['id:b.md'])
    expect(layout.focusedPane).toBe(0)
  })

  it('survives a workspace whose files are all gone', () => {
    const layout = restoreLayout(ws(), () => null)
    expect(layout).toEqual({ tabOrder: [], activeId: null, paneIds: [null], focusedPane: 0 })
  })

  it('shows the active file even when it was saved outside every pane', () => {
    const layout = restoreLayout(
      ws({ panePaths: ['a.md'], activePath: 'b.md', focusedPane: 0 }),
      ids(['a.md', 'b.md'])
    )
    expect(layout.paneIds).toEqual(['id:b.md'])
  })

  it('ignores a pane count beyond what fits', () => {
    const many = ws({
      openPaths: ['a.md', 'b.md', 'c.md', 'd.md', 'e.md', 'f.md'],
      panePaths: ['a.md', 'b.md', 'c.md', 'd.md', 'e.md', 'f.md'],
      activePath: 'a.md',
      focusedPane: 0
    })
    const layout = restoreLayout(many, (p) => `id:${p}`)
    expect(layout.paneIds).toHaveLength(4)
    // The tabs are all still open, only the panes are capped.
    expect(layout.tabOrder).toHaveLength(6)
  })

  it('clamps a focused pane that no longer exists', () => {
    const layout = restoreLayout(ws({ focusedPane: 9 }), ids(['a.md', 'b.md']))
    expect(layout.focusedPane).toBe(1)
  })
})
