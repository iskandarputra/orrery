import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect } from '@playwright/test'
import { closeCleanly, launchApp, openVault } from './helpers'

/**
 * Two notes that embed each other.
 *
 * An embedded note is rendered by mounting a second editor with the live
 * preview extensions. If those extensions include embed rendering, the embedded
 * note mounts an editor for *its* embed, and so on: a pair of notes pointing at
 * each other has no bottom. Nothing bounded it — the 1200-character cap trims
 * the text shown but leaves the embed syntax inside it intact.
 */
test('mutually embedded notes render without recursing', async () => {
  const vault = mkdtempSync(join(tmpdir(), 'orrery-embed-'))
  writeFileSync(join(vault, 'A.md'), '# A\n\nSome text in A.\n\n![[B]]\n')
  writeFileSync(join(vault, 'B.md'), '# B\n\nSome text in B.\n\n![[A]]\n')

  const app = await launchApp()
  const page = await app.firstWindow()
  await page.waitForSelector('.app', { timeout: 30_000 })
  await openVault(page, vault, 'A.md')
  await page.locator('.tree-row--file', { hasText: 'A.md' }).click()

  // It renders at all: a stack overflow would leave the editor blank or hang
  // the renderer, and neither shows the note.
  await expect(page.locator('.cm-content').first()).toContainText('Some text in A', {
    timeout: 15_000
  })
  await expect(page.locator('.cm-or-embed').first()).toBeVisible({ timeout: 15_000 })
  await page.waitForTimeout(1500)

  const nesting = await page.evaluate(() => {
    const embeds = Array.from(document.querySelectorAll('.cm-or-embed'))
    // How deep does any embed sit inside another?
    return Math.max(0, ...embeds.map((el) => el.querySelectorAll('.cm-or-embed').length))
  })
  expect(nesting, 'an embed never contains another embed').toBe(0)

  // And the page is still responsive, which a runaway mount would not leave it.
  expect(await page.evaluate(() => 1 + 1)).toBe(2)

  await closeCleanly(app, page)
  rmSync(vault, { recursive: true, force: true })
})
