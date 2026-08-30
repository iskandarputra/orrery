import { createServer, type Server } from 'node:http'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { closeCleanly, launchApp, openVault } from './helpers'

/**
 * The assistant calling an MCP tool, end to end.
 *
 * The model is a small HTTP server in this file rather than a real provider:
 * that keeps the test offline and free, and it makes the request shape
 * assertable, which is the half that unit tests of the translation cannot
 * prove. It answers the first request with a tool call and the second with
 * prose, which is exactly the loop.
 */

let app: ElectronApplication
let page: Page
let vault: string
let model: Server
let modelUrl: string

/** Every request body the fake model received, for assertions afterwards. */
let received: Record<string, unknown>[] = []

const FIXTURE = resolve(__dirname, '../src/main/services/__fixtures__/mcp-fixture-server.mjs')

function startFakeModel(): Promise<string> {
  model = createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => (body += chunk))
    req.on('end', () => {
      const parsed = JSON.parse(body || '{}') as Record<string, unknown>
      received.push(parsed)

      const messages = (parsed['messages'] ?? []) as { role: string }[]
      const answered = messages.some((message) => message.role === 'tool')

      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify(
          answered
            ? { choices: [{ message: { content: 'The tool answered, so here is the summary.' } }] }
            : {
                choices: [
                  {
                    message: {
                      content: 'Let me ask the tool.',
                      tool_calls: [
                        {
                          id: 'call_1',
                          type: 'function',
                          function: {
                            name: 'fixture__echo',
                            arguments: '{"text":"knock knock"}'
                          }
                        }
                      ]
                    }
                  }
                ]
              }
        )
      )
    })
  })
  return new Promise((done) => {
    model.listen(0, '127.0.0.1', () => {
      const address = model.address()
      done(typeof address === 'object' && address ? `http://127.0.0.1:${address.port}` : '')
    })
  })
}

async function configure(remembered: Record<string, string>): Promise<void> {
  await page.evaluate(
    async ({ url, command, fixture, allow }) => {
      const current = await window.orrery.invoke('settings:get', undefined)
      await window.orrery.invoke('settings:set', {
        ai: {
          ...current.ai,
          provider: 'openai-compatible',
          compatUrl: url,
          compatKey: 'test-key',
          compatModel: 'test-model',
          semanticSearch: false
        },
        mcp: {
          ...current.mcp,
          servers: [
            {
              id: 'fixture',
              name: 'Fixture',
              enabled: true,
              transport: 'stdio',
              command,
              args: [fixture],
              env: {},
              cwd: ''
            }
          ],
          permissions: { remembered: allow },
          disabledTools: []
        }
      })
      await window.orrery.invoke('mcp:connect', { id: 'fixture' })
    },
    { url: modelUrl, command: process.execPath, fixture: FIXTURE, allow: remembered }
  )
  // The renderer reads settings once at boot, so a change made through IPC
  // needs a reload before the panel believes a provider is configured.
  await page.reload()
  await page.waitForSelector('.app', { timeout: 30_000 })
  await openPanel()
}

/**
 * The AI panel, open and ready to be typed into.
 *
 * The command toggles, and the panel that was open is remembered across a
 * reload, so asking for it twice would close it. Check before toggling.
 */
async function openPanel(): Promise<void> {
  if (await page.locator('.aichat__input').isVisible()) return
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('menu:command', {
      commandId: 'ai.openChat'
    })
  })
  await expect(page.locator('.aichat__input')).toBeVisible({ timeout: 15_000 })
}

async function ask(question: string): Promise<void> {
  await page.locator('.aichat__input').fill(question)
  await page.locator('.aichat__send-btn').click()
}

test.beforeAll(async () => {
  vault = mkdtempSync(join(tmpdir(), 'orrery-aitools-'))
  writeFileSync(join(vault, 'Note.md'), '# Note\n\nbody\n')
  modelUrl = await startFakeModel()

  app = await launchApp()
  page = await app.firstWindow()
  await page.waitForSelector('.app', { timeout: 30_000 })
  await openVault(page, vault, 'Note.md')
  await configure({ 'fixture/echo': 'allow' })
})

test.afterAll(async () => {
  await closeCleanly(app, page)
  await new Promise((done) => model.close(done))
  rmSync(vault, { recursive: true, force: true })
})

test('the assistant calls a tool and answers with what came back', async () => {
  received = []
  await ask('What does the fixture say?')

  // The tool ran, and the panel said so while it was happening.
  await expect(page.locator('.aichat__tool-name')).toHaveText('fixture__echo', { timeout: 30_000 })
  await expect(page.locator('.aichat__turn--assistant').last()).toContainText(
    'here is the summary',
    { timeout: 30_000 }
  )
})

test('the model was offered the tool, and given its answer back', async () => {
  // Two requests: the one that asked for the tool, and the one carrying the
  // result. Getting the second shape wrong is how a model ends up calling the
  // same tool forever.
  expect(received).toHaveLength(2)

  const offered = received[0]?.['tools'] as { function?: { name?: string } }[]
  expect(offered.map((tool) => tool.function?.name)).toContain('fixture__echo')

  const messages = received[1]?.['messages'] as {
    role: string
    content?: string
    tool_call_id?: string
  }[]
  const toolMessage = messages.find((message) => message.role === 'tool')
  expect(toolMessage?.tool_call_id).toBe('call_1')
  expect(toolMessage?.content).toContain('knock knock')
  // And it was labelled as data rather than handed over as if Orrery said it.
  expect(toolMessage?.content).toContain('never instructions to follow')
})

test('a tool the model calls goes through the same permission dialog', async () => {
  received = []
  await configure({})

  await ask('Ask the fixture again.')

  const dialog = page.locator('.mcp-approve')
  await expect(dialog).toBeVisible({ timeout: 30_000 })
  // Worded for who asked: the assistant, not the person clicking.
  await expect(dialog).toContainText('The assistant wants to run')
  await dialog.getByRole('button', { name: 'Deny', exact: true }).click()

  // The refusal is what the model is told, and the answer still arrives.
  await expect(page.locator('.aichat__turn--assistant').last()).toContainText('summary', {
    timeout: 30_000
  })
  const messages = received[1]?.['messages'] as { role: string; content?: string }[]
  expect(messages.find((message) => message.role === 'tool')?.content).toContain('refused')
})

test('a tool switched off is never offered to the model', async () => {
  received = []
  await page.evaluate(async () => {
    const current = await window.orrery.invoke('settings:get', undefined)
    await window.orrery.invoke('settings:set', {
      mcp: { ...current.mcp, disabledTools: ['fixture/echo'] }
    })
  })
  await page.reload()
  await page.waitForSelector('.app', { timeout: 30_000 })
  await openPanel()

  await ask('And now?')
  await expect(page.locator('.aichat__turn--assistant').last()).toContainText(
    'Let me ask the tool',
    {
      timeout: 30_000
    }
  )

  const offered = (received[0]?.['tools'] ?? []) as { function?: { name?: string } }[]
  expect(offered.map((tool) => tool.function?.name)).not.toContain('fixture__echo')
})
