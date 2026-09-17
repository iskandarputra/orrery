import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { closeCleanly, launchApp, openVault } from './helpers'

/**
 * A command run in the integrated terminal reaches source control.
 *
 * It was the one change nothing reported: a file written by a shell command in
 * a folder the tree has closed is outside every watch, nothing was saved, and
 * the window never lost focus. So the count on the source control icon stayed
 * where it was until something else happened.
 */
let app: ElectronApplication
let page: Page
let vault: string

const git = (...args: string[]): void => {
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], {
    cwd: vault,
    stdio: 'ignore'
  })
}

const badge = () => page.locator('.sidebar-rail__badge')

test.beforeAll(async () => {
  vault = mkdtempSync(join(tmpdir(), 'orrery-terminal-git-'))
  mkdirSync(join(vault, 'deep', 'inner'), { recursive: true })
  writeFileSync(join(vault, 'Index.md'), '# Index\n')
  writeFileSync(join(vault, 'deep', 'inner', 'keep.md'), 'kept\n')
  git('init', '-q', '.')
  git('add', '.')
  git('commit', '-qm', 'base')

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

test('a file made by a terminal command is counted without anything else happening', async () => {
  // Clean to begin with, and the folder is closed in the tree.
  await expect(page.locator('.tree-row--file', { hasText: 'Index.md' })).toBeVisible()
  await expect(badge()).toHaveCount(0)
  await expect(page.locator('.tree-row--file', { hasText: 'keep.md' })).toHaveCount(0)

  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('menu:command', {
      commandId: 'view.toggleTerminal'
    })
  })
  await expect(page.locator('.term-panel')).toBeVisible({ timeout: 15_000 })
  await page.locator('.term-panel__host').click()
  await page.keyboard.type('echo made > deep/inner/made.md')
  await page.keyboard.press('Enter')

  // No save, no focus change, no panel opened: only the command finishing.
  await expect(badge()).toHaveText('1', { timeout: 15_000 })
})
