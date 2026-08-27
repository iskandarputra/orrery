import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  test,
  expect,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { closeCleanly, launchApp, openVault } from './helpers'

let app: ElectronApplication
let page: Page
let vault: string

async function runCommand(commandId: string): Promise<void> {
  await app.evaluate(({ BrowserWindow }, id) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('menu:command', { commandId: id })
  }, commandId)
}

test.beforeAll(async () => {
  vault = mkdtempSync(join(tmpdir(), 'orrery-embed-'))
  writeFileSync(
    join(vault, 'Source.md'),
    '# Source\n\nintro text\n\n## Alpha\n\nthe alpha body\n\n## Beta\n\nthe beta body\n'
  )
  writeFileSync(
    join(vault, 'Host.md'),
    'Before the embed.\n\n![[Source]]\n\nBetween them.\n\n![[Source#Beta]]\n\n![[Nowhere]]\n\nAnd an inline ![[Source]] mid-sentence.\n'
  )
  app = await launchApp()
  page = await app.firstWindow()
  await page.waitForSelector('.app', { timeout: 30_000 })
  await openVault(page, vault, 'Host.md')
  await page.locator('.tree-row--file', { hasText: 'Host.md' }).click()
  await runCommand('view.modeReading')
  await page.waitForSelector('.cm-or-embed')
})

/**
 * The host editor's content. Embed cards render the note inside a nested
 * editor of their own, so a bare `.cm-content` matches those too.
 */
function hostContent() {
  return page.locator('.cm-content').first()
}

test.afterAll(async () => {
  await closeCleanly(app, page)
  rmSync(vault, { recursive: true, force: true })
})

test('embeds the whole note', async () => {
  const whole = page.locator('.cm-or-embed').first()
  await expect(whole).toContainText('intro text')
  await expect(whole).toContainText('the alpha body')
})

test('an embedded note is not announced as a second text box', async () => {
  const roles = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.cm-content')).map((el) => ({
      role: el.getAttribute('role'),
      inEmbed: !!el.closest('.cm-or-embed')
    }))
  )

  // Embeds mount a CodeMirror view of their own, and CodeMirror marks its
  // content as a textbox. Nested inside the host editor's textbox that is
  // invalid ARIA, and a note with two embeds would announce as three text
  // boxes rather than one document.
  expect(roles.filter((r) => r.inEmbed).length).toBeGreaterThan(0)
  expect(roles.filter((r) => !r.inEmbed && r.role === 'textbox')).toHaveLength(1)
  for (const entry of roles.filter((r) => r.inEmbed)) expect(entry.role).toBe('article')
})

test('embeds a single section when given a heading', async () => {
  // Match on the card's own title, not on its text: the whole-note card also
  // contains the word "Beta", as one of the headings it embeds.
  const section = page
    .locator('.cm-or-embed')
    .filter({ has: page.locator('.cm-or-embed-title', { hasText: '› Beta' }) })
  await expect(section).toContainText('the beta body')
  // Only that section — the sibling's body is not dragged along.
  await expect(section).not.toContainText('the alpha body')
})

test('says so when the target does not exist', async () => {
  const missing = page.locator('.cm-or-embed--missing')
  await expect(missing).toBeVisible()
  await expect(missing).toContainText("doesn't exist yet")
})

test('leaves an embed inside a sentence as text', async () => {
  // A card there would tear the paragraph in half.
  await expect(hostContent()).toContainText('And an inline')
  const cards = await page.locator('.cm-or-embed').count()
  expect(cards).toBe(3) // whole, section, missing — not the inline one
})

test('clicking a card reveals the markdown that produced it', async () => {
  await runCommand('view.modeHybrid')
  await expect(hostContent()).toHaveAttribute('contenteditable', 'true')

  // A block widget can't be arrowed into — CodeMirror steps over it — so the
  // card takes a click and puts the caret on its source, as images and
  // diagrams do here.
  await page.locator('.cm-or-embed').first().click()
  await expect(hostContent()).toContainText('![[Source]]')

  await runCommand('view.modeReading')
})
