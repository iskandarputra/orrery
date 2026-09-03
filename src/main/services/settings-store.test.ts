import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
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
  /**
   * `'git'` was a right-hand panel until source control moved to the left
   * sidebar. `load()` runs one `safeParse` over the whole document and falls
   * back to defaults wholesale, so a value that no longer validates does not
   * cost you that field — it costs you every setting in the file.
   */
  it('keeps the rest of the file when the stored panel no longer exists', async () => {
    writeFileSync(
      join(dir, 'settings.json'),
      JSON.stringify({ theme: 'dark', rightPanel: { width: 420, panel: 'git' } })
    )
    const store = new SettingsStore(dir)
    const loaded = await store.load()

    expect(loaded.theme).toBe('dark')
    expect(loaded.rightPanel.width).toBe(420)
    expect(loaded.rightPanel.panel).toBeNull()
  })

  it('keeps the rest of the file when a saved workspace names it', async () => {
    writeFileSync(
      join(dir, 'settings.json'),
      JSON.stringify({
        theme: 'dark',
        workspaces: { research: { activePath: 'a.md', sidePanel: 'git' } }
      })
    )
    const loaded = await new SettingsStore(dir).load()

    expect(loaded.theme).toBe('dark')
    expect(loaded.workspaces['research']?.activePath).toBe('a.md')
    expect(loaded.workspaces['research']?.sidePanel).toBeNull()
  })

  it('loads a file written before the sidebar had views', async () => {
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ sidebar: { visible: true } }))
    const loaded = await new SettingsStore(dir).load()
    expect(loaded.sidebar.view).toBe('files')
  })

  /** A version stamp must never be the thing that invalidates a document. */
  it('loads a file stamped with an unknown schema version', async () => {
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ schemaVersion: 99, theme: 'dark' }))
    expect((await new SettingsStore(dir).load()).theme).toBe('dark')
  })

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
