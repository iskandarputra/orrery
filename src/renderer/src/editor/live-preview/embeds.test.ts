import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * What an embed does with a read that outlives the card it was for.
 *
 * An embed's body comes off disk, so there is a gap between asking for it and
 * having it, and the card can be dropped inside that gap — putting the cursor
 * on the embed's line is enough, because that reveals the source and removes
 * the decoration. Everything here is about that gap.
 *
 * The file is mocked to the seam rather than to the filesystem: the read is
 * held open deliberately, so the window this is about can be entered on
 * purpose instead of waited for and hoped at.
 */

/** Resolves the pending `fs:readFile`, so the race can be run either way round. */
let resolveRead: ((value: { content: string }) => void) | null = null
const readCalls: string[] = []

vi.mock('@/services/client', () => ({
  invoke: (channel: string, req: { path: string }) => {
    readCalls.push(`${channel}:${req.path}`)
    return new Promise((resolve) => {
      resolveRead = resolve as (value: { content: string }) => void
    })
  }
}))

vi.mock('@/state/app-state-access', () => ({
  appState: () => ({
    noteIndex: [{ stem: 'Note', path: '/vault/Note.md' }],
    fileIndex: []
  })
}))

/** Stands in for the nested editor, so "was it torn down" is answerable. */
interface FakePreview {
  destroy: () => void
  destroyed: boolean
}
const previews: FakePreview[] = []

vi.mock('@/editor/preview-view', () => ({
  mountPreview: () => {
    const preview: FakePreview = {
      destroyed: false,
      destroy: () => {
        preview.destroyed = true
      }
    }
    previews.push(preview)
    return preview
  }
}))

const { embedRendering, invalidateEmbed } = await import('./embeds')

const DOC = 'intro\n![[Note]]'

let view: EditorView | null = null

function mount(doc = DOC): EditorView {
  const parent = document.createElement('div')
  document.body.appendChild(parent)
  view = new EditorView({
    state: EditorState.create({ doc, extensions: [embedRendering(true)] }),
    parent
  })
  return view
}

const card = (v: EditorView): HTMLElement | null => v.dom.querySelector('.cm-or-embed')

/** Put the cursor on the embed's line, which reveals the source and drops it. */
function revealTheEmbed(v: EditorView): void {
  v.dispatch({ selection: { anchor: v.state.doc.length } })
}

/** Let the mocked read's `.then` chain run to completion. */
async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++) await Promise.resolve()
}

beforeEach(() => {
  readCalls.length = 0
  previews.length = 0
  resolveRead = null
  // The body cache is module-level and outlives a test; a hit would skip the
  // read this file is entirely about.
  invalidateEmbed('/vault/Note.md')
})

afterEach(() => {
  view?.destroy()
  view = null
})

describe('a read that finishes after its card has gone', () => {
  it('mounts nothing, rather than mounting into an orphan', async () => {
    const v = mount()
    expect(card(v)).not.toBeNull()
    expect(readCalls).toEqual(['fs:readFile:/vault/Note.md'])
    const finishTheRead = resolveRead!

    revealTheEmbed(v)
    expect(card(v), 'the card is gone before the read comes back').toBeNull()

    finishTheRead({ content: '# Body\n\nsome text' })
    await settle()

    // Before this was fixed the read went on to mount a whole editor into the
    // detached element and file it under a card nothing would ever ask about
    // again: unreachable, and never destroyed by anything.
    expect(previews, 'no editor was mounted into the discarded card').toHaveLength(0)
  })

  it('leaves nothing behind for the editor to close over', async () => {
    const v = mount()
    const finishTheRead = resolveRead!
    revealTheEmbed(v)
    finishTheRead({ content: '# Body' })
    await settle()

    v.destroy()
    view = null
    // The real complaint about the leak was not the mount, it was that closing
    // the tab did not help. Nothing mounted means nothing to survive.
    expect(previews.filter((p) => !p.destroyed)).toHaveLength(0)
  })
})

describe('a read that finishes while its card is still there', () => {
  it('mounts the preview, and tears it down with the card', async () => {
    const v = mount()
    resolveRead!({ content: '# Body\n\nsome text' })
    await settle()
    expect(previews, 'the preview was mounted').toHaveLength(1)
    expect(previews[0]!.destroyed).toBe(false)

    revealTheEmbed(v)
    expect(card(v)).toBeNull()
    expect(previews[0]!.destroyed, 'and destroyed with the card').toBe(true)
  })

  it('does the same on the synchronous path, when the body is cached', async () => {
    // The control: a second embed of the same note never awaits, so the card is
    // never in the window above. This is the path that always worked, kept so a
    // fix that quietly stopped mounting anything at all would be caught.
    const first = mount()
    resolveRead!({ content: '# Body' })
    await settle()
    first.destroy()
    previews.length = 0
    readCalls.length = 0

    const v = mount()
    expect(readCalls, 'served from the cache').toEqual([])
    expect(previews).toHaveLength(1)

    revealTheEmbed(v)
    expect(previews[0]!.destroyed).toBe(true)
  })
})
