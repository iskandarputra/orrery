import { cleanup, render } from '@testing-library/react'
import { defaultSettings } from '@shared/settings'
import type { OrreryApi } from '@shared/ipc'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FileNode } from '@shared/types'
import { setClient } from '@/services/client'
import { useStore } from '@/state/store'
import { Sidebar } from './Sidebar'

const fakeMain = {
  invoke: () => Promise.resolve(undefined),
  on: () => () => {}
} as unknown as OrreryApi

const tree: FileNode = { name: 'vault', path: '/vault', kind: 'directory', children: [] }

const withSidebar = (
  view: 'files' | 'git',
  { visible = true, open = false }: { visible?: boolean; open?: boolean } = {}
): void => {
  useStore.setState({
    settings: { ...defaultSettings, sidebar: { ...defaultSettings.sidebar, view, visible } },
    rootPath: open ? '/vault' : null,
    tree: open ? tree : null,
    fileTreeFilter: '',
    treeEdit: null,
    expandedDirs: {}
  })
}

beforeEach(() => setClient(fakeMain))
afterEach(cleanup)

describe('Sidebar views', () => {
  it('shows the file tree on the files view', () => {
    withSidebar('files')
    const { container } = render(<Sidebar />)
    expect(container.textContent).toContain('No Folder Open')
  })

  it('shows source control on the git view', () => {
    withSidebar('git')
    const { container } = render(<Sidebar />)
    expect(container.textContent).toContain('Open a folder to see its changes.')
  })

  it('gives each view its own header', () => {
    // The filter belongs to the tree it filters. Asserted as a contrast with
    // a folder open, because with no folder open neither view draws one and
    // the test would pass without proving anything.
    withSidebar('files', { open: true })
    const files = render(<Sidebar />)
    expect(files.container.querySelector('.sidebar__filter-input')).not.toBeNull()
    cleanup()

    withSidebar('git', { open: true })
    const git = render(<Sidebar />)
    expect(git.container.querySelector('.sidebar__filter-input')).toBeNull()
  })

  it('renders nothing at all when hidden, whichever view it is on', () => {
    withSidebar('git', { visible: false })
    const { container } = render(<Sidebar />)
    expect(container.firstChild).toBeNull()
  })
})
