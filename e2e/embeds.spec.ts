import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { closeCleanly, openVault } from './helpers'

let app: ElectronApplication
let page: Page
let vault: string

async function runCommand(commandId: string): Promise<void> {
  await app.evaluate(({ BrowserWindow }, id) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('menu:command', { commandId: id })
  }, commandId)
}

test.beforeAll(async () => {
  vault = mkdtempSync(join(tmpdir(), 'zymd-embed-'))
  writeFileSync(
    join(vault, 'Source.md'),
    '# Source\n\nintro text\n\n## Alpha\n\nthe alpha body\n\n## Beta\n\nthe beta body\n'
  )
  writeFileSync(
    join(vault, 'Host.md'),
    'Before the embed.\n\n![[Source]]\n\nBetween them.\n\n![[Source#Beta]]\n\n![[Nowhere]]\n\nAnd an inline ![[Source]] mid-sentence.\n'
  )
  app = await electron.launch({
    args: ['./out/main/index.js', '--no-sandbox'],
    env: { ...process.env, ELECTRON_DISABLE_SANDBOX: '1' }
  })
  page = await app.firstWindow()
  await page.waitForSelector('.app', { timeout: 30_000 })
  await openVault(page, vault, 'Host.md')
  await page.locator('.tree-row--file', { hasText: 'Host.md' }).click()
  await runCommand('view.modeReading')
  await page.waitForSelector('.cm-zy-embed')
})

test.afterAll(async () => {
  await closeCleanly(app, page)
  rmSync(vault, { recursive: true, force: true })
})

test('embeds the whole note', async () => {
  const whole = page.locator('.cm-zy-embed').first()
  await expect(whole).toContainText('intro text')
  await expect(whole).toContainText('the alpha body')
})

test('embeds a single section when given a heading', async () => {
  // Match on the card's own title, not on its text: the whole-note card also
  // contains the word "Beta", as one of the headings it embeds.
  const section = page
    .locator('.cm-zy-embed')
    .filter({ has: page.locator('.cm-zy-embed-title', { hasText: '› Beta' }) })
  await expect(section).toContainText('the beta body')
  // Only that section — the sibling's body is not dragged along.
  await expect(section).not.toContainText('the alpha body')
})

test('says so when the target does not exist', async () => {
  const missing = page.locator('.cm-zy-embed--missing')
  await expect(missing).toBeVisible()
  await expect(missing).toContainText("doesn't exist yet")
})

test('leaves an embed inside a sentence as text', async () => {
  // A card there would tear the paragraph in half.
  await expect(page.locator('.cm-content')).toContainText('And an inline')
  const cards = await page.locator('.cm-zy-embed').count()
  expect(cards).toBe(3) // whole, section, missing — not the inline one
})

test('clicking a card reveals the markdown that produced it', async () => {
  await runCommand('view.modeHybrid')
  await expect(page.locator('.cm-content')).toHaveAttribute('contenteditable', 'true')

  // A block widget can't be arrowed into — CodeMirror steps over it — so the
  // card takes a click and puts the caret on its source, as images and
  // diagrams do here.
  await page.locator('.cm-zy-embed').first().click()
  await expect(page.locator('.cm-content')).toContainText('![[Source]]')

  await runCommand('view.modeReading')
})
