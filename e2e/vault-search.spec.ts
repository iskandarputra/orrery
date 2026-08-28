import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { launchApp, openVault } from './helpers'

let app: ElectronApplication
let page: Page
let vault: string

/**
 * Vault-wide search, end to end through the panel.
 *
 * This path had no e2e coverage at all, which also meant the Rust sidecar
 * behind `workspace:search` could not be proven to be in use. Because
 * `helpers.ts` passes `process.env` through to the launched app, the same spec
 * exercises the TypeScript implementation or the sidecar depending on
 * ORRERY_RUST_SEARCH, with no change here.
 */
test.beforeAll(async () => {
  vault = mkdtempSync(join(tmpdir(), 'orrery-vault-search-'))
  writeFileSync(join(vault, 'Index.md'), '# Index\n\nnothing special here\n')
  writeFileSync(join(vault, 'Alpha.md'), '# Alpha\n\nthe FINDME token lives here\n')
  writeFileSync(join(vault, 'Beta.md'), '# Beta\n\nanother FINDME on one line\nand FINDME again\n')
  mkdirSync(join(vault, 'nested'), { recursive: true })
  writeFileSync(join(vault, 'nested', 'Deep.md'), '# Deep\n\nFINDME nested away\n')
  writeFileSync(join(vault, 'ignored.txt'), 'FINDME in a non-markdown file\n')

  app = await launchApp()
  page = await app.firstWindow()
  await page.setViewportSize({ width: 1300, height: 850 })
  await page.waitForSelector('.app', { timeout: 30_000 })
  await openVault(page, vault, 'Index.md')
})

test.afterAll(async () => {
  await app.close()
  rmSync(vault, { recursive: true, force: true })
})

async function search(term: string): Promise<void> {
  const input = page.locator('.gsearch__input')
  // The command toggles, so opening an already-open panel would close it.
  if (!(await input.isVisible())) {
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.webContents.send('menu:command', {
        commandId: 'view.toggleSearch'
      })
    })
  }
  await expect(input).toBeVisible({ timeout: 10_000 })
  await input.fill(term)
  await input.press('Enter')
}

test('finds every match across the vault', async () => {
  await search('FINDME')
  // 4 hits: Alpha once, Beta twice, nested Deep once. The .txt is not markdown.
  await expect(page.locator('.rpanel-count__badge')).toHaveText('4', { timeout: 15_000 })
  const body = await page.locator('.gsearch').textContent()
  expect(body).toContain('3 notes')
})

test('reports nothing for a term that is absent', async () => {
  await search('ZZZ-NOT-PRESENT-ZZZ')
  await expect(page.locator('.gsearch')).toContainText('No matches found', { timeout: 15_000 })
})
