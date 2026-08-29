import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect, type Page } from '@playwright/test'
import type { ElectronApplication } from 'playwright'
import { closeCleanly, launchApp, openVault } from './helpers'

/**
 * Excalidraw as a document surface.
 *
 * The point of these is not that a library renders — it is that a third-party
 * editor behaves like a first-class file type: it reads the format Excalidraw
 * itself writes, saves through the app's own save path, works with no network,
 * and cannot lose the drawing it was opening.
 */

const shape = (id: string, type: string, x: number, colour: string): Record<string, unknown> => ({
  id,
  type,
  x,
  y: 100,
  width: 200,
  height: 110,
  angle: 0,
  strokeColor: '#1e1e1e',
  backgroundColor: colour,
  fillStyle: 'solid',
  strokeWidth: 2,
  strokeStyle: 'solid',
  roughness: 1,
  opacity: 100,
  groupIds: [],
  frameId: null,
  roundness: { type: 3 },
  seed: 1,
  version: 1,
  versionNonce: 1,
  isDeleted: false,
  boundElements: [],
  updated: 1,
  link: null,
  locked: false
})

/** A drawing in Excalidraw's own format, as excalidraw.com would write it. */
const DRAWING = JSON.stringify(
  {
    type: 'excalidraw',
    version: 2,
    source: 'https://excalidraw.com',
    elements: [shape('a', 'rectangle', 120, '#a5d8ff'), shape('b', 'ellipse', 420, '#b2f2bb')],
    appState: { viewBackgroundColor: '#ffffff', gridSize: null },
    files: {}
  },
  null,
  2
)

let app: ElectronApplication
let page: Page
let vault: string

const file = (): string => join(vault, 'Board.excalidraw')
const read = (): { elements: unknown[]; type: string; source: string } =>
  JSON.parse(readFileSync(file(), 'utf-8'))

const openDrawing = async (): Promise<void> => {
  await page.locator('.tree-row--file', { hasText: 'Board.excalidraw' }).click()
  await expect(page.locator('.excalidraw')).toBeVisible({ timeout: 30_000 })
  await page.waitForSelector('.excalidraw canvas', { timeout: 30_000 })
  await page.waitForTimeout(1500)
}

const save = async (): Promise<void> => {
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('menu:command', { commandId: 'file.save' })
  })
  await page.waitForTimeout(1200)
}

test.beforeAll(async () => {
  vault = mkdtempSync(join(tmpdir(), 'orrery-excalidraw-'))
  writeFileSync(file(), DRAWING)
  writeFileSync(join(vault, 'Note.md'), '# Note\n')
  app = await launchApp()
  page = await app.firstWindow()
  await page.setViewportSize({ width: 1360, height: 850 })
  await page.waitForSelector('.app', { timeout: 30_000 })
  await openVault(page, vault, 'Note.md')
})

test.afterAll(async () => {
  await closeCleanly(app, page)
  rmSync(vault, { recursive: true, force: true })
})

test('a .excalidraw file opens as a drawing, not as its JSON', async () => {
  await openDrawing()
  // The surface, not a text editor showing the file's source.
  await expect(page.locator('.excalidraw canvas').first()).toBeVisible()
  await expect(page.locator('.editor-pane .cm-content')).toBeHidden()
})

test('it draws with no network, from the fonts in the bundle', async () => {
  // Excalidraw fetches its handwriting fonts at runtime and falls back to a CDN
  // — a request this app cannot make. Anything reaching for one is a bug that
  // would show up as missing glyphs on a machine that is offline.
  const remote = await page.evaluate(
    () =>
      performance.getEntriesByType('resource').filter((r) => /unpkg|jsdelivr|cdn\./.test(r.name))
        .length
  )
  expect(remote).toBe(0)
})

test('drawing is written back in Excalidraw own format', async () => {
  const box = (await page.locator('.excalidraw canvas').first().boundingBox())!
  await page.locator('.excalidraw [title^="Rectangle"]').first().click()
  await page.mouse.move(box.x + 250, box.y + 400)
  await page.mouse.down()
  await page.mouse.move(box.x + 420, box.y + 500, { steps: 12 })
  await page.mouse.up()
  await page.waitForTimeout(1200)

  // Dirty through the app's own tracking, because the edit goes into the
  // buffer's document rather than round the side to the file.
  await expect(page.locator('.tab--active .tab__dirty-dot')).toHaveCount(1)
  await save()

  const saved = read()
  expect(saved.type).toBe('excalidraw')
  expect(saved.elements).toHaveLength(3)
  await expect(page.locator('.tab--active .tab__dirty-dot')).toHaveCount(0)
})

/**
 * The regression this file exists for.
 *
 * The pane registers its editor view in an effect, so this surface can render
 * before there is any document to read. Reading too early yields an empty
 * scene, and Excalidraw's first change event would then write that emptiness
 * over the drawing — losing it on nothing more than a tab switch.
 */
test('reopening does not lose the drawing', async () => {
  const before = read().elements.length
  expect(before).toBeGreaterThan(0)

  await page.locator('.tree-row--file', { hasText: 'Note.md' }).click()
  await page.waitForTimeout(400)
  await openDrawing()
  await save()

  expect(read().elements).toHaveLength(before)
})

test('a drawing this app wrote reopens unedited', async () => {
  await page.locator('.tree-row--file', { hasText: 'Note.md' }).click()
  await page.waitForTimeout(400)
  await openDrawing()
  // Nothing was touched, so nothing should be marked as changed.
  await expect(page.locator('.tab--active .tab__dirty-dot')).toHaveCount(0)
})

test('the status bar describes a drawing, not a document that is not there', async () => {
  const bar = page.locator('.status-bar')
  // "Ln 1, Col 1 · 298 words · Spaces: 2 · UTF-8 · Markdown" was every one of
  // those numbers being about a text file that is not on screen.
  await expect(bar).toContainText('Excalidraw')
  await expect(bar).not.toContainText('Markdown')
  await expect(bar).not.toContainText('words')
  await expect(bar).not.toContainText('Ln ')
  await expect(bar).not.toContainText('UTF-8')

  // And it still says all of that for a note, so this hid the right things.
  await page.locator('.tree-row--file', { hasText: 'Note.md' }).click()
  await expect(page.locator('.editor-pane .cm-content')).toBeVisible({ timeout: 15_000 })
  await expect(bar).toContainText('Markdown')
  await expect(bar).toContainText('words')
})
