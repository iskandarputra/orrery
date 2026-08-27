import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { HistoryService } from './history'

let userData: string
let history: HistoryService
const NOTE = '/vault/Note.md'
const MINUTE = 60_000

beforeEach(() => {
  userData = mkdtempSync(path.join(tmpdir(), 'orrery-history-'))
  history = new HistoryService(userData)
})

afterEach(() => rmSync(userData, { recursive: true, force: true }))

describe('HistoryService', () => {
  it('records the first version and reads it back', async () => {
    const now = 10 * MINUTE
    expect(await history.record(NOTE, 'first draft', now)).toBe(true)

    const versions = await history.list(NOTE)
    expect(versions).toHaveLength(1)
    expect(await history.read(NOTE, versions[0]!.id)).toBe('first draft')
  })

  it('records a later edit as its own version, newest first', async () => {
    await history.record(NOTE, 'one', 10 * MINUTE)
    await history.record(NOTE, 'two', 20 * MINUTE)

    const versions = await history.list(NOTE)
    expect(versions).toHaveLength(2)
    expect(await history.read(NOTE, versions[0]!.id)).toBe('two')
  })

  it('does not record a save that changed nothing', async () => {
    await history.record(NOTE, 'same', 10 * MINUTE)
    expect(await history.record(NOTE, 'same', 30 * MINUTE)).toBe(false)
    expect(await history.list(NOTE)).toHaveLength(1)
  })

  it('coalesces rapid saves into one version', async () => {
    await history.record(NOTE, 'draft', 10 * MINUTE)
    expect(await history.record(NOTE, 'draft.', 10 * MINUTE + 5_000)).toBe(false)
    expect(await history.list(NOTE)).toHaveLength(1)
  })

  it('keeps histories of different notes apart', async () => {
    await history.record(NOTE, 'mine', 10 * MINUTE)
    await history.record('/vault/Other.md', 'theirs', 10 * MINUTE)

    expect(await history.list(NOTE)).toHaveLength(1)
    expect(await history.read('/vault/Other.md', (await history.list('/vault/Other.md'))[0]!.id)).toBe(
      'theirs'
    )
  })

  it('trims old versions but never the newest', async () => {
    // Well past the age limit, then one recent edit.
    await history.record(NOTE, 'ancient', 0)
    await history.record(NOTE, 'current', 200 * 24 * 60 * MINUTE)

    const versions = await history.list(NOTE)
    expect(versions).toHaveLength(1)
    expect(await history.read(NOTE, versions[0]!.id)).toBe('current')
  })

  it('has no history for a note that was never saved', async () => {
    expect(await history.list('/vault/Unseen.md')).toEqual([])
  })
})
