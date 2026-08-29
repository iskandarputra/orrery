import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { McpAudit, type AuditEntry } from './mcp-audit'

let dir: string

const entry = (over: Partial<AuditEntry> = {}): AuditEntry => ({
  at: Date.now(),
  serverId: 'files',
  serverName: 'Filesystem',
  tool: 'read',
  args: { path: '/tmp/a.md' },
  decision: 'allow',
  outcome: 'ok',
  ms: 12,
  summary: 'read 40 bytes',
  ...over
})

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'orrery-audit-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('McpAudit', () => {
  it('writes a line per call and reads it back newest first', async () => {
    const audit = new McpAudit(dir)
    await audit.write(entry({ at: 1_000, tool: 'first' }))
    await audit.write(entry({ at: 2_000, tool: 'second' }))

    // Both entries land in the file named for the day they happened.
    const files = readdirSync(dir)
    expect(files).toHaveLength(1)

    const back = await new McpAudit(dir).recent(10)
    expect(back.map((e) => e.tool)).toEqual(['second', 'first'])
    expect(back[0]?.args).toEqual({ path: '/tmp/a.md' })
  })

  it('records what was refused, not only what ran', async () => {
    // A server asking again and again for something it has been denied is the
    // thing someone would most want to find in a log.
    const audit = new McpAudit(dir)
    await audit.write(entry({ decision: 'deny', outcome: 'denied', summary: 'user said no' }))

    expect((await new McpAudit(dir).recent(10))[0]).toMatchObject({
      decision: 'deny',
      outcome: 'denied'
    })
  })

  it('keeps one entry from becoming a log file of its own', async () => {
    const audit = new McpAudit(dir)
    await audit.write(entry({ summary: 'x'.repeat(5000) }))

    const written = readFileSync(join(dir, readdirSync(dir)[0]!), 'utf-8')
    expect(written.length).toBeLessThan(1000)
  })

  it('honours the limit it is given', async () => {
    const audit = new McpAudit(dir)
    for (let i = 0; i < 10; i++) await audit.write(entry({ at: 1_000 + i }))

    expect(await new McpAudit(dir).recent(3)).toHaveLength(3)
  })

  it('survives a line half-written by a crash', async () => {
    const audit = new McpAudit(dir)
    await audit.write(entry({ tool: 'good' }))

    const file = join(dir, readdirSync(dir)[0]!)
    writeFileSync(file, `${readFileSync(file, 'utf-8')}{"at":1,"tool":"trunc`)

    // The good line still reads back rather than the whole log being lost.
    expect((await new McpAudit(dir).recent(10)).map((e) => e.tool)).toEqual(['good'])
  })

  it('reports nothing rather than failing when there is no log yet', async () => {
    expect(await new McpAudit(join(dir, 'nothing-here')).recent(10)).toEqual([])
  })

  it('does not throw when the log cannot be written', async () => {
    // A log directory that cannot exist — here because a file is in its way —
    // must not take a tool call down with it.
    const blocked = join(dir, 'in-the-way')
    writeFileSync(blocked, 'not a directory')
    const audit = new McpAudit(join(blocked, 'log'))

    await expect(audit.write(entry())).resolves.toBeUndefined()
    expect(await audit.recent(10)).toEqual([])
  })
})
