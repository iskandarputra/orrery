import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SidecarClient } from './sidecar'

/**
 * Against a real child process speaking the real framing.
 *
 * The client's job is almost entirely about what happens at the process
 * boundary — a binary that is not there, one that answers, one that never
 * answers, one that dies mid-conversation. A mocked child would test none of
 * that, so these spawn a script that behaves each way in turn.
 */

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__/fake-sidecar.mjs')

let dir: string

/** An executable that runs the fixture in the given mode. */
function fakeSidecar(mode: string): string {
  const path = join(dir, `sidecar-${mode}`)
  writeFileSync(
    path,
    `#!/usr/bin/env node\nprocess.argv[2] = '${mode}'\nawait import(${JSON.stringify(FIXTURE)})\n`
  )
  chmodSync(path, 0o755)
  return path
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'orrery-sidecar-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('availability', () => {
  it('reports a binary that is not there as unavailable', () => {
    expect(new SidecarClient(join(dir, 'nope')).available).toBe(false)
  })

  it('reports one that exists as available', () => {
    expect(new SidecarClient(fakeSidecar('echo')).available).toBe(true)
  })

  it('answers null without spawning when there is no binary', async () => {
    // The whole point of the fallback: a missing sidecar costs the caller a
    // null, not an exception it would have to know to catch.
    expect(await new SidecarClient(join(dir, 'nope')).call('search', {})).toBeNull()
  })
})

describe('a working sidecar', () => {
  it('carries a request and its reply across the framing', async () => {
    const client = new SidecarClient(fakeSidecar('echo'))
    expect(await client.call('search', { query: 'hello' })).toEqual({
      echoed: { query: 'hello' }
    })
    client.shutdown()
  })

  it('keeps one process for many calls, and matches each reply to its caller', async () => {
    const client = new SidecarClient(fakeSidecar('echo'))
    const replies = await Promise.all([
      client.call('a', { n: 1 }),
      client.call('b', { n: 2 }),
      client.call('c', { n: 3 })
    ])
    // Correlated by id: interleaved replies must not be handed to the wrong
    // caller, which is the failure a single-request test cannot see.
    expect(replies).toEqual([{ echoed: { n: 1 } }, { echoed: { n: 2 } }, { echoed: { n: 3 } }])
    client.shutdown()
  })
})

describe('a sidecar that fails', () => {
  it('settles the caller when the process dies mid-request', async () => {
    // Left unsettled, the renderer would wait on a promise that can never
    // resolve, and search would hang rather than fall back.
    const client = new SidecarClient(fakeSidecar('die'))
    expect(await client.call('search', {})).toBeNull()
    client.shutdown()
  })

  it('gives up on a binary that cannot start, rather than retrying forever', async () => {
    const client = new SidecarClient(fakeSidecar('crash'))
    expect(await client.call('search', {})).toBeNull()
    expect(await client.call('search', {})).toBeNull()
    client.shutdown()
  })
})
