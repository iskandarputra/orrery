import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OpenRequest } from '@shared/types'
import { OpenRequests } from './open-requests'

let dir: string
let note: string
let other: string
let folder: string

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'orrery-open-'))
  note = path.join(dir, 'jobs-arch.txt')
  other = path.join(dir, 'Second.md')
  folder = path.join(dir, 'vault')
  writeFileSync(note, 'hello')
  writeFileSync(other, '# Second')
  mkdirSync(folder)
})

afterEach(() => rmSync(dir, { recursive: true, force: true }))

/** A window that is there, and a record of what it was handed. */
function window(): { deliver: (r: OpenRequest) => boolean; got: OpenRequest[] } {
  const got: OpenRequest[] = []
  return {
    deliver: (r) => {
      got.push(r)
      return true
    },
    got
  }
}

describe('OpenRequests', () => {
  it('holds what a cold start was asked for until the renderer takes it', async () => {
    const win = window()
    const requests = new OpenRequests(win.deliver)

    await requests.request([note])

    // Nothing pushed: on a cold start the renderer has not subscribed yet, and
    // a push now goes nowhere.
    expect(win.got).toEqual([])
    expect(requests.take()).toEqual({ files: [note], folders: [] })
  })

  it('gives the queue up only once', async () => {
    const requests = new OpenRequests(window().deliver)
    await requests.request([note])

    expect(requests.take().files).toEqual([note])
    expect(requests.take()).toEqual({ files: [], folders: [] })
  })

  it('pushes to the window once the renderer is listening', async () => {
    const win = window()
    const requests = new OpenRequests(win.deliver)
    requests.take()

    // The second instance: already running, right-click, Open With.
    await requests.request([note])

    expect(win.got).toEqual([{ files: [note], folders: [] }])
    expect(requests.take()).toEqual({ files: [], folders: [] })
  })

  it('queues again when the push had nowhere to go', async () => {
    // macOS: the last window was closed but the app is still running.
    const requests = new OpenRequests(() => false)
    requests.take()

    await requests.request([note])

    expect(requests.take()).toEqual({ files: [note], folders: [] })
  })

  it('sorts a folder from a file, because a folder becomes the vault', async () => {
    const requests = new OpenRequests(window().deliver)
    await requests.request([folder, note])

    expect(requests.take()).toEqual({ files: [note], folders: [folder] })
  })

  it('drops a path that is not there rather than opening it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const requests = new OpenRequests(window().deliver)

    await requests.request([path.join(dir, 'gone.md'), note])

    expect(requests.take()).toEqual({ files: [note], folders: [] })
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('keeps the order it was given, since the last file is the one shown', async () => {
    const requests = new OpenRequests(window().deliver)
    await requests.request([note, other])

    expect(requests.take().files).toEqual([note, other])
  })

  it('accumulates while nothing is listening', async () => {
    const requests = new OpenRequests(window().deliver)
    await requests.request([note])
    await requests.request([other])

    expect(requests.take().files).toEqual([note, other])
  })

  it('does not wake the window for an argv with no paths in it', async () => {
    const win = window()
    const requests = new OpenRequests(win.deliver)
    requests.take()

    await requests.request([])

    expect(win.got).toEqual([])
  })
})
