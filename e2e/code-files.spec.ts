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

test('the outline does not tell you to put markdown in a source file', async () => {
  await open('script.ts')
  const hint = page.locator('.rpanel-empty')
  await expect(hint).toBeVisible()
  // Telling someone to add "# Headings" to a .ts file is advice that breaks it.
  await expect(hint).not.toContainText('# Headings')
  await expect(hint).toContainText('code file')
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
