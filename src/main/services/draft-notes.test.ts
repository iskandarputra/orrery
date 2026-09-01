import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DraftNotes } from './draft-notes'

describe('DraftNotes', () => {
  let dir: string
  let drafts: DraftNotes

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'orrery-drafts-'))
    drafts = new DraftNotes(join(dir, 'drafts'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('has nothing to say before anybody has written a note', async () => {
    expect(await drafts.list()).toEqual([])
  })

  it('keeps a note and gives it back', async () => {
    await drafts.put({ id: 'a', n: 1, content: '# half an idea' })
    expect(await drafts.list()).toEqual([{ id: 'a', n: 1, content: '# half an idea' }])
  })

  it('replaces what a note said rather than keeping both', async () => {
    await drafts.put({ id: 'a', n: 1, content: 'first' })
    await drafts.put({ id: 'a', n: 1, content: 'second' })

    const kept = await drafts.list()
    expect(kept).toHaveLength(1)
    expect(kept[0]?.content).toBe('second')
  })

  it('gives them back in the order they were made', async () => {
    await drafts.put({ id: 'c', n: 3, content: 'third' })
    await drafts.put({ id: 'a', n: 1, content: 'first' })
    await drafts.put({ id: 'b', n: 2, content: 'second' })

    expect((await drafts.list()).map((d) => d.n)).toEqual([1, 2, 3])
  })

  it('forgets one, and leaves the others alone', async () => {
    await drafts.put({ id: 'a', n: 1, content: 'keep' })
    await drafts.put({ id: 'b', n: 2, content: 'drop' })

    await drafts.forget('b')

    expect((await drafts.list()).map((d) => d.id)).toEqual(['a'])
  })

  it('forgetting something that was never kept is not an error', async () => {
    await expect(drafts.forget('never-existed')).resolves.toBeUndefined()
  })

  it('refuses an id that would climb out of its folder', async () => {
    await drafts.put({ id: '../escaped', n: 1, content: 'nope' })
    await drafts.forget('../../etc/passwd')

    // Nothing written anywhere, and nothing to list.
    expect(await drafts.list()).toEqual([])
    await expect(fs.readFile(join(dir, 'escaped.json'))).rejects.toThrow()
  })

  it('skips a note it cannot make sense of rather than failing the lot', async () => {
    await drafts.put({ id: 'good', n: 1, content: 'readable' })
    await fs.writeFile(join(dir, 'drafts', 'broken.json'), '{ not json', 'utf-8')
    await fs.writeFile(join(dir, 'drafts', 'wrong.json'), '{"n":"one"}', 'utf-8')

    // A run that starts is worth more than one that refuses over a stray file.
    expect((await drafts.list()).map((d) => d.id)).toEqual(['good'])
  })

  it('ignores files that are not notes', async () => {
    await drafts.put({ id: 'good', n: 1, content: 'readable' })
    writeFileSync(join(dir, 'drafts', 'notes.txt'), 'not mine')

    expect((await drafts.list()).map((d) => d.id)).toEqual(['good'])
  })
})
