import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { closeCleanly, launchApp, openVault } from './helpers'

/**
 * Edit, Hybrid and Read belong to one note, not to all of them.
 *
 * The switch in the header used to write `settings.editor.viewMode`. Reading
 * one note therefore decided how every note opened afterwards, and a new note,
 * which is empty, opened read-only: nothing on screen to read and no caret to
 * write with. Each spec that entered Reading put it back to Hybrid before it
 * finished, so nothing here ever opened a second note while one was being read.
 */
let app: ElectronApplication
let page: Page
let vault: string

const VAULT: Record<string, string> = {
  'Alpha.md': '# Alpha\n\nThe first note.\n',
  'Beta.md': '# Beta\n\nThe second note.\n',
  // Never opened before the default is Reading, so it has no mode of its own.
  'Gamma.md': '# Gamma\n\nThe third note.\n'
}

async function runCommand(commandId: string): Promise<void> {
  await app.evaluate(({ BrowserWindow }, id) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('menu:command', { commandId: id })
  }, commandId)
}

/** The note's own editor. An embed card would bring a `.cm-content` of its own. */
function editor() {
  return page.locator('.editor-pane .cm-content').first()
}

async function open(name: string): Promise<void> {
  await page.locator('.tree-row--file', { hasText: name }).click()
  await expect(page.locator('.tab--active')).toContainText(name.replace(/\.md$/, ''), {
    timeout: 15_000
  })
}

/** Which mode the header says, and whether the editor agrees about typing. */
async function expectMode(label: 'Edit' | 'Hybrid' | 'Read'): Promise<void> {
  await expect(page.locator('.header-viewmode__btn[aria-checked="true"]')).toHaveText(label, {
    timeout: 10_000
  })
  await expect(editor()).toHaveAttribute('contenteditable', label === 'Read' ? 'false' : 'true')
}

/** Through the settings panel, which is the one place meant to change it. */
async function setDefault(label: 'Edit' | 'Hybrid' | 'Reading'): Promise<void> {
  await runCommand('app.openSettings')
  await expect(page.locator('.settings')).toBeVisible()
  await page
    .locator('.settings__nav-item')
    .filter({ has: page.locator('.settings__nav-label', { hasText: /^Editor$/ }) })
    .click()
  await page
    .locator('.set-row', { hasText: 'Default view mode' })
    .locator('.segmented__item', { hasText: label })
    .click()
  await page.keyboard.press('Escape')
  await expect(page.locator('.settings')).toHaveCount(0)
}

async function savedDefault(): Promise<string> {
  return page.evaluate(
    async () => (await window.orrery.invoke('settings:get', undefined)).editor.viewMode
  )
}

test.beforeAll(async () => {
  vault = mkdtempSync(join(tmpdir(), 'orrery-view-mode-'))
  for (const [name, content] of Object.entries(VAULT)) writeFileSync(join(vault, name), content)
  app = await launchApp()
  page = await app.firstWindow()
  await page.waitForSelector('.app', { timeout: 30_000 })
  // Leaves the default at Hybrid.
  await openVault(page, vault, 'Alpha.md')
})

test.afterAll(async () => {
  await closeCleanly(app, page)
  rmSync(vault, { recursive: true, force: true })
})

// Each test sets up the modes it relies on. After a failure Playwright starts
// the app again for the tests that remain, and one leaning on the test before
// it would then pass against a default it never set. That is how the file tree
// case first passed with the rule it checks taken out.

test('reading one note leaves the next one editable', async () => {
  await open('Alpha.md')
  await expectMode('Hybrid')
  await page.locator('.header-viewmode__btn', { hasText: 'Read' }).click()
  await expectMode('Read')

  await open('Beta.md')
  await expectMode('Hybrid')

  // And coming back, the note that was being read still is.
  await open('Alpha.md')
  await expectMode('Read')
  expect(await savedDefault()).toBe('live')
})

test('the menu commands switch the note in front, not the default', async () => {
  await open('Alpha.md')
  await runCommand('view.modeReading')
  await expectMode('Read')

  await open('Beta.md')
  await runCommand('view.modeEdit')
  await expectMode('Edit')
  await expect(editor()).toContainText('# Beta')

  await open('Alpha.md')
  await expectMode('Read')
  await open('Beta.md')
  await runCommand('view.modeHybrid')
  await expectMode('Hybrid')
  expect(await savedDefault()).toBe('live')
})

test('changing the default moves a note nobody switched, and leaves one somebody did', async () => {
  await open('Alpha.md')
  await runCommand('view.modeReading')
  await expectMode('Read')

  await open('Gamma.md')
  await expectMode('Hybrid')
  await setDefault('Edit')
  // Gamma had no mode of its own, so it follows.
  await expectMode('Edit')

  await open('Alpha.md')
  await expectMode('Read')
  await setDefault('Hybrid')
})

test('with Reading as the default, a note with something in it opens read-only', async () => {
  await setDefault('Reading')
  // Closed first if it is open, so it opens again rather than being switched
  // back to with whatever mode it already had.
  const close = page.getByRole('button', { name: 'Close Gamma.md' })
  if ((await close.count()) > 0) await close.click()
  await open('Gamma.md')
  await expectMode('Read')
})

test('and a new note from Ctrl+N opens ready to type', async () => {
  await setDefault('Reading')
  // An untitled buffer with no text in it.
  await runCommand('file.new')
  await expect(page.locator('.tab--active')).toContainText('Untitled', { timeout: 15_000 })
  await expectMode('Hybrid')
  await editor().click()
  await page.keyboard.type('Written straight away')
  await expect(editor()).toContainText('Written straight away')
  // Emptied again, so the teardown has no unsaved note to ask about.
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.press('Backspace')
})

test('and so does a new note from the file tree', async () => {
  await setDefault('Reading')
  // A different path to the same blank note: an empty file made on disk, then
  // opened like any other file.
  await page.locator('.sidebar__actions button[title="New note (Ctrl+N)"]').click()
  await page.locator('.tree-newfile input').fill('Fresh')
  await page.locator('.tree-newfile input').press('Enter')
  await expect(page.locator('.tab--active')).toContainText('Fresh', { timeout: 15_000 })
  await expectMode('Hybrid')
  await editor().click()
  await page.keyboard.type('Also written')
  await expect(editor()).toContainText('Also written')
})
