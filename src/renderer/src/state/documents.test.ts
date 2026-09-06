import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcInvokeContract, OrreryApi } from '@shared/ipc'
import { bufferRegistry } from '@/editor/buffer-registry'
import { setClient } from '@/services/client'
import { activatePlugins } from '@/plugins/registry'
import { useStore } from './store'

/**
 * In-memory fake of the main process behind the OrreryApi seam — the whole
 * open/save/close/dirty lifecycle tests here without Electron.
 */
function createFakeMain(): {
  api: OrreryApi
  files: Map<string, { content: string; mtimeMs: number }>
  drafts: Map<string, { n: number; content: string }>
  confirmClose: () => number
  readyToClose: () => boolean
} {
  const files = new Map<string, { content: string; mtimeMs: number }>()
  const drafts = new Map<string, { n: number; content: string }>()
  let confirmClose = 0
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
    'dialog:confirmClose': () => {
      confirmClose += 1
      return closeChoice
    },
    'drafts:list': () =>
      [...drafts].map(([id, draft]) => ({ id, n: draft.n, content: draft.content })),
    'drafts:put': (req) => {
      drafts.set(req.id, { n: req.n, content: req.content })
    },
    'drafts:forget': (req) => {
      drafts.delete(req.id)
    },
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
    drafts,
    confirmClose: () => confirmClose,
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

  it("opens a session's worth of tabs without showing every one of them", async () => {
    // The start-up hang. `openPaths` set `activeId` on every pass, so reopening
    // a session pointed the visible pane at each restored file in turn and the
    // editor mounted, laid out and tore down every document before settling on
    // the one that was wanted. Thirty large notes took four and a half seconds
    // of that; the files themselves read in seventy-five milliseconds.
    //
    // Only the last one is shown, and only that one has a state built for it.
    // The rest wait to be asked for.
    const paths = Array.from({ length: 12 }, (_, i) => `/ws/n${i}.md`)
    for (const p of paths) fake.files.set(p, { content: `# ${p}`, mtimeMs: 1 })

    await useStore.getState().openPaths(paths)

    const s = useStore.getState()
    expect(s.tabOrder).toHaveLength(12)
    expect(s.buffers[s.activeId!]?.fileName).toBe('n11.md')

    // Not one document has been built. There is no pane here to ask for one,
    // which is the point: opening a file no longer builds it, so a restore
    // costs whatever the panes on screen decide to look at and nothing else.
    const built = s.tabOrder.filter((id) => !bufferRegistry.isPending(id))
    expect(built).toEqual([])
  })

  it('builds a deferred document the moment anything asks for it', async () => {
    fake.files.set('/ws/a.md', { content: '# A', mtimeMs: 1 })
    fake.files.set('/ws/b.md', { content: '# B', mtimeMs: 1 })
    await useStore.getState().openPaths(['/ws/a.md', '/ws/b.md'])

    const s = useStore.getState()
    const a = s.tabOrder.find((id) => s.buffers[id]?.fileName === 'a.md')!
    expect(bufferRegistry.isPending(a)).toBe(true)
    // Asking is what builds it, and what comes back is the file, not an empty
    // document: a deferred tab that opened blank would be worse than a slow one.
    expect(bufferRegistry.get(a)?.state.doc.toString()).toBe('# A')
    expect(bufferRegistry.isPending(a)).toBe(false)
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

describe('a surface that saves itself', () => {
  it('is asked to save instead of having the buffer written over its file', async () => {
    // The trap this closes: a binary surface's buffer document is empty, so
    // the ordinary save path would write nought bytes over somebody's PDF.
    const saved: string[] = []
    activatePlugins(
      [
        {
          id: 'fake-binary',
          name: 'Fake',
          activate: (ctx) =>
            ctx.registerDocumentSurface({
              id: 'fakebin',
              label: 'Fake',
              claims: (name) => name.endsWith('.fake'),
              Component: () => null as unknown as React.JSX.Element,
              binary: true,
              save: async (id) => {
                saved.push(id)
                return true
              }
            })
        }
      ],
      { registerCommand: () => undefined, store: useStore }
    )

    fake.files.set('/ws/thing.fake', { content: '', mtimeMs: 1 })
    await useStore.getState().openPaths(['/ws/thing.fake'])
    const id = useStore.getState().activeId!

    expect(await useStore.getState().save(id)).toBe(true)
    expect(saved).toEqual([id])
    // The file is untouched: the surface was asked, and it is the one that
    // knows what its bytes are.
    expect(fake.files.get('/ws/thing.fake')?.content).toBe('')
    expect(fake.files.get('/ws/thing.fake')?.mtimeMs).toBe(1)
  })
})

/**
 * An unsaved note across a quit.
 *
 * Writing something and closing the app used to be two clicks from losing it:
 * "Save All" opened a file picker before the app would go, and "Don't Save"
 * threw the note away for good, because the session remembers tabs by path and
 * an untitled note has none.
 */
describe('a note that has never been given a file', () => {
  /** Type into a buffer the way the editor does, and tell the store about it. */
  const type = (id: string, text: string): void => {
    const runtime = bufferRegistry.get(id)!
    bufferRegistry.setState(id, runtime.state.update({ changes: { from: 0, insert: text } }).state)
    useStore.getState().setDirty(id, true)
  }

  it('is kept where a restart can find it, as it is typed', async () => {
    useStore.getState().newUntitled()
    const id = useStore.getState().activeId!
    type(id, '# half an idea')

    await vi.waitFor(() => expect(fake.drafts.get(id)?.content).toBe('# half an idea'))
    expect(fake.drafts.get(id)?.n).toBe(1)
  })

  it('does not make quitting a decision about it', async () => {
    useStore.getState().newUntitled()
    const id = useStore.getState().activeId!
    type(id, 'written, not saved')

    await useStore.getState().handleWindowCloseRequest()

    // No prompt, the app closed, and the note is kept.
    expect(fake.confirmClose()).toBe(0)
    expect(fake.readyToClose()).toBe(true)
    expect(fake.drafts.get(id)?.content).toBe('written, not saved')
  })

  it('is written on the way out even if the timer has not fired', async () => {
    useStore.getState().newUntitled()
    const id = useStore.getState().activeId!
    const runtime = bufferRegistry.get(id)!
    bufferRegistry.setState(
      id,
      runtime.state.update({ changes: { from: 0, insert: 'typed' } }).state
    )
    useStore.getState().setDirty(id, true)
    // Quit immediately, before the debounce could have run.
    await useStore.getState().handleWindowCloseRequest()

    expect(fake.drafts.get(id)?.content).toBe('typed')
  })

  it('comes back with its name, its text and its dot', async () => {
    fake.drafts.set('kept-1', { n: 1, content: '# first' })
    fake.drafts.set('kept-3', { n: 3, content: '# third' })

    await useStore.getState().restoreUntitled()

    const s = useStore.getState()
    expect(s.tabOrder).toHaveLength(2)
    const restored = s.tabOrder.map((id) => s.buffers[id]!)
    expect(restored.map((b) => b.fileName)).toEqual(['Untitled', 'Untitled 3'])
    expect(restored.every((b) => b.filePath === null)).toBe(true)
    // Unsaved, so it still carries the dot that says so.
    expect(restored.every((b) => b.isDirty)).toBe(true)
    expect(bufferRegistry.get('kept-1')?.state.doc.toString()).toBe('# first')
  })

  it('does not let a new note take a restored one’s name', async () => {
    fake.drafts.set('kept-2', { n: 2, content: 'restored' })
    await useStore.getState().restoreUntitled()

    useStore.getState().newUntitled()

    const s = useStore.getState()
    const names = s.tabOrder.map((id) => s.buffers[id]?.fileName)
    expect(names).toEqual(['Untitled 2', 'Untitled 3'])
  })

  it('keeps typing in the same place rather than leaving the old copy behind', async () => {
    fake.drafts.set('kept-1', { n: 1, content: 'before' })
    await useStore.getState().restoreUntitled()
    type('kept-1', 'after ')

    await vi.waitFor(() => expect(fake.drafts.get('kept-1')?.content).toBe('after before'))
    // One note, not one per restart.
    expect(fake.drafts.size).toBe(1)
  })

  it('stops being kept once it has a file of its own', async () => {
    useStore.getState().newUntitled()
    const id = useStore.getState().activeId!
    type(id, 'about to be saved')
    await vi.waitFor(() => expect(fake.drafts.has(id)).toBe(true))

    await useStore.getState().save(id)

    expect(fake.drafts.has(id)).toBe(false)
    expect(fake.files.has('/ws/untitled.md')).toBe(true)
  })

  it('stops being kept when the note itself is closed', async () => {
    useStore.getState().newUntitled()
    const id = useStore.getState().activeId!
    type(id, 'thrown away on purpose')
    await vi.waitFor(() => expect(fake.drafts.has(id)).toBe(true))

    // Closing a note is still a decision about it: the prompt asks, and the
    // fake answers "Don't Save". Quitting is the case that no longer asks.
    await useStore.getState().closeTab(id)

    expect(fake.confirmClose()).toBe(1)
    expect(fake.drafts.has(id)).toBe(false)
  })

  it('still asks about a note that does have a file', async () => {
    fake.files.set('/ws/a.md', { content: 'original', mtimeMs: 1 })
    await useStore.getState().openPaths(['/ws/a.md'])
    const id = useStore.getState().activeId!
    type(id, 'edited ')

    await useStore.getState().handleWindowCloseRequest()

    // The file on disk would go on saying something else, and search and
    // backlinks read the file — so this one is still worth asking about.
    expect(fake.confirmClose()).toBe(1)
  })
})
