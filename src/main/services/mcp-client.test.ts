import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { defaultSettings, type Settings } from '@shared/settings'
import type { McpServerConfig } from '@core/mcp-config'
import { AskUser, type AskRequest } from './ask-user'
import { McpAudit } from './mcp-audit'
import { McpClientService } from './mcp-client'

/**
 * Driven against the real fixture server over real stdio. Everything that can
 * go wrong in a client — a handshake that fails, a call that never answers, a
 * server that dies mid-conversation — happens here for real rather than being
 * simulated by a mock that agrees with whatever the client does.
 */

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__/mcp-fixture-server.mjs')

const serverConfig = (over: Partial<Extract<McpServerConfig, { transport: 'stdio' }>> = {}) => ({
  id: 'fixture',
  name: 'Fixture',
  enabled: true,
  transport: 'stdio' as const,
  command: process.execPath,
  args: [FIXTURE],
  env: {},
  cwd: '',
  ...over
})

interface Harness {
  service: McpClientService
  settings: () => Settings
  asked: AskRequest[]
  /** What the next permission dialog answers with. */
  answer: { decision: 'allow' | 'deny' | 'never' | 'once' } | null
  /** What an elicitation dialog answers with; null means it was closed. */
  elicit: { action: 'accept' | 'decline' | 'cancel'; content?: Record<string, unknown> } | null
  /** What the "may this server borrow the model" dialog answers with. */
  sampling: { decision: 'allow' | 'deny' } | null
  changes: string[]
}

let dir: string
let harness: Harness

function build(config: McpServerConfig, timeoutMs = 5000): Harness {
  let settings: Settings = {
    ...defaultSettings,
    mcp: { ...defaultSettings.mcp, servers: [config], timeoutMs }
  }
  const state: Harness = {
    asked: [],
    answer: { decision: 'once' },
    elicit: { action: 'accept', content: {} },
    sampling: { decision: 'allow' },
    changes: [],
    settings: () => settings,
    service: null as unknown as McpClientService
  }

  const ask = new AskUser((request) => {
    state.asked.push(request)
    // Answers on the next tick, as a dialog does. Elicitation has its own
    // answer because it is a form rather than a yes or no.
    setTimeout(() => {
      const answer =
        request.kind === 'elicitation'
          ? state.elicit
          : request.kind === 'sampling'
            ? state.sampling
            : state.answer
      ask.answer(request.id, answer)
    }, 0)
    return true
  }, 2000)

  state.service = new McpClientService(
    {
      get: () => settings,
      set: (patch) => {
        settings = { ...settings, ...patch } as Settings
        return settings
      }
    },
    ask,
    new McpAudit(join(dir, 'log')),
    {
      onServerChanged: (status) => state.changes.push(`${status.id}:${status.state}`),
      onActivity: () => {}
    },
    () => dir,
    async (_system, prompt) => `a model would say something about: ${prompt.slice(0, 40)}`
  )
  return state
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'orrery-mcp-'))
})

afterEach(async () => {
  await harness?.service.shutdown()
  rmSync(dir, { recursive: true, force: true })
})

describe('connecting', () => {
  it('lists what the server offers', async () => {
    harness = build(serverConfig())
    const status = await harness.service.connect('fixture')

    expect(status.state).toBe('ready')
    expect(status.tools.map((t) => t.name)).toContain('echo')
    expect(status.resources.map((r) => r.uri)).toEqual(['fixture://greeting'])
    expect(status.prompts.map((p) => p.name)).toEqual(['summarise'])
  })

  it('keeps the annotations a server puts on its tools', async () => {
    // The permission gate reads these, so losing them is a security bug and
    // not a cosmetic one.
    harness = build(serverConfig())
    const status = await harness.service.connect('fixture')
    expect(status.tools.find((t) => t.name === 'wipe')?.annotations?.destructiveHint).toBe(true)
    expect(status.tools.find((t) => t.name === 'echo')?.annotations?.readOnlyHint).toBe(true)
  })

  it('reports a command that does not exist rather than throwing', async () => {
    harness = build(serverConfig({ command: '/nonexistent/mcp-server' }))
    const status = await harness.service.connect('fixture')

    expect(status.state).toBe('failed')
    expect(status.error).not.toBe('')
    expect(harness.service.statuses()[0]?.state).toBe('failed')
  })

  it('shares one handshake between two callers', async () => {
    harness = build(serverConfig())
    const [first, second] = await Promise.all([
      harness.service.connect('fixture'),
      harness.service.connect('fixture')
    ])
    expect(first.state).toBe('ready')
    expect(second.state).toBe('ready')
    // One `connecting` announcement, not two: a second caller joined the first.
    expect(harness.changes.filter((c) => c === 'fixture:connecting')).toHaveLength(1)
  })

  it('picks up a tool the server adds after connecting', async () => {
    harness = build(serverConfig({ env: { FIXTURE_LATE_TOOL: '1' } }))
    await harness.service.connect('fixture')

    // The list_changed notification is what makes this arrive without asking.
    await expect
      .poll(() => harness.service.statuses()[0]?.tools.map((t) => t.name) ?? [], { timeout: 4000 })
      .toContain('late')
  })

  it('forgets a server that has been removed from settings', async () => {
    harness = build(serverConfig())
    await harness.service.connect('fixture')
    const settings = harness.settings()
    settings.mcp = { ...settings.mcp, servers: [] }

    expect(harness.service.statuses()).toEqual([])
  })
})

describe('calling tools', () => {
  it('asks before the first call, and runs it when allowed', async () => {
    harness = build(serverConfig())
    await harness.service.connect('fixture')

    const result = await harness.service.callTool('fixture', 'echo', { text: 'hello' })

    expect(harness.asked).toHaveLength(1)
    expect(result).toMatchObject({ text: 'hello', isError: false, denied: false })
  })

  it('does not run a tool the user refused, and says so plainly', async () => {
    harness = build(serverConfig())
    await harness.service.connect('fixture')
    harness.answer = { decision: 'deny' }

    const result = await harness.service.callTool('fixture', 'echo', { text: 'hello' })

    expect(result.denied).toBe(true)
    expect(result.text).not.toContain('hello')
  })

  it('stops asking once the answer is remembered', async () => {
    harness = build(serverConfig())
    await harness.service.connect('fixture')
    harness.answer = { decision: 'allow' }

    await harness.service.callTool('fixture', 'echo', { text: 'one' })
    await harness.service.callTool('fixture', 'echo', { text: 'two' })

    expect(harness.asked).toHaveLength(1)
    expect(harness.settings().mcp.permissions.remembered['fixture/echo']).toBe('allow')
  })

  it('asks every time about a destructive tool, however it was answered', async () => {
    harness = build(serverConfig())
    await harness.service.connect('fixture')
    harness.answer = { decision: 'allow' }

    await harness.service.callTool('fixture', 'wipe', {})
    await harness.service.callTool('fixture', 'wipe', {})

    expect(harness.asked).toHaveLength(2)
  })

  it('asks again after a plain refusal, which was about that one call', async () => {
    // The alternative was found by the theme audit: denying once banned the
    // tool for the rest of the session, which no button had said it would do.
    harness = build(serverConfig())
    await harness.service.connect('fixture')
    harness.answer = { decision: 'deny' }

    await harness.service.callTool('fixture', 'echo', { text: 'one' })
    await harness.service.callTool('fixture', 'echo', { text: 'two' })

    expect(harness.asked).toHaveLength(2)
    expect(harness.settings().mcp.permissions.remembered['fixture/echo']).toBeUndefined()
  })

  it('keeps refusing a tool that was refused for good, without asking again', async () => {
    harness = build(serverConfig())
    await harness.service.connect('fixture')
    harness.answer = { decision: 'never' }

    await harness.service.callTool('fixture', 'echo', { text: 'one' })
    const second = await harness.service.callTool('fixture', 'echo', { text: 'two' })

    expect(harness.asked).toHaveLength(1)
    expect(second.denied).toBe(true)
    expect(harness.settings().mcp.permissions.remembered['fixture/echo']).toBe('deny')
  })

  it('reads structured output when a tool returns it', async () => {
    harness = build(serverConfig())
    await harness.service.connect('fixture')
    const result = await harness.service.callTool('fixture', 'add', { a: 2, b: 3 })
    expect(result.text).toBe('5')
  })

  it('reports a tool that failed as an error, not as an answer', async () => {
    harness = build(serverConfig())
    await harness.service.connect('fixture')
    const result = await harness.service.callTool('fixture', 'explode', {})
    expect(result).toMatchObject({ isError: true, denied: false })
  })

  it('rejects arguments the server says are wrong', async () => {
    harness = build(serverConfig())
    await harness.service.connect('fixture')
    const result = await harness.service.callTool('fixture', 'add', { a: 'two', b: 3 })
    expect(result.isError).toBe(true)
  })

  it('gives up on a tool that never answers', async () => {
    harness = build(serverConfig(), 1200)
    await harness.service.connect('fixture')

    const result = await harness.service.callTool('fixture', 'hang', {})

    expect(result.isError).toBe(true)
    // And the connection is still usable afterwards.
    expect((await harness.service.callTool('fixture', 'echo', { text: 'alive' })).text).toBe(
      'alive'
    )
  }, 20_000)

  it('answers rather than throwing when the tool does not exist', async () => {
    harness = build(serverConfig())
    await harness.service.connect('fixture')
    const result = await harness.service.callTool('fixture', 'invented', {})
    expect(result).toMatchObject({ isError: true })
    expect(result.text).toContain('invented')
  })

  it('writes every call to the log, refusals included', async () => {
    harness = build(serverConfig())
    await harness.service.connect('fixture')
    harness.answer = { decision: 'allow' }
    await harness.service.callTool('fixture', 'echo', { text: 'logged' })
    harness.answer = { decision: 'deny' }
    await harness.service.callTool('fixture', 'wipe', {})

    const log = await new McpAudit(join(dir, 'log')).recent(10)
    expect(log.map((e) => [e.tool, e.outcome])).toEqual([
      ['wipe', 'denied'],
      ['echo', 'ok']
    ])
  })
})

describe('a server that dies', () => {
  it('is reported as failed and comes back on the next call', async () => {
    harness = build(serverConfig())
    await harness.service.connect('fixture')
    harness.answer = { decision: 'allow' }

    await harness.service.callTool('fixture', 'crash', {})
    await expect.poll(() => harness.service.statuses()[0]?.state, { timeout: 5000 }).toBe('failed')

    // The next call starts it again rather than failing forever.
    const result = await harness.service.callTool('fixture', 'echo', { text: 'back' })
    expect(result.text).toBe('back')
  }, 20_000)
})

describe('what a server may ask the client for', () => {
  it('answers roots with the vault, so a server knows where it may work', async () => {
    harness = build(serverConfig())
    await harness.service.connect('fixture')
    harness.answer = { decision: 'allow' }

    const result = await harness.service.callTool('fixture', 'where_am_i', {})
    expect(result.text).toContain('file://')
    expect(result.text).toContain(dir.split('/').pop() ?? '')
  })

  it("runs a sampling request through the user's own model, once allowed", async () => {
    harness = build(serverConfig())
    await harness.service.connect('fixture')
    harness.answer = { decision: 'allow' }

    const result = await harness.service.callTool('fixture', 'ask_the_model', {})

    expect(result.text).toContain('a model would say something about')
    // Two dialogs: one for the tool, one for lending the model.
    expect(harness.asked.map((ask) => ask.kind)).toEqual(['tool', 'sampling'])
  })

  it('tells a server the model was declined rather than failing the call', async () => {
    harness = build(serverConfig())
    await harness.service.connect('fixture')
    // The tool may run; lending the model may not. A refusal has to reach the
    // server as an answer, or a server that asks politely looks broken.
    harness.answer = { decision: 'allow' }
    harness.sampling = { decision: 'deny' }

    const result = await harness.service.callTool('fixture', 'ask_the_model', {})

    expect(result.text).toBe('The user declined this request.')
    expect(result.isError).toBe(false)
  })

  it('collects what a server elicits, and hands back what was typed', async () => {
    harness = build(serverConfig())
    await harness.service.connect('fixture')
    harness.answer = { decision: 'allow' }
    harness.elicit = { action: 'accept', content: { title: 'Q3 review' } }

    const result = await harness.service.callTool('fixture', 'ask_the_user', {})

    expect(result.text).toBe('accept:Q3 review')
    const elicitation = harness.asked.find((ask) => ask.kind === 'elicitation')
    expect((elicitation?.payload as { message: string }).message).toContain('report be called')
  })

  it('declines an elicitation the user closed, without failing the tool', async () => {
    harness = build(serverConfig())
    await harness.service.connect('fixture')
    harness.answer = { decision: 'allow' }
    harness.elicit = null

    const result = await harness.service.callTool('fixture', 'ask_the_user', {})

    // No answer is a cancellation, and the server is told so plainly.
    expect(result.text).toBe('cancel:')
    expect(result.isError).toBe(false)
  })
})

describe('resources and prompts', () => {
  it('reads a resource', async () => {
    harness = build(serverConfig())
    await harness.service.connect('fixture')
    expect(await harness.service.readResource('fixture', 'fixture://greeting')).toBe(
      'hello from the fixture'
    )
  })

  it('says what went wrong instead of throwing on a resource that is not there', async () => {
    harness = build(serverConfig())
    await harness.service.connect('fixture')
    expect(await harness.service.readResource('fixture', 'fixture://nothing')).toContain(
      'Could not read'
    )
  })

  it('renders a prompt with its arguments', async () => {
    harness = build(serverConfig())
    await harness.service.connect('fixture')
    expect(await harness.service.getPrompt('fixture', 'summarise', { subject: 'the vault' })).toBe(
      'Summarise the vault.'
    )
  })
})
