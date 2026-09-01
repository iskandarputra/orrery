import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { launchApp, openVault } from './helpers'

/**
 * A note you have written but not yet given a file.
 *
 * Quitting with one open used to be a decision about it, and a bad one either
 * way: "Save All" opened a file picker before the app would close, and "Don't
 * Save" threw the note away for good — the session remembers tabs by path, and
 * an untitled note has none.
 *
 * The app is genuinely stopped and started again here, on the same application
 * data, because that is the only thing that proves what survives a quit.
 */

let vault: string
let userData: string
let app: ElectronApplication
let page: Page

/** Whatever the menu would have sent, sent. */
const command = async (commandId: string): Promise<void> => {
  await app.evaluate(({ BrowserWindow }, id) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('menu:command', { commandId: id })
  }, commandId)
}

const start = async (): Promise<void> => {
  app = await launchApp({ userData })
  page = await app.firstWindow()
  await page.setViewportSize({ width: 1200, height: 800 })
  await page.waitForSelector('.app', { timeout: 30_000 })
}

test.beforeAll(() => {
  vault = mkdtempSync(join(tmpdir(), 'orrery-hotexit-'))
  userData = mkdtempSync(join(tmpdir(), 'orrery-hotexit-ud-'))
  writeFileSync(join(vault, 'Note.md'), '# Note\n')
})

test.afterAll(() => {
  rmSync(vault, { recursive: true, force: true })
  rmSync(userData, { recursive: true, force: true })
})

test('quitting with an unsaved note does not ask about it', async () => {
  await start()
  await openVault(page, vault, 'Note.md')

  // A new note, with something in it. Through the command the menu sends,
  // because the button that does it lives in a tab bar that is not there until
  // something is open.
  await command('file.new')
  await expect(page.locator('.tab--active')).toContainText('Untitled', { timeout: 20_000 })
  await page.locator('.cm-content').click()
  await page.keyboard.type('# half an idea')
  await expect(page.locator('.tab--active .tab__dirty-dot')).toHaveCount(1, { timeout: 10_000 })

  // Quitting is not a question. If it were, this would hang on a dialog that
  // nothing in a headless run can answer, and time out rather than fail.
  await app.close()
})

test('and the note is there when the app comes back', async () => {
  await start()

  const tab = page.locator('.tab', { hasText: 'Untitled' })
  await expect(tab).toHaveCount(1, { timeout: 30_000 })
  // Still unsaved — it has nowhere to be yet, so it still carries the dot.
  await expect(tab.locator('.tab__dirty-dot')).toHaveCount(1)

  await tab.click()
  await expect(page.locator('.cm-content')).toContainText('# half an idea')
})

test('giving it a name stops it coming back', async () => {
  // The other half: once a note has a file, the file is where it lives.
  const saved = join(vault, 'Kept.md')
  await app.evaluate(({ dialog }, target) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: target }) as never
  }, saved)

  await page.locator('.tab', { hasText: 'Untitled' }).click()
  await command('file.save')
  await expect(page.locator('.tab', { hasText: 'Kept.md' })).toHaveCount(1, { timeout: 20_000 })
  await app.close()

  await start()
  // Back as a file in the vault, and not also as an unsaved note beside it.
  await expect(page.locator('.tab', { hasText: 'Untitled' })).toHaveCount(0, { timeout: 30_000 })
  await page.locator('.tree-row--file', { hasText: 'Kept.md' }).click()
  await expect(page.locator('.cm-content')).toContainText('# half an idea')
  await app.close()
})
