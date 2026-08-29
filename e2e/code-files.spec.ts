import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { launchApp, openVault } from './helpers'

let app: ElectronApplication
let page: Page
let vault: string

const JSON_SRC = '{\n  "a": 1,\n  "b": [1, 2, 3]\n}\n'
const TS_SRC =
  '// A comment with *asterisks* and _underscores_\nexport function add(a: number, b: number): number {\n  return a + b\n}\n'

async function open(file: string): Promise<void> {
  await page.locator('.tree-row--file', { hasText: file }).click()
  await expect(page.locator('.cm-content')).toBeVisible({ timeout: 15_000 })
  await page.waitForTimeout(500)
}

/** What the editor actually shows, line by line. */
async function renderedLines(): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('.cm-content .cm-line')).map((l) => l.textContent ?? '')
  )
}

test.beforeAll(async () => {
  vault = mkdtempSync(join(tmpdir(), 'orrery-code-files-'))
  writeFileSync(join(vault, 'Note.md'), '# Note\n\nProse with **bold**.\n')
  writeFileSync(join(vault, 'data.json'), JSON_SRC)
  writeFileSync(join(vault, 'script.ts'), TS_SRC)
  app = await launchApp()
  page = await app.firstWindow()
  await page.setViewportSize({ width: 1300, height: 850 })
  await page.waitForSelector('.app', { timeout: 30_000 })
  await openVault(page, vault, 'Note.md')
})

test.afterAll(async () => {
  await app.close()
  rmSync(vault, { recursive: true, force: true })
})

/**
 * Markdown parsed a source file rewrites what you see: `[1, 2, 3]` is read as
 * link syntax and its brackets concealed, `*x*` loses its asterisks to
 * emphasis, and Reading-mode reflow joins hard-wrapped lines into one. The
 * bytes on disk were always fine; nothing on screen could be trusted.
 */
test('a JSON file is shown exactly as it is written', async () => {
  await open('data.json')
  const lines = await renderedLines()
  // Exact, including the trailing blank line the final newline produces.
  expect(lines).toEqual(JSON_SRC.split('\n'))
  // The specific thing markdown ate.
  expect(lines.some((l) => l.includes('[1, 2, 3]'))).toBe(true)
})

test('a comment keeps its asterisks and underscores', async () => {
  await open('script.ts')
  const lines = await renderedLines()
  expect(lines).toEqual(TS_SRC.split('\n'))
})

test('code gets a gutter and its own language', async () => {
  await open('script.ts')
  await expect(page.locator('.cm-lineNumbers')).toBeVisible()
  await expect(page.locator('.status-bar')).toContainText('TypeScript')
  // The grammar is code-split, so colour arrives a moment after the text.
  await expect
    .poll(() => page.locator('.cm-content .cm-line span[class]').count(), { timeout: 15_000 })
    .toBeGreaterThan(3)
})

test('a note is still a note', async () => {
  await open('Note.md')
  await expect(page.locator('.cm-or-h1')).toBeVisible()
  await expect(page.locator('.cm-lineNumbers')).toBeHidden()
  await expect(page.locator('.status-bar')).toContainText('Markdown')
})

test('a source file outlines by its declarations', async () => {
  // It used to explain that markdown headings were absent, which is true and no
  // help at all. A code file has structure; the outline now reads it.
  await open('script.ts')
  await expect(page.locator('.outline__item')).toHaveCount(1)
  await expect(page.locator('.outline__item').first()).toContainText('add')
  await expect(page.locator('.outline-count-bar')).toContainText('symbols')
  await expect(page.locator('.rpanel-empty')).toHaveCount(0)
})

/**
 * A reading column is for prose. Code is read down its left edge against the
 * indentation, so it takes the full pane and starts at the gutter rather than
 * being centred in a 46rem measure.
 */
test('code uses the full width, prose keeps its column', async () => {
  await open('script.ts')
  const code = await page.evaluate(() => {
    const content = document.querySelector('.cm-content') as HTMLElement
    const gutter = document.querySelector('.cm-gutters') as HTMLElement
    const scroller = document.querySelector('.cm-scroller') as HTMLElement
    const line = document.querySelector('.cm-content .cm-line') as HTMLElement
    return {
      maxWidth: getComputedStyle(content).maxWidth,
      gapAfterGutter: Math.round(
        content.getBoundingClientRect().left - gutter.getBoundingClientRect().right
      ),
      // Measured against the minimap rather than the scroller: the minimap is
      // a legitimate occupant of the right edge, not space the code failed to
      // use. Asserted below to exist, so this cannot quietly become a blanket
      // exemption if the minimap ever stops rendering.
      hasMinimap: !!document.querySelector('.cm-minimap-gutter'),
      unusedRight: Math.round(
        (document.querySelector('.cm-minimap-gutter')?.getBoundingClientRect().left ??
          scroller.getBoundingClientRect().right) - content.getBoundingClientRect().right
      ),
      // The per-line inset, which is what actually holds the text away from
      // the gutter — it is padding inside the line, not on the content box.
      linePad: parseFloat(getComputedStyle(line).paddingLeft)
    }
  })
  expect(code.maxWidth, 'code is not held to a reading column').toBe('none')
  expect(code.gapAfterGutter, 'code starts at the gutter').toBeLessThanOrEqual(2)
  expect(code.hasMinimap, 'a code file gets a minimap').toBe(true)
  expect(code.unusedRight, 'code runs up to the minimap').toBeLessThanOrEqual(2)
  expect(code.linePad, 'code is not inset like prose').toBeLessThan(20)

  await open('Note.md')
  const note = await page.evaluate(() => ({
    maxWidth: getComputedStyle(document.querySelector('.cm-content') as HTMLElement).maxWidth,
    linePad: parseFloat(
      getComputedStyle(document.querySelector('.cm-content .cm-line') as HTMLElement).paddingLeft
    )
  }))
  expect(note.maxWidth, 'prose still gets a measure').not.toBe('none')
  expect(note.linePad, 'prose keeps its generous inset').toBeGreaterThan(20)
})

test('prose counters go quiet on code', async () => {
  await open('Note.md')
  await expect(page.locator('.header-stats-pill')).toBeVisible()
  await expect(page.locator('.status-bar__stats-btn')).toBeVisible()

  await open('data.json')
  // "6 words · 1 min read" on a JSON file is a number nobody can use.
  await expect(page.locator('.header-stats-pill')).toHaveCount(0)
  await expect(page.locator('.status-bar__stats-btn')).toHaveCount(0)
})
