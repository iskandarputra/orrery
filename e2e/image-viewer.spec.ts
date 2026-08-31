import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { closeCleanly, launchApp, openVault } from './helpers'
import { makePng } from '../src/main/services/__fixtures__/make-png'

/**
 * Pictures, opened as pictures.
 *
 * Before this surface existed a PNG opened in the text editor as its own bytes
 * decoded as UTF-8 — and one Ctrl+S from writing that back over the file.
 */

/** 64x64, red, and small enough to read in a test. */
const PNG = makePng(64, 64)

let app: ElectronApplication
let page: Page
let vault: string

test.beforeAll(async () => {
  vault = mkdtempSync(join(tmpdir(), 'orrery-img-'))
  writeFileSync(join(vault, 'Note.md'), '# Note\n')
  writeFileSync(join(vault, 'picture.png'), PNG)
  writeFileSync(join(vault, 'photo.JPG'), PNG) // the extension, not the bytes
  writeFileSync(join(vault, 'drawing.svg'), '<svg xmlns="http://www.w3.org/2000/svg"></svg>\n')
  app = await launchApp()
  page = await app.firstWindow()
  await page.setViewportSize({ width: 1200, height: 800 })
  await page.waitForSelector('.app', { timeout: 30_000 })
  await openVault(page, vault, 'Note.md')
})

test.afterAll(async () => {
  await closeCleanly(app, page)
  rmSync(vault, { recursive: true, force: true })
})

test('an image opens as a picture, not as its bytes', async () => {
  await page.locator('.tree-row--file', { hasText: 'picture.png' }).click()
  await expect(page.locator('.imgv')).toBeVisible({ timeout: 20_000 })
  // The text editor is not involved: it used to show the PNG header decoded as
  // UTF-8, which is a screenful of replacement characters.
  await expect(page.locator('.editor-pane .cm-content')).toBeHidden()
  await expect(page.locator('.imgv__image')).toBeVisible()
})

test('it says how big the picture is', async () => {
  // "Is this the big one or the thumbnail" is the question people actually have.
  await expect(page.locator('.imgv__size')).toHaveText('64 × 64', { timeout: 10_000 })
})

test('it fits the window, and can be seen at its own size', async () => {
  // A small picture is never blown up to fill the window: that is a blurry mess
  // nobody asked for.
  await expect(page.locator('.imgv__zoom')).toHaveText('100%')

  await page.locator('button[aria-label="Zoom in"]').click()
  await expect(page.locator('.imgv__zoom')).not.toHaveText('100%')
  const wider = await page
    .locator('.imgv__image')
    .evaluate((el) => el.getBoundingClientRect().width)
  expect(wider).toBeGreaterThan(64)

  await page.locator('button[aria-label="Actual size"]').click()
  await expect(page.locator('.imgv__zoom')).toHaveText('100%')
  await expect
    .poll(() => page.locator('.imgv__image').evaluate((el) => el.getBoundingClientRect().width))
    .toBeCloseTo(64, 0)
})

test('the extension is what counts, whatever its case', async () => {
  await page.locator('.tree-row--file', { hasText: 'photo.JPG' }).click()
  await expect(page.locator('.imgv')).toBeVisible({ timeout: 20_000 })
})

test('looking at a picture never writes to it', async () => {
  // The tab has no document to save, so there is nothing that could be written
  // back over the file — which is exactly what the old behaviour risked.
  const before = statSync(join(vault, 'picture.png')).mtimeMs
  await page.locator('.tree-row--file', { hasText: 'picture.png' }).click()
  await expect(page.locator('.imgv')).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('.tab--active .tab__dirty-dot')).toHaveCount(0)
  expect(statSync(join(vault, 'picture.png')).mtimeMs).toBe(before)
  expect(readFileSync(join(vault, 'picture.png')).length).toBe(PNG.length)
})

test('ctrl and the wheel zooms the picture', async () => {
  // The toolbar was the only way in or out. Ctrl with the wheel is how a
  // picture is zoomed everywhere else, and plain scrolling still has to move
  // around one that is already too big for the pane.
  await page.locator('.tree-row--file', { hasText: 'picture.png' }).click()
  await expect(page.locator('.imgv__image')).toBeVisible({ timeout: 20_000 })

  const before = Number((await page.locator('.imgv__zoom').textContent())?.replace('%', ''))
  await page.locator('.imgv__stage').hover()
  await page.keyboard.down('Control')
  await page.mouse.wheel(0, -400)
  await page.keyboard.up('Control')

  await expect
    .poll(async () => Number((await page.locator('.imgv__zoom').textContent())?.replace('%', '')), {
      timeout: 10_000
    })
    .toBeGreaterThan(before)
})

test('an svg still opens as text, because it is also a file you edit', async () => {
  // SVG is a picture and a document at once, and there is nowhere in this app
  // to ask for the other one — so the surface leaves it alone rather than
  // quietly removing the only way to change one.
  await page.locator('.tree-row--file', { hasText: 'drawing.svg' }).click()
  await expect(page.locator('.cm-content').first()).toContainText('http://www.w3.org/2000/svg', {
    timeout: 20_000
  })
  await expect(page.locator('.imgv')).toHaveCount(0)
})
