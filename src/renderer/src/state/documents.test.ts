import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcInvokeContract, OrreryApi } from '@shared/ipc'
import { bufferRegistry } from '@/editor/buffer-registry'
import { setClient } from '@/services/client'
import { useStore } from './store'

/**
 * In-memory fake of the main process behind the OrreryApi seam — the whole
 * open/save/close/dirty lifecycle tests here without Electron.
 */
function createFakeMain(): {
  api: OrreryApi
  files: Map<string, { content: string; mtimeMs: number }>
  readyToClose: () => boolean
} {
  const files = new Map<string, { content: string; mtimeMs: number }>()
  const closeChoice: 'save' | 'discard' | 'cancel' = 'discard'
  let readyToClose = false
  let clock = 1000

  const handlers: {
    [K in keyof IpcInvokeContract]?: (
      req: IpcInvokeContract[K]['req']
    ) => IpcInvokeContract[K]['res']
  } = {
    'fs:readFile': (req) => {
      const file = files.get(req.path)
      if (!file) throw new Error(`ENOENT|not found`)
      return { path: req.path, content: file.content, mtimeMs: file.mtimeMs }
    },
    'fs:writeFile': (req) => {
      const existing = files.get(req.path)
      if (existing && req.expectedMtimeMs !== null && existing.mtimeMs !== req.expectedMtimeMs) {
        throw new Error('CONFLICT|changed on disk')
      }
      clock += 1
      files.set(req.path, { content: req.content, mtimeMs: clock })
      return { path: req.path, mtimeMs: clock }
    },
    'dialog:confirmClose': () => closeChoice,
    'dialog:saveAs': () => '/ws/untitled.md',
    'app:addRecentFile': () => undefined,
    'settings:get': () => useStore.getState().settings,
    'settings:set': (patch) => ({ ...useStore.getState().settings, ...patch }),
    'window:readyToClose': () => {
      readyToClose = true
    }
  }

  const api: OrreryApi = {
    invoke: (channel, req) => {
      const handler = handlers[channel]
      if (!handler) throw new Error(`no fake for ${channel}`)
      try {
        return Promise.resolve(handler(req as never) as never)
      } catch (err) {
        return Promise.reject(err)
      }
    },
    on: () => () => undefined
  }

  return {
    api,
    files,
    readyToClose: () => readyToClose
  }
}

const initialState = useStore.getState()
let fake: ReturnType<typeof createFakeMain>

beforeEach(() => {
  fake = createFakeMain()
  setClient(fake.api)
})

afterEach(() => {
  useStore.setState(initialState, true)
  bufferRegistry.clear()
  vi.restoreAllMocks()
})

describe('documents slice', () => {
  it('opens a file into a new tab and activates it', async () => {
    fake.files.set('/ws/a.md', { content: '# Hello', mtimeMs: 1 })
    await useStore.getState().openPaths(['/ws/a.md'])

    const s = useStore.getState()
    expect(s.tabOrder).toHaveLength(1)
    const buffer = s.buffers[s.activeId!]
    expect(buffer?.fileName).toBe('a.md')
    expect(buffer?.isDirty).toBe(false)
    expect(bufferRegistry.get(buffer!.id)?.state.doc.toString()).toBe('# Hello')
  })

  it('focuses the existing tab instead of duplicating on re-open', async () => {
    fake.files.set('/ws/a.md', { content: 'x', mtimeMs: 1 })
    fake.files.set('/ws/b.md', { content: 'y', mtimeMs: 1 })
    await useStore.getState().openPaths(['/ws/a.md', '/ws/b.md'])
    await useStore.getState().openPaths(['/ws/a.md'])

    const s = useStore.getState()
    expect(s.tabOrder).toHaveLength(2)
    expect(s.buffers[s.activeId!]?.fileName).toBe('a.md')
  })

  it('saves an untitled document via Save As and updates its identity', async () => {
    useStore.getState().newUntitled()
    const id = useStore.getState().activeId!
    const saved = await useStore.getState().save(id)

    expect(saved).toBe(true)
    const buffer = useStore.getState().buffers[id]
    expect(buffer?.filePath).toBe('/ws/untitled.md')
    expect(buffer?.fileName).toBe('untitled.md')
    expect(fake.files.has('/ws/untitled.md')).toBe(true)
  })

  it('write conflicts surface and abort the save when the user declines', async () => {
    fake.files.set('/ws/a.md', { content: 'v1', mtimeMs: 1 })
    await useStore.getState().openPaths(['/ws/a.md'])
    const id = useStore.getState().activeId!
    // Simulate an external edit bumping the mtime.
    fake.files.set('/ws/a.md', { content: 'external', mtimeMs: 99 })

    vi.spyOn(window, 'confirm').mockReturnValue(false)
    const saved = await useStore.getState().save(id)
    expect(saved).toBe(false)
    expect(fake.files.get('/ws/a.md')?.content).toBe('external')
  })

  it('overwrites on conflict when the user confirms', async () => {
    fake.files.set('/ws/a.md', { content: 'v1', mtimeMs: 1 })
    await useStore.getState().openPaths(['/ws/a.md'])
    const id = useStore.getState().activeId!
    fake.files.set('/ws/a.md', { content: 'external', mtimeMs: 99 })

    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const saved = await useStore.getState().save(id)
    expect(saved).toBe(true)
    expect(fake.files.get('/ws/a.md')?.content).toBe('v1')
  })

  it('closes a clean tab without prompting and activates a neighbor', async () => {
    fake.files.set('/ws/a.md', { content: 'x', mtimeMs: 1 })
    fake.files.set('/ws/b.md', { content: 'y', mtimeMs: 1 })
    await useStore.getState().openPaths(['/ws/a.md', '/ws/b.md'])
    const closed = await useStore.getState().closeTab(useStore.getState().activeId!)

    expect(closed).toBe(true)
    const s = useStore.getState()
    expect(s.tabOrder).toHaveLength(1)
    expect(s.buffers[s.activeId!]?.fileName).toBe('a.md')
  })

  it('a closed file opens again, rather than nothing happening', async () => {
    // Closing has to take the buffer with the tab. A buffer left behind is
    // found by the next open, which activates a tab that is not there any
    // more — and from the outside that looks like the click did nothing.
    fake.files.set('/ws/a.md', { content: 'x', mtimeMs: 1 })
    await useStore.getState().openPaths(['/ws/a.md'])
    await useStore.getState().closeTab(useStore.getState().activeId!)

    expect(Object.keys(useStore.getState().buffers)).toHaveLength(0)

    await useStore.getState().openPaths(['/ws/a.md'])
    const s = useStore.getState()
    expect(s.tabOrder).toHaveLength(1)
    expect(s.buffers[s.activeId!]?.fileName).toBe('a.md')
  })

  it('closeOthers keeps only the given tab', async () => {
    fake.files.set('/ws/a.md', { content: 'a', mtimeMs: 1 })
    fake.files.set('/ws/b.md', { content: 'b', mtimeMs: 1 })
    fake.files.set('/ws/c.md', { content: 'c', mtimeMs: 1 })
    await useStore.getState().openPaths(['/ws/a.md', '/ws/b.md', '/ws/c.md'])
    const keep = useStore.getState().tabOrder[1]!

    await useStore.getState().closeOthers(keep)
    const s = useStore.getState()
    expect(s.tabOrder).toEqual([keep])
    expect(s.activeId).toBe(keep)
  })

  it('closeToRight closes only later tabs', async () => {
    fake.files.set('/ws/a.md', { content: 'a', mtimeMs: 1 })
    fake.files.set('/ws/b.md', { content: 'b', mtimeMs: 1 })
    fake.files.set('/ws/c.md', { content: 'c', mtimeMs: 1 })
    await useStore.getState().openPaths(['/ws/a.md', '/ws/b.md', '/ws/c.md'])
    const [first, second] = useStore.getState().tabOrder

    await useStore.getState().closeToRight(second!)
    expect(useStore.getState().tabOrder).toEqual([first, second])
  })

  it('closeAllTabs empties the workspace', async () => {
    fake.files.set('/ws/a.md', { content: 'a', mtimeMs: 1 })
    fake.files.set('/ws/b.md', { content: 'b', mtimeMs: 1 })
    await useStore.getState().openPaths(['/ws/a.md', '/ws/b.md'])

    await useStore.getState().closeAllTabs()
    const s = useStore.getState()
    expect(s.tabOrder).toEqual([])
    expect(s.activeId).toBeNull()
  })

  it('updatePathsAfterRename repoints file and descendant buffers', async () => {
    fake.files.set('/ws/dir/a.md', { content: 'a', mtimeMs: 1 })
    fake.files.set('/ws/b.md', { content: 'b', mtimeMs: 1 })
    await useStore.getState().openPaths(['/ws/dir/a.md', '/ws/b.md'])

    useStore.getState().updatePathsAfterRename('/ws/dir', '/ws/renamed')
    const buffers = Object.values(useStore.getState().buffers)
    expect(buffers.find((b) => b.fileName === 'a.md')?.filePath).toBe('/ws/renamed/a.md')
    expect(buffers.find((b) => b.fileName === 'b.md')?.filePath).toBe('/ws/b.md')

    useStore.getState().updatePathsAfterRename('/ws/b.md', '/ws/c.md')
    expect(
      Object.values(useStore.getState().buffers).find((b) => b.fileName === 'c.md')?.filePath
    ).toBe('/ws/c.md')
  })

  it('signals readyToClose immediately when no buffers are dirty', async () => {
    fake.files.set('/ws/a.md', { content: 'x', mtimeMs: 1 })
    await useStore.getState().openPaths(['/ws/a.md'])
    await useStore.getState().handleWindowCloseRequest()
    expect(fake.readyToClose()).toBe(true)
  })

  it('marks a buffer dirty when its registry saved-doc diverges', async () => {
    fake.files.set('/ws/a.md', { content: 'original', mtimeMs: 1 })
    await useStore.getState().openPaths(['/ws/a.md'])
    const id = useStore.getState().activeId!

    // Simulate typing: replace the buffer state's doc via a transaction.
    const runtime = bufferRegistry.get(id)!
    const tr = runtime.state.update({ changes: { from: 0, insert: 'edited ' } })
    bufferRegistry.setState(id, tr.state)
    expect(bufferRegistry.isDirty(id, tr.state.doc)).toBe(true)
    expect(bufferRegistry.isDirty(id, runtime.state.doc)).toBe(true) // same registry object updated

    // And saving clears it.
    useStore.getState().setDirty(id, true)
    const saved = await useStore.getState().save(id)
    expect(saved).toBe(true)
    expect(useStore.getState().buffers[id]?.isDirty).toBe(false)
    expect(fake.files.get('/ws/a.md')?.content).toBe('edited original')
  })
})
