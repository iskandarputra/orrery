import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect, type Page } from '@playwright/test'
import type { ElectronApplication } from 'playwright'
import { closeCleanly, launchApp, openVault } from './helpers'

/**
 * Two zooms that must not be one zoom.
 *
 * Window zoom scales the whole interface, which is the right answer for a
 * screen too small or too far away. Page zoom scales only the document, which
 * is the right answer for prose set a little tight. Holding Shift is what picks
 * between them, and the point of this file is that each leaves the other alone.
 *
 * Driven through the command channel rather than by pressing keys: the chords
 * are caught in the main process by `before-input-event`, which nothing in a
 * test can make fire. Which spelling of the key maps to which zoom is a pure
 * function with unit tests of its own — see `core/zoom-keys`.
 */

let app: ElectronApplication
let page: Page
let vault: string

const run = async (commandId: string): Promise<void> => {
  await app.evaluate(({ BrowserWindow }, id) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('menu:command', { commandId: id })
  }, commandId)
  await page.waitForTimeout(400)
}

const documentSize = (): Promise<number> =>
  page
    .locator('.editor-pane')
    .first()
    .evaluate((el) => parseFloat(getComputedStyle(el).fontSize))

const windowZoom = (): Promise<number> =>
  app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.getZoomLevel())

test.beforeAll(async () => {
  vault = mkdtempSync(join(tmpdir(), 'orrery-zoom-'))
  writeFileSync(join(vault, 'Note.md'), '# Note\n\nSome prose to measure.\n')
  app = await launchApp()
  page = await app.firstWindow()
  await page.setViewportSize({ width: 1200, height: 800 })
  await page.waitForSelector('.app', { timeout: 30_000 })
  await openVault(page, vault, 'Note.md')
  await page.locator('.tree-row--file', { hasText: 'Note.md' }).click()
  await expect(page.locator('.cm-content')).toContainText('Some prose', { timeout: 15_000 })
})

test.afterAll(async () => {
  await run('view.pageZoomReset')
  await run('view.zoomReset')
  await closeCleanly(app, page)
  rmSync(vault, { recursive: true, force: true })
})

test('page zoom changes the document and not the window', async () => {
  const before = await documentSize()
  await run('view.pageZoomIn')
  await run('view.pageZoomIn')
  expect(await documentSize()).toBe(before + 2)
  expect(await windowZoom()).toBe(0)

  await run('view.pageZoomOut')
  expect(await documentSize()).toBe(before + 1)
  expect(await windowZoom()).toBe(0)

  await run('view.pageZoomReset')
  expect(await documentSize()).toBe(before)
})

test('window zoom changes the window and not the document', async () => {
  const before = await documentSize()
  await run('view.zoomIn')
  expect(await windowZoom()).toBe(1)
  // The interface got bigger; the document's own type size did not move.
  expect(await documentSize()).toBe(before)
  await run('view.zoomReset')
  expect(await windowZoom()).toBe(0)
})

test('the two are remembered separately', async () => {
  await run('view.pageZoomIn')
  await run('view.zoomIn')
  const settings = await page.evaluate(async () => {
    const s = await window.orrery.invoke('settings:get', undefined)
    return { fontSize: s.editor.fontSize, zoomLevel: s.zoomLevel }
  })
  expect(settings.fontSize).toBeGreaterThan(16)
  expect(settings.zoomLevel).toBe(1)
  await run('view.pageZoomReset')
  await run('view.zoomReset')
})

test('page zoom stops rather than running away', async () => {
  // A key held down must not shrink the document to nothing.
  for (let i = 0; i < 14; i++) await run('view.pageZoomOut')
  expect(await documentSize()).toBe(8)
  await run('view.pageZoomReset')
  expect(await documentSize()).toBe(16)
})
