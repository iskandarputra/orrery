import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { closeCleanly, launchApp, openVault } from './helpers'

/**
 * Orrery serving the vault to somebody else's client.
 *
 * The client here is the real SDK, connecting over real HTTP to the running
 * app — which is the only way to prove the thing the feature claims: that
 * Claude Code, or anything else that speaks MCP, can read these notes.
 */

let app: ElectronApplication
let page: Page
let vault: string
let url = ''
let token = ''

async function connect(withToken = token): Promise<Client> {
  const client = new Client({ name: 'e2e', version: '1.0.0' }, { capabilities: {} })
  await client.connect(
    new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers: { Authorization: `Bearer ${withToken}` } }
    })
  )
  return client
}

const textOf = (result: { content?: unknown }): string =>
  ((result.content ?? []) as { type: string; text?: string }[])
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('\n')

async function setHost(patch: Record<string, unknown>): Promise<void> {
  await page.evaluate(async (next) => {
    const current = await window.orrery.invoke('settings:get', undefined)
    await window.orrery.invoke('settings:set', {
      mcp: { ...current.mcp, host: { ...current.mcp.host, ...next } }
    })
    await window.orrery.invoke('mcp:hostSync', undefined)
  }, patch)
}

test.beforeAll(async () => {
  vault = mkdtempSync(join(tmpdir(), 'orrery-host-'))
  writeFileSync(join(vault, 'Index.md'), '# Index\n\nA vault with [[Other]] in it.\n')
  writeFileSync(join(vault, 'Other.md'), '# Other\n\nThe word cassiopeia appears here.\n')

  app = await launchApp()
  page = await app.firstWindow()
  await page.waitForSelector('.app', { timeout: 30_000 })
  await openVault(page, vault, 'Index.md')

  // Port 0: the operating system picks one, so a developer's own server on
  // 7373 does not make this suite fail.
  await setHost({ enabled: true, port: 0, allowWrites: false })
  const status = await page.evaluate(() => window.orrery.invoke('mcp:hostStatus', undefined))
  url = status.url
  token = status.token
})

test.afterAll(async () => {
  await setHost({ enabled: false })
  await closeCleanly(app, page)
  rmSync(vault, { recursive: true, force: true })
})

test('a real MCP client can connect and see the vault tools', async () => {
  expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/)

  const client = await connect()
  const { tools } = await client.listTools()
  expect(tools.map((tool) => tool.name)).toContain('search_notes')
  // Writing is off, so those tools are not in the list at all rather than
  // being offered and refused.
  expect(tools.map((tool) => tool.name)).not.toContain('create_note')
  await client.close()
})

test('it refuses a request without the token', async () => {
  await expect(connect('wrong-token')).rejects.toThrow()
})

test('search, read and backlinks answer from the real vault', async () => {
  const client = await connect()

  const found = textOf(
    await client.callTool({ name: 'search_notes', arguments: { query: 'cassiopeia' } })
  )
  expect(found).toContain('Other.md')

  const note = textOf(await client.callTool({ name: 'read_note', arguments: { path: 'Other.md' } }))
  expect(note).toContain('cassiopeia')

  const links = textOf(await client.callTool({ name: 'backlinks', arguments: { note: 'Other' } }))
  expect(links).toContain('Index.md')

  await client.close()
})

test('a path that climbs out of the vault is refused', async () => {
  const client = await connect()
  const result = await client.callTool({
    name: 'read_note',
    arguments: { path: '../../etc/passwd' }
  })
  expect(result.isError).toBe(true)
  expect(textOf(result)).toContain('not inside the vault')
  await client.close()
})

test('notes are listed as resources and can be read as one', async () => {
  const client = await connect()
  const { resources } = await client.listResources()
  expect(resources.map((resource) => resource.name)).toContain('Index.md')

  const read = await client.readResource({ uri: 'orrery://note/Index.md' })
  expect((read.contents[0] as { text?: string }).text).toContain('A vault with')
  await client.close()
})

test('writing is refused while it is switched off', async () => {
  const client = await connect()
  const result = await client.callTool({
    name: 'create_note',
    arguments: { path: 'New.md', content: 'hello' }
  })
  expect(result.isError).toBe(true)
  expect(existsSync(join(vault, 'New.md'))).toBe(false)
  await client.close()
})

test('a write asks the user, and only then touches the file', async () => {
  await setHost({ allowWrites: true })
  const client = await connect()

  const call = client.callTool({
    name: 'create_note',
    arguments: { path: 'Written.md', content: '# Written by an agent\n' }
  })

  // The dialog is in front of the person at the keyboard, and the file does
  // not exist yet.
  const dialog = page.locator('.mcp-approve')
  await expect(dialog).toBeVisible({ timeout: 20_000 })
  await expect(dialog).toContainText('Written.md')
  expect(existsSync(join(vault, 'Written.md'))).toBe(false)

  await dialog.getByRole('button', { name: 'Allow once', exact: true }).click()
  const result = await call
  expect(result.isError).toBeFalsy()
  expect(readFileSync(join(vault, 'Written.md'), 'utf-8')).toContain('Written by an agent')

  await client.close()
})

test('a refused write leaves the vault alone', async () => {
  const client = await connect()
  const call = client.callTool({
    name: 'append_note',
    arguments: { path: 'Index.md', text: 'appended by an agent' }
  })

  const dialog = page.locator('.mcp-approve')
  await expect(dialog).toBeVisible({ timeout: 20_000 })
  await dialog.getByRole('button', { name: 'Deny', exact: true }).click()

  expect((await call).isError).toBe(true)
  expect(readFileSync(join(vault, 'Index.md'), 'utf-8')).not.toContain('appended by an agent')
  await client.close()
})

test('the stdio bridge is a working server for clients that need one', async () => {
  // What Claude Desktop launches: a program on stdio. It forwards to the same
  // endpoint, so this proves the path end to end rather than the shape of the
  // script.
  const client = new Client({ name: 'e2e-stdio', version: '1.0.0' }, { capabilities: {} })
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [resolve(__dirname, '../resources/mcp-stdio-bridge.mjs'), url, token]
    })
  )

  const { tools } = await client.listTools()
  expect(tools.map((tool) => tool.name)).toContain('search_notes')

  const read = await client.callTool({ name: 'read_note', arguments: { path: 'Other.md' } })
  expect(textOf(read)).toContain('cassiopeia')
  await client.close()
})

test('the bridge answers rather than hanging when the token is wrong', async () => {
  const client = new Client({ name: 'e2e-stdio-bad', version: '1.0.0' }, { capabilities: {} })
  await expect(
    client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [resolve(__dirname, '../resources/mcp-stdio-bridge.mjs'), url, 'wrong-token']
      })
    )
  ).rejects.toThrow()
})

test('everything a client did shows up in the log', async () => {
  const log = await page.evaluate(() => window.orrery.invoke('mcp:audit', { limit: 20 }))
  const tools = log.filter((entry) => entry.serverId === 'orrery').map((entry) => entry.tool)
  expect(tools).toContain('create_note')
  expect(tools).toContain('search_notes')
})

test('switching the server off closes the door', async () => {
  await setHost({ enabled: false })
  await expect(connect()).rejects.toThrow()
})
