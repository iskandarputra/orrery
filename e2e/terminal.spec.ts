import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { closeCleanly, launchApp, openVault } from './helpers'

let app: ElectronApplication
let page: Page
let vault: string

const toggle = async (): Promise<void> => {
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('menu:command', {
      commandId: 'view.toggleTerminal'
    })
  })
}

/** What the terminal is currently showing, whitespace collapsed. */
const screen = async (): Promise<string> =>
  (await page.locator('.term-panel__host').textContent())?.replace(/\s+/g, ' ') ?? ''

test.beforeAll(async () => {
  vault = mkdtempSync(join(tmpdir(), 'orrery-terminal-'))
  writeFileSync(join(vault, 'Index.md'), '# Index\n')
  writeFileSync(join(vault, 'a-distinctive-name.md'), 'x\n')
  app = await launchApp()
  page = await app.firstWindow()
  await page.setViewportSize({ width: 1300, height: 900 })
  await page.waitForSelector('.app', { timeout: 30_000 })
  await openVault(page, vault, 'Index.md')
})

test.afterAll(async () => {
  await closeCleanly(app, page)
  rmSync(vault, { recursive: true, force: true })
})

test('the terminal opens and closes on the command', async () => {
  await toggle()
  await expect(page.locator('.term-panel')).toBeVisible({ timeout: 15_000 })
  await toggle()
  await expect(page.locator('.term-panel')).toBeHidden()
})

test('a real shell runs, and its output comes back', async () => {
  await toggle()
  await expect(page.locator('.term-panel')).toBeVisible({ timeout: 15_000 })
  // A pseudo-terminal, so this is a genuine interactive shell rather than a
  // command runner: it echoes, it prompts, and it answers.
  await page.locator('.term-panel__host').click()
  await page.keyboard.type('echo orrery-terminal-works')
  await page.keyboard.press('Enter')
  await expect.poll(screen, { timeout: 20_000 }).toContain('orrery-terminal-works')
})

test('it starts in the vault, so the notes are what ls shows', async () => {
  await expect(page.locator('.term-panel')).toBeVisible()
  await page.locator('.term-panel__host').click()
  await page.keyboard.type('ls')
  await page.keyboard.press('Enter')
  await expect.poll(screen, { timeout: 20_000 }).toContain('a-distinctive-name.md')
})

test('the shell is interactive, not one command at a time', async () => {
  await expect(page.locator('.term-panel')).toBeVisible()
  await page.locator('.term-panel__host').click()
  // A variable set by one command must survive into the next — it will not if
  // each command is spawned separately.
  await page.keyboard.type('ORRERY_STATE=kept')
  await page.keyboard.press('Enter')
  await page.keyboard.type('echo "value is $ORRERY_STATE"')
  await page.keyboard.press('Enter')
  await expect.poll(screen, { timeout: 20_000 }).toContain('value is kept')
})

test('closing the panel kills the shell', async () => {
  await expect(page.locator('.term-panel')).toBeVisible()
  await toggle()
  await expect(page.locator('.term-panel')).toBeHidden()
  // Reopening gives a fresh shell, not the previous session's scrollback.
  await toggle()
  await expect(page.locator('.term-panel')).toBeVisible({ timeout: 15_000 })
  await expect.poll(screen, { timeout: 15_000 }).not.toContain('value is kept')
  await toggle()
})
