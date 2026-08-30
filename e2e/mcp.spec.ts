import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { closeCleanly, launchApp, openVault } from './helpers'

/**
 * MCP end to end, against the same fixture server the unit tests use.
 *
 * The point of these is the parts a unit test cannot reach: that the panel
 * shows what main knows, that the approval dialog is what stands between a tool
 * and running, and that answering it once is remembered while a destructive
 * tool keeps asking.
 */

let app: ElectronApplication
let page: Page
let vault: string

const FIXTURE = resolve(__dirname, '../src/main/services/__fixtures__/mcp-fixture-server.mjs')

async function runCommand(commandId: string): Promise<void> {
  await app.evaluate(({ BrowserWindow }, id) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('menu:command', { commandId: id })
  }, commandId)
}

/** Configure the fixture as an MCP server, the way the settings pane would. */
async function configureServer(command: string, args: string[]): Promise<void> {
  await page.evaluate(
    async ({ command: cmd, args: argv }) => {
      const current = await window.orrery.invoke('settings:get', undefined)
      await window.orrery.invoke('settings:set', {
        mcp: {
          ...current.mcp,
          servers: [
            {
              id: 'fixture',
              name: 'Fixture',
              enabled: true,
              transport: 'stdio',
              command: cmd,
              args: argv,
              env: {},
              cwd: ''
            }
          ],
          permissions: { remembered: {} },
          disabledTools: []
        }
      })
    },
    { command, args }
  )
}

const panel = (): ReturnType<Page['locator']> => page.locator('.mcp-panel')

/**
 * Show the MCP panel.
 *
 * The command toggles and the open panel is remembered across a reload, so
 * asking for it twice would close it. Check first.
 */
async function showMcpPanel(): Promise<void> {
  if (!(await panel().isVisible())) {
    await runCommand('view.toggleMcp')
    await expect(panel()).toBeVisible({ timeout: 15_000 })
  }
  // The card collapses whenever the panel remounts, which switching away and
  // back does. Expand only when it needs it, rather than toggling blind.
  const card = page.locator('.mcp-server__toggle')
  await expect(card).toBeVisible({ timeout: 15_000 })
  if ((await card.getAttribute('aria-expanded')) !== 'true') await card.click()
  await expect(card).toHaveAttribute('aria-expanded', 'true')
}

test.beforeAll(async () => {
  vault = mkdtempSync(join(tmpdir(), 'orrery-mcp-'))
  writeFileSync(join(vault, 'Note.md'), '# Note\n\nbody\n')
  app = await launchApp()
  page = await app.firstWindow()
  await page.waitForSelector('.app', { timeout: 30_000 })
  await openVault(page, vault, 'Note.md')
  // `process.execPath` here is Node, running the test: exactly what a real
  // stdio server is, a program on this machine.
  await configureServer(process.execPath, [FIXTURE])
  await runCommand('view.toggleMcp')
  await expect(panel()).toBeVisible()
})

test.afterAll(async () => {
  await closeCleanly(app, page)
  rmSync(vault, { recursive: true, force: true })
})

test('a configured server connects and says what it offers', async () => {
  await expect(page.locator('.mcp-server__name')).toHaveText('Fixture')

  await page.locator('button[aria-label="Connect Fixture"]').click()
  await expect(page.locator('.mcp-server__state')).toHaveText('Connected', { timeout: 20_000 })

  await page.locator('.mcp-server__toggle').click()
  await expect(page.locator('.mcp-tool__name')).toHaveCount(9)
  await expect(page.locator('.mcp-server__resource').first()).toBeVisible()
})

test('a tool run by hand asks first, then runs', async () => {
  await page.locator('.mcp-tool__name', { hasText: 'Echo' }).click()
  await page.locator('#fixture-echo-text').fill('hello from the test')
  await page.locator('.mcp-tool__run').click()

  // Nothing has run yet: the dialog is what stands between the two.
  const dialog = page.locator('.mcp-approve')
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('hello from the test')

  await dialog.getByRole('button', { name: 'Allow once', exact: true }).click()
  await expect(page.locator('.mcp-tool__result')).toHaveText('hello from the test')
})

test('the call is written to the log', async () => {
  await expect(page.locator('.mcp-log__row').first()).toContainText('echo')
})

test('refusing a tool means it does not run, and it asks again next time', async () => {
  await page.locator('.mcp-tool__name', { hasText: 'Echo' }).click() // collapse
  await page.locator('.mcp-tool__name', { hasText: 'explode' }).click()
  await page.locator('.mcp-tool__body .mcp-tool__run').click()

  const dialog = page.locator('.mcp-approve')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Deny', exact: true }).click()

  await expect(page.locator('.mcp-tool__result')).toContainText('refused')
  await expect(page.locator('.mcp-log__row').first()).toContainText('explode')

  // Deny was about that call. The next one asks again rather than being
  // refused by a rule nobody agreed to.
  await page.locator('.mcp-tool__body .mcp-tool__run').click()
  await expect(page.locator('.mcp-approve')).toBeVisible()
  await page.locator('.mcp-approve').getByRole('button', { name: 'Never allow' }).click()

  // "Never allow" is the one that sticks: no dialog, and a refusal.
  await page.locator('.mcp-tool__body .mcp-tool__run').click()
  await expect(page.locator('.mcp-tool__result')).toContainText('denied for this server')
  await expect(page.locator('.mcp-approve')).toHaveCount(0)

  await page.locator('.mcp-tool__name', { hasText: 'explode' }).click() // collapse
})

test('a destructive tool is never offered "always allow"', async () => {
  await page.locator('.mcp-tool__name', { hasText: 'wipe' }).click()
  await page.locator('.mcp-tool__body .mcp-tool__run').click()

  const dialog = page.locator('.mcp-approve')
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('destructive')
  // Offering it would be a promise the rules cannot keep.
  await expect(dialog.getByRole('button', { name: 'Always allow' })).toHaveCount(0)

  await dialog.getByRole('button', { name: 'Allow once', exact: true }).click()
  await expect(page.locator('.mcp-tool__result')).toHaveText('wiped')

  // And it asks again the very next time.
  await page.locator('.mcp-tool__body .mcp-tool__run').click()
  await expect(page.locator('.mcp-approve')).toBeVisible()
  await page.locator('.mcp-approve').getByRole('button', { name: 'Deny', exact: true }).click()
  await page.locator('.mcp-tool__name', { hasText: 'wipe' }).click() // collapse
})

test('"always allow" is remembered, and shows up in settings', async () => {
  await page.locator('.mcp-tool__name', { hasText: 'add' }).click()
  await page.locator('#fixture-add-a').fill('2')
  await page.locator('#fixture-add-b').fill('3')
  await page.locator('.mcp-tool__body .mcp-tool__run').click()

  await page
    .locator('.mcp-approve')
    .getByRole('button', { name: 'Always allow', exact: true })
    .click()
  await expect(page.locator('.mcp-tool__result')).toHaveText('5')

  // The second call goes straight through.
  await page.locator('#fixture-add-b').fill('4')
  await page.locator('.mcp-tool__body .mcp-tool__run').click()
  await expect(page.locator('.mcp-tool__result')).toHaveText('6')
  await expect(page.locator('.mcp-approve')).toHaveCount(0)

  const remembered = await page.evaluate(async () => {
    const settings = await window.orrery.invoke('settings:get', undefined)
    return settings.mcp.permissions.remembered
  })
  expect(remembered).toMatchObject({ 'fixture/add': 'allow' })
})

test('a server can ask the user for something, and gets what was typed', async () => {
  await page.locator('.mcp-tool__name', { hasText: 'add' }).click() // collapse
  await page.locator('.mcp-tool__name', { hasText: 'ask_the_user' }).click()
  await page.locator('.mcp-tool__body .mcp-tool__run').click()
  await page.locator('.mcp-approve').getByRole('button', { name: 'Allow once' }).click()

  // The server's own form, drawn from the schema it sent.
  const form = page.locator('[aria-label="A server is asking"]')
  await expect(form).toBeVisible({ timeout: 20_000 })
  await expect(form).toContainText('report be called')
  await form.locator('.schema-form__input').fill('Q3 review')
  await form.getByRole('button', { name: 'Send' }).click()

  await expect(page.locator('.mcp-tool__result')).toHaveText('accept:Q3 review')
})

test('closing that form cancels it rather than answering', async () => {
  await page.locator('.mcp-tool__body .mcp-tool__run').click()
  await page.locator('.mcp-approve').getByRole('button', { name: 'Allow once' }).click()

  const form = page.locator('[aria-label="A server is asking"]')
  await expect(form).toBeVisible({ timeout: 20_000 })
  await form.getByRole('button', { name: 'Cancel' }).click()

  await expect(page.locator('.mcp-tool__result')).toHaveText('cancel:')
  await page.locator('.mcp-tool__name', { hasText: 'ask_the_user' }).click() // collapse
})

test('a server asking where it may work is told the vault', async () => {
  await page.locator('.mcp-tool__name', { hasText: 'where_am_i' }).click()
  await page.locator('.mcp-tool__body .mcp-tool__run').click()
  await page.locator('.mcp-approve').getByRole('button', { name: 'Allow once' }).click()

  await expect(page.locator('.mcp-tool__result')).toContainText('file://', { timeout: 20_000 })
  await expect(page.locator('.mcp-tool__result')).toContainText('orrery-mcp-')
  await page.locator('.mcp-tool__name', { hasText: 'where_am_i' }).click() // collapse
})

test('a server asking to borrow the model has to ask the user too', async () => {
  // The provider is configured but unreachable: what is being tested is the
  // dialog and the round trip, not a model's answer.
  await page.evaluate(async () => {
    const current = await window.orrery.invoke('settings:get', undefined)
    await window.orrery.invoke('settings:set', {
      ai: {
        ...current.ai,
        provider: 'openai-compatible',
        compatUrl: 'http://127.0.0.1:9',
        compatKey: 'x',
        compatModel: 'x'
      }
    })
  })

  await page.locator('.mcp-tool__name', { hasText: 'ask_the_model' }).click()
  await page.locator('.mcp-tool__body .mcp-tool__run').click()
  await page.locator('.mcp-approve').getByRole('button', { name: 'Allow once' }).click()

  const borrow = page.locator('[aria-label="A server wants to use your model"]')
  await expect(borrow).toBeVisible({ timeout: 20_000 })
  await expect(borrow).toContainText('name three colours')

  await borrow.getByRole('button', { name: 'Decline' }).click()
  // Declined is an answer, so the tool completes rather than failing.
  await expect(page.locator('.mcp-tool__result')).toHaveText('The user declined this request.')
  await page.locator('.mcp-tool__name', { hasText: 'ask_the_model' }).click() // collapse
})

test('a prompt from a server lands in the chat box', async () => {
  // The chat only draws its box once a provider is configured, and the
  // renderer reads settings at boot, so this needs the reload.
  await page.reload()
  await page.waitForSelector('.app', { timeout: 30_000 })
  await showMcpPanel()
  await page.locator('.mcp-server__resource', { hasText: 'summarise' }).click()

  // It takes a subject, so it asks for one rather than sending none and
  // reporting whatever the server says about that.
  const form = page.locator('[aria-label="Prompt arguments"]')
  await expect(form).toBeVisible({ timeout: 15_000 })
  await form.locator('.schema-form__input').fill('the vault')
  await form.getByRole('button', { name: 'Use prompt' }).click()

  // The chat opens with the rendered prompt waiting, not sent.
  await expect(page.locator('.aichat__input')).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('.aichat__input')).toHaveValue(/Summarise the vault/)
})

test('a resource can be attached to the question', async () => {
  await showMcpPanel()
  await page.locator('.mcp-server__resource', { hasText: 'Greeting' }).click()

  // Appended to what was already in the box, and labelled with where it came
  // from: a question about "the file below" is ambiguous with two attached.
  await expect(page.locator('.aichat__input')).toHaveValue(/hello from the fixture/, {
    timeout: 15_000
  })
  await expect(page.locator('.aichat__input')).toHaveValue(/fixture:\/\/greeting/)
})

test('a form refuses to run with a required field empty', async () => {
  await showMcpPanel()
  await page.locator('.mcp-tool__name', { hasText: 'add' }).click()
  await page.locator('#fixture-add-a').fill('')
  await page.locator('.mcp-tool__body .mcp-tool__run').click()
  await expect(page.locator('.schema-form__error').first()).toHaveText('Required')
})
