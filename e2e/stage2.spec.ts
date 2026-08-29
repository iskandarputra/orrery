import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect, type Page } from '@playwright/test'
import type { ElectronApplication } from 'playwright'
import { closeCleanly, launchApp, openVault } from './helpers'

/**
 * Search operators, vim mode and hover preview.
 *
 * Three things Obsidian ships that Orrery did not.
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

const settings = async (patch: Record<string, unknown>): Promise<void> => {
  await page.evaluate(async (p) => {
    const current = await window.orrery.invoke('settings:get', undefined)
    await window.orrery.invoke('settings:set', { ...current, editor: { ...current.editor, ...p } })
  }, patch)
  await page.waitForTimeout(700)
}

const open = async (name: string): Promise<void> => {
  await page.locator('.tree-row--file', { hasText: name }).click()
  await expect(page.locator('.cm-content').first()).toBeVisible({ timeout: 15_000 })
  await page.waitForTimeout(400)
}

const search = async (term: string): Promise<void> => {
  const input = page.locator('.gsearch__input')
  if (!(await input.isVisible())) await run('view.toggleSearch')
  await expect(input).toBeVisible({ timeout: 10_000 })
  await input.fill(term)
  await input.press('Enter')
  await page.waitForTimeout(700)
}

const files = async (): Promise<string[]> => page.locator('.result-group__name').allTextContents()

test.beforeAll(async () => {
  vault = mkdtempSync(join(tmpdir(), 'orrery-stage2-'))
  mkdirSync(join(vault, 'src'), { recursive: true })
  mkdirSync(join(vault, 'dist'), { recursive: true })
  writeFileSync(join(vault, 'Index.md'), '# Index\n\nSee [[Kepler]] for NEEDLE detail.\n')
  writeFileSync(
    join(vault, 'Kepler.md'),
    '# Kepler\n\nThe NEEDLE is here. #draft\n\nMore body text.\n'
  )
  writeFileSync(join(vault, 'Other.md'), '# Other\n\nNEEDLE without a tag.\n')
  writeFileSync(join(vault, 'src', 'code.ts'), 'const NEEDLE = 1\n')
  writeFileSync(join(vault, 'dist', 'built.js'), 'var NEEDLE = 1\n')

  app = await launchApp()
  page = await app.firstWindow()
  await page.setViewportSize({ width: 1340, height: 880 })
  await page.waitForSelector('.app', { timeout: 30_000 })
  await openVault(page, vault, 'Index.md')
})

test.afterAll(async () => {
  await closeCleanly(app, page)
  rmSync(vault, { recursive: true, force: true })
})

test('path: narrows to a directory', async () => {
  await search('NEEDLE')
  expect((await files()).length).toBeGreaterThan(3)

  await search('NEEDLE path:src')
  expect(await files()).toEqual(['code.ts'])
})

test('file: matches part of a name, anywhere', async () => {
  await search('NEEDLE file:Kep')
  expect(await files()).toEqual(['Kepler.md'])
})

test('a minus excludes', async () => {
  await search('NEEDLE -path:dist')
  expect(await files()).not.toContain('built.js')
  expect((await files()).length).toBeGreaterThan(0)
})

test('tag: finds the tag, and combines with free text', async () => {
  await search('tag:draft')
  expect(await files()).toEqual(['Kepler.md'])

  // Both must be on the line, in either order.
  await search('tag:draft NEEDLE')
  expect(await files()).toEqual(['Kepler.md'])
})

test('a filter with no search term lists what is in there', async () => {
  await search('path:dist')
  expect(await files()).toEqual(['built.js'])
})

test('an operator mid-typing is still ordinary text', async () => {
  // `path:` alone must not empty the results on the way to something useful.
  await search('path:')
  await expect(page.locator('.gsearch')).toContainText('No matches found')
})

test('hovering a link previews the note behind it', async () => {
  await open('Index.md')
  await page.locator('.cm-or-wikilink').first().hover()
  const preview = page.locator('.cm-or-link-preview')
  await expect(preview).toBeVisible({ timeout: 15_000 })
  await expect(preview.locator('.cm-or-link-preview__title')).toHaveText('Kepler')
  // Rendered with the same reader the editor uses, so a heading is a heading.
  await expect(preview.locator('.cm-or-h1')).toBeVisible()
  await expect(preview).toContainText('The NEEDLE is here')
})

test('the preview closes, leaving no editor behind', async () => {
  await page
    .locator('.cm-content')
    .first()
    .hover({ position: { x: 5, y: 5 } })
  await page.waitForTimeout(600)
  await expect(page.locator('.cm-or-link-preview')).toHaveCount(0)
})

test('vim mode is off unless asked for', async () => {
  await open('Kepler.md')
  await expect(page.locator('.cm-vim-panel')).toHaveCount(0)
})

test('vim mode applies to notes, not only code', async () => {
  await settings({ vimMode: true })
  await open('Index.md')
  await open('Kepler.md')
  await expect(page.locator('.cm-vim-panel')).toBeVisible({ timeout: 10_000 })

  // In normal mode `j` moves down a line; in an ordinary editor it types a `j`.
  // The caret is the tell, and unlike the document text it does not change when
  // live preview conceals a heading marker on click.
  const caret = async (): Promise<number> => {
    const bar = await page.locator('.status-bar').textContent()
    return Number(/Ln (\d+)/.exec(bar ?? '')?.[1] ?? 0)
  }
  await page.locator('.cm-content .cm-line').first().click()
  const start = await caret()
  await page.keyboard.press('j')
  await expect.poll(caret, { timeout: 5000 }).toBe(start + 1)

  await settings({ vimMode: false })
})
