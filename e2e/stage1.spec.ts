import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect, type Page } from '@playwright/test'
import type { ElectronApplication } from 'playwright'
import { closeCleanly, launchApp, openVault } from './helpers'

/**
 * Bookmarks, outgoing links, footnotes, random note and unique notes.
 *
 * Five things Obsidian ships that Orrery did not.
 */

const NOTE = [
  '# Orbital mechanics',
  '',
  'See [[Kepler]] and [[Missing note]] and [[Kepler#Second law]].',
  '',
  'A claim.[^src] Another.[^aside] The first again.[^src]',
  '',
  '[^src]: Newton, 1687.',
  '[^aside]: A longer remark.'
].join('\n')

let app: ElectronApplication
let page: Page
let vault: string

/**
 * Show a panel, whether or not it is already showing.
 *
 * The rail button toggles, so clicking it blindly closes a panel that a
 * previous test left open. Asking first is what makes these independent of the
 * order they run in.
 */
const showPanel = async (label: string): Promise<void> => {
  const tab = page.locator(`.rpanel__tab[aria-label="${label}"]`)
  // Asked of the rail, not of the panel body: an empty-state element is shared
  // by every panel, so "is something showing" cannot tell them apart.
  if ((await tab.getAttribute('aria-selected')) !== 'true') await tab.click()
  await expect(tab).toHaveAttribute('aria-selected', 'true', { timeout: 10_000 })
}

const run = async (commandId: string): Promise<void> => {
  await app.evaluate(({ BrowserWindow }, id) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('menu:command', { commandId: id })
  }, commandId)
  await page.waitForTimeout(500)
}

const open = async (name: string): Promise<void> => {
  await page.locator('.tree-row--file', { hasText: name }).click()
  await expect(page.locator('.cm-content').first()).toBeVisible({ timeout: 15_000 })
  await page.waitForTimeout(400)
}

test.beforeAll(async () => {
  vault = mkdtempSync(join(tmpdir(), 'orrery-stage1-'))
  writeFileSync(join(vault, 'Orbital.md'), NOTE)
  writeFileSync(join(vault, 'Kepler.md'), '# Kepler\n\n## Second law\n\nAreas.\n')
  writeFileSync(join(vault, 'Other.md'), '# Other\n')
  app = await launchApp()
  page = await app.firstWindow()
  await page.setViewportSize({ width: 1320, height: 880 })
  await page.waitForSelector('.app', { timeout: 30_000 })
  await openVault(page, vault, 'Orbital.md')
})

test.afterAll(async () => {
  await closeCleanly(app, page)
  rmSync(vault, { recursive: true, force: true })
})

test('outgoing links list what this note points at, missing ones included', async () => {
  await open('Orbital.md')
  await showPanel('Outgoing')
  const rows = page.locator('.outgoing__row')
  await expect(rows).toHaveCount(3)
  await expect(page.locator('.outgoing__row', { hasText: 'Missing note' })).toHaveClass(
    /outgoing__row--missing/
  )
  // A link to a note you have not written is either a typo or the next note to
  // write, so it is listed rather than hidden.
  await expect(page.locator('.outgoing')).toContainText('1 missing')
})

test('an outgoing link opens the note it points at', async () => {
  await page.locator('.outgoing__row', { hasText: 'Kepler#' }).first().click()
  await expect(page.locator('.tab--active')).toContainText('Kepler.md')
})

test('bookmarks persist a file the user pinned', async () => {
  await open('Kepler.md')
  await run('note.toggleBookmark')
  await showPanel('Bookmarks')
  await expect(page.locator('.bookmarks__row')).toHaveCount(1)
  await expect(page.locator('.bookmarks__name')).toContainText('Kepler.md')
})

test('a bookmark opens, and can be removed', async () => {
  await open('Other.md')
  await showPanel('Bookmarks')
  await page.locator('.bookmarks__open').click()
  await expect(page.locator('.tab--active')).toContainText('Kepler.md')

  await page.getByLabel('Remove bookmark for Kepler.md').click()
  await expect(page.locator('.rpanel-empty')).toContainText('Nothing pinned')
})

test('footnote markers render as numbers, by order of first use', async () => {
  await open('Orbital.md')
  const markers = page.locator('.cm-or-footnote')
  await expect(markers).toHaveCount(3)
  // `[^src]` twice and `[^aside]` once: 1, 2, 1 rather than the labels.
  await expect(markers.nth(0)).toHaveText('1')
  await expect(markers.nth(1)).toHaveText('2')
  await expect(markers.nth(2)).toHaveText('1')
})

test('clicking a marker jumps to its definition', async () => {
  await open('Orbital.md')
  await page.locator('.cm-or-footnote').nth(1).click()
  await expect
    .poll(
      async () => {
        const bar = await page.locator('.status-bar').textContent()
        return Number(/Ln (\d+)/.exec(bar ?? '')?.[1] ?? 0)
      },
      { timeout: 10_000 }
    )
    .toBe(8)
})

test('the definitions are set apart from the prose', async () => {
  await open('Orbital.md')
  await expect(page.locator('.cm-or-footnote-def')).toHaveCount(2)
})

test('a unique note is named for the minute it was made', async () => {
  await run('note.newUnique')
  await expect
    .poll(() => readdirSync(vault).filter((f) => /^\d{12}\.md$/.test(f)).length, {
      timeout: 10_000
    })
    .toBe(1)
  await expect(page.locator('.tab--active')).toContainText('.md')
})

test('random opens a note, and only a note', async () => {
  await run('note.random')
  // Notes rather than every file: the point is to meet something you wrote and
  // forgot, and a lockfile is not that.
  await expect(page.locator('.tab--active')).toContainText('.md')
})
