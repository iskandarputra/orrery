import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { closeCleanly, launchApp, openVault } from './helpers'

/**
 * Tooltips, and how long they take.
 *
 * The operating system's own waits about a second and cannot be hurried from a
 * page, so the app draws its own. The number that matters is how long it takes
 * to appear, which is why these measure rather than merely check.
 */

let app: ElectronApplication
let page: Page
let vault: string

test.beforeAll(async () => {
  vault = mkdtempSync(join(tmpdir(), 'orrery-tips-'))
  writeFileSync(join(vault, 'Index.md'), '# Index\n\nSomething to look at.\n')
  app = await launchApp()
  page = await app.firstWindow()
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.waitForSelector('.app', { timeout: 30_000 })
  await openVault(page, vault, 'Index.md')
})

test.afterAll(async () => {
  await closeCleanly(app, page)
  rmSync(vault, { recursive: true, force: true })
})

/** How long a tooltip takes to appear over this control. */
async function timeToTip(selector: string): Promise<number> {
  await page.mouse.move(0, 0)
  await expect(page.locator('.tip')).toHaveCount(0)
  const target = page.locator(selector).first()
  const box = (await target.boundingBox())!
  const started = Date.now()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await expect(page.locator('.tip')).toBeVisible({ timeout: 5_000 })
  return Date.now() - started
}

test('a tooltip appears as soon as you look at a control', async () => {
  // The native one waits about a second. Anything under a quarter of that reads
  // as immediate; this is measured rather than assumed.
  const took = await timeToTip('.sidebar-rail__btn')
  expect(took).toBeLessThan(400)
  await expect(page.locator('.tip')).toContainText(/./)
})

test('it says what the control says', async () => {
  await page.mouse.move(0, 0)
  const button = page.locator('button[title="Refresh files"]').first()
  const box = (await button.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await expect(page.locator('.tip')).toContainText('Refresh', { timeout: 5_000 })
})

test('only one appears, and it goes when you look away', async () => {
  await page.mouse.move(0, 0)
  const first = (await page.locator('.sidebar-rail__btn').first().boundingBox())!
  await page.mouse.move(first.x + first.width / 2, first.y + first.height / 2)
  await expect(page.locator('.tip')).toBeVisible({ timeout: 5_000 })

  const second = (await page.locator('.sidebar-rail__btn').nth(1).boundingBox())!
  await page.mouse.move(second.x + second.width / 2, second.y + second.height / 2)
  // Moving along a row of icons leaves one tooltip behind, not a trail of them.
  await expect(page.locator('.tip')).toHaveCount(1)

  await page.mouse.move(640, 500)
  await expect(page.locator('.tip')).toHaveCount(0, { timeout: 5_000 })
})

test('the native tooltip is suppressed while hovering, and restored after', async () => {
  // Both at once would mean the app's tooltip and then a second copy from the
  // operating system on top of it. The attribute has to come back, because it
  // is what assistive technology and half the tests read.
  const button = page.locator('.sidebar__actions button').filter({ hasText: '' }).nth(3)
  const box = (await page.locator('button[title="Refresh files"]').first().boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await expect(page.locator('.tip')).toBeVisible({ timeout: 5_000 })

  // While the pointer is on it the title is away — that is what stops the
  // operating system putting its own copy on top a second later — but the
  // control keeps its name, lent from the title it gave up.
  const hovered = await page.evaluate(() => {
    const el = document.querySelector('.sidebar__actions button[aria-label="Refresh files"]')
    return { title: el?.getAttribute('title'), label: el?.getAttribute('aria-label') }
  })
  expect(hovered.title).toBeNull()
  expect(hovered.label).toBe('Refresh files')

  await page.mouse.move(640, 500)
  await expect(page.locator('.tip')).toHaveCount(0, { timeout: 5_000 })
  // And it is put back, because it is what assistive technology and half the
  // tests read.
  await expect(page.locator('button[title="Refresh files"]')).toHaveCount(1)
  expect(await button.getAttribute('aria-label')).toBeNull()
})

test('a tooltip stays on screen at the edges', async () => {
  // The last button in a row is against the window's edge, and a tooltip
  // centred on it would hang off the side.
  await page.mouse.move(0, 0)
  const last = page.locator('.rpanel-rail button').last()
  const box = (await last.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await expect(page.locator('.tip')).toBeVisible({ timeout: 5_000 })

  const tip = (await page.locator('.tip').boundingBox())!
  const size = page.viewportSize()!
  expect(tip.x).toBeGreaterThanOrEqual(0)
  expect(tip.x + tip.width).toBeLessThanOrEqual(size.width)
  expect(tip.y).toBeGreaterThanOrEqual(0)
  expect(tip.y + tip.height).toBeLessThanOrEqual(size.height)
})

test('a labelled region does not describe itself when you point inside it', async () => {
  // Whole areas carry a label for screen readers — the workspace rail is
  // "Workspace", a diff is "Changes in such a file". Pointing at the space
  // inside one should say nothing: it is a description of the room, not of the
  // thing under the pointer.
  await page.mouse.move(0, 0)
  await expect(page.locator('.tip')).toHaveCount(0)

  // The empty part of the workspace rail, below its buttons: inside a labelled
  // region, on no control at all.
  const rail = (await page.locator('nav[aria-label="Workspace"]').boundingBox())!
  await page.mouse.move(rail.x + rail.width / 2, rail.y + rail.height - 6)
  await page.waitForTimeout(400)
  await expect(page.locator('.tip')).toHaveCount(0)
})

test('the editor keeps its own hover to itself', async () => {
  // CodeMirror owns that DOM, watches it for changes, and has hover tooltips of
  // its own — a language server's, for one. Borrowing a title from inside it
  // would be a mutation under its observer and a second bubble over its own.
  await page.locator('.tree-row--file', { hasText: 'Index.md' }).click()
  await expect(page.locator('.cm-content')).toBeVisible({ timeout: 15_000 })
  await page.mouse.move(0, 0)
  const line = page.locator('.cm-content .cm-line').first()
  const box = (await line.boundingBox())!
  await page.mouse.move(box.x + 20, box.y + box.height / 2)
  await page.waitForTimeout(400)
  await expect(page.locator('.tip')).toHaveCount(0)
})
