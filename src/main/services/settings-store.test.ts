import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsStore } from './settings-store'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'orrery-settings-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const read = (): Record<string, unknown> =>
  JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf-8'))

describe('SettingsStore', () => {
  it('writes what was set', async () => {
    const store = new SettingsStore(dir)
    await store.load()
    store.set({ theme: 'dark' })
    await store.flush()
    expect(read()['theme']).toBe('dark')
  })

  it('survives overlapping saves without an ENOENT on the temp file', async () => {
    // Every save used to write one fixed `settings.json.tmp`, so a debounced
    // save still in flight when flush() ran raced it: the first rename consumed
    // the file and the second failed, which the app logged on startup.
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const store = new SettingsStore(dir)
    await store.load()

    store.set({ theme: 'dark' })
    await Promise.all([store.flush(), store.flush(), store.flush(), store.flush()])

    expect(errors).not.toHaveBeenCalled()
    errors.mockRestore()
  })

  it('leaves no temp files behind', async () => {
    const store = new SettingsStore(dir)
    await store.load()
    store.set({ theme: 'light' })
    await Promise.all([store.flush(), store.flush(), store.flush()])
    expect(readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([])
  })

  it('keeps the last value written when saves overlap', async () => {
    const store = new SettingsStore(dir)
    await store.load()
    store.set({ theme: 'dark' })
    const first = store.flush()
    store.set({ theme: 'light' })
    const second = store.flush()
    await Promise.all([first, second])
    expect(read()['theme']).toBe('light')
  })

  it('falls back to defaults when the file on disk is corrupt', async () => {
    const store = new SettingsStore(dir)
    await store.load()
    store.set({ theme: 'dark' })
    await store.flush()

    const { writeFileSync } = await import('node:fs')
    writeFileSync(join(dir, 'settings.json'), '{ not json', 'utf-8')
    const reopened = new SettingsStore(dir)
    const loaded = await reopened.load()
    expect(loaded.theme).toBeDefined()
  })
})
