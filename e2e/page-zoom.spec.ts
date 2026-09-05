import { execFileSync } from 'node:child_process'
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

/** A table of rows, which is the other surface that lays out to its own size. */
function makeDatabase(path: string): void {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { DatabaseSync } = require('node:sqlite') as {
    DatabaseSync: new (p: string) => { exec(sql: string): void; close(): void }
  }
  const db = new DatabaseSync(path)
  db.exec(`
    CREATE TABLE rows (name TEXT, value INTEGER);
    INSERT INTO rows VALUES ('alpha', 1), ('beta', 2);
  `)
  db.close()
}

const git = (...args: string[]): void => {
  execFileSync('git', args, { cwd: vault, stdio: 'ignore' })
}

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
  // The surfaces that are documents but are not the text editor.
  writeFileSync(join(vault, 'data.csv'), 'name,value\nalpha,1\nbeta,2\n')
  writeFileSync(join(vault, 'page.html'), '<h1>Page</h1><p>Body text to measure.</p>')
  makeDatabase(join(vault, 'rows.db'))
  // A diff is two text documents, and needs a repository with a change in it.
  writeFileSync(join(vault, 'Diffme.md'), 'alpha\nbeta\n')
  git('init', '-q', '.')
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'Test')
  git('config', 'commit.gpgsign', 'false')
  git('add', '.')
  git('commit', '-qm', 'base')
  writeFileSync(join(vault, 'Diffme.md'), 'alpha\nan added line\nbeta\n')

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

test('a table follows page zoom too', async () => {
  // A sheet is a document, and the shortcut that grows the prose in a note
  // should grow the figures in a table. It laid out to its own fixed size
  // before, so the key moved the setting and nothing on screen changed.
  await page.locator('.tree-row--file', { hasText: 'data.csv' }).click()
  await expect(page.locator('.csv__table')).toBeVisible({ timeout: 15_000 })
  const size = (): Promise<number> =>
    page.locator('.csv__table').evaluate((e) => parseFloat(getComputedStyle(e).fontSize))

  const before = await size()
  await run('view.pageZoomIn')
  await run('view.pageZoomIn')
  expect(await size()).toBeGreaterThan(before)
  await run('view.pageZoomReset')
  expect(await size()).toBeCloseTo(before, 1)
})

test('a rendered page follows it, and still fits its pane', async () => {
  await page.locator('.tree-row--file', { hasText: 'page.html' }).click()
  await expect(page.locator('.cm-content')).toContainText('Body text', { timeout: 15_000 })
  await page.locator('.header-viewmode__btn', { hasText: 'Read' }).click()
  await expect(page.locator('.htmlv__frame')).toBeVisible({ timeout: 15_000 })
  await page.waitForTimeout(800)

  // A whole document with a type scale of its own cannot be handed a font
  // size, so it is scaled. The frame's inner viewport shrinking in CSS pixels
  // is the content getting bigger.
  const inner = (): Promise<number> =>
    page
      .frameLocator('.htmlv__frame')
      .locator('body')
      .evaluate(() => document.documentElement.clientWidth)
  const box = (): Promise<number> =>
    page.locator('.htmlv__frame').evaluate((e) => Math.round(e.getBoundingClientRect().width))

  const beforeInner = await inner()
  const paneWidth = await box()
  await run('view.pageZoomIn')
  await run('view.pageZoomIn')
  await page.waitForTimeout(500)
  expect(await inner()).toBeLessThan(beforeInner)
  // And scaling it must not push it out of the pane it is read in.
  expect(await box()).toBe(paneWidth)

  await run('view.pageZoomReset')
  await page.waitForTimeout(500)
  expect(await inner()).toBe(beforeInner)
})

test('a diff follows page zoom, in the face a diff is read in', async () => {
  // Two text documents in a pane, rendered by the same editor theme as the
  // note next to them — but outside the element the theme's variables were
  // declared on, so they fell back to the defaults in `tokens.css`: a fixed
  // 16px in the prose face, whatever the settings said. The key moved the
  // number and nothing on screen changed.
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('menu:command', {
      commandId: 'view.toggleGit'
    })
  })
  await expect(page.locator('.scm')).toBeVisible({ timeout: 15_000 })
  await page.locator('button[aria-label="Refresh status"]').click()
  await expect
    .poll(
      async () => {
        if (!(await page.locator('.diff__panes').isVisible())) {
          await page
            .locator('.scm-row__name')
            .filter({ hasText: 'Diffme.md' })
            .click()
            .catch(() => {})
        }
        return page.locator('.diff__panes').isVisible()
      },
      { timeout: 20_000 }
    )
    .toBe(true)

  const text = page.locator('.diff__pane').first().locator('.cm-content')
  const size = (): Promise<number> =>
    text.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))

  const before = await size()
  await run('view.pageZoomIn')
  await run('view.pageZoomIn')
  expect(await size()).toBe(before + 2)

  await run('view.pageZoomReset')
  expect(await size()).toBe(before)

  // And while we are here: a diff is read down its left edge against the
  // indentation, in two columns that have to line up with each other — so it
  // is set in the mono face whatever the file is, and this one is markdown.
  // It was the prose face, from the same fallback.
  expect(await text.evaluate((el) => getComputedStyle(el).fontFamily)).toContain('Mono')

  // Put the sidebar back. Source control replaces the file tree rather than
  // sitting beside it, so a test after this one that reaches for a file finds
  // nothing to click — and `view.toggleGit` does not toggle, it shows. Its
  // counterpart is `view.toggleFiles`.
  await page.locator('.diff button[aria-label="Close"]').click()
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('menu:command', {
      commandId: 'view.toggleFiles'
    })
  })
  await expect(page.locator('.tree-row--file').first()).toBeVisible({ timeout: 15_000 })
})

test('a database table follows it too', async () => {
  // The last surface that lays out to a size of its own. A table of rows is a
  // document as much as a spreadsheet is, and it was pinned at 12px while the
  // setting moved — the same gap the CSV table had, in the viewer next to it.
  await page.locator('.tree-row--file', { hasText: 'rows.db' }).click()
  await expect(page.locator('.db__grid')).toBeVisible({ timeout: 20_000 })

  const sizeOf = (selector: string): Promise<number> =>
    page
      .locator(selector)
      .first()
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize))

  const cells = await sizeOf('.db__grid')
  const heads = await sizeOf('.db__sort')
  await run('view.pageZoomIn')
  await run('view.pageZoomIn')

  expect(await sizeOf('.db__grid')).toBeGreaterThan(cells)
  // The headings have to come with them. A grid whose cells grew while its
  // column names stayed put reads as broken rather than as bigger.
  expect(await sizeOf('.db__sort')).toBeGreaterThan(heads)

  await run('view.pageZoomReset')
  expect(await sizeOf('.db__grid')).toBeCloseTo(cells, 1)
  expect(await sizeOf('.db__sort')).toBeCloseTo(heads, 1)
})
