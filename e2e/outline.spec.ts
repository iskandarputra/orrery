import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect, type Page } from '@playwright/test'
import type { ElectronApplication } from 'playwright'
import { closeCleanly, launchApp, openVault } from './helpers'

/**
 * The outline, for notes and for code.
 *
 * A code file has structure too. The panel used to answer a request for it by
 * explaining that markdown headings were not present, which is true and no help
 * at all.
 */

const CODE = [
  "import { readFile } from 'node:fs'", // 1
  '', // 2
  'export interface Note {', // 3
  '  path: string', // 4
  '}', // 5
  '', // 6
  'export function loadNote(path: string): Note {', // 7
  '  if (path === "") {', // 8
  '    return { path }', // 9
  '  }', // 10
  '  return { path }', // 11
  '}', // 12
  '', // 13
  'export class Loader {', // 14
  '  run() {', // 15
  '    return 1', // 16
  '  }', // 17
  '}' // 18
].join('\n')

const NOTE = '# Title\n\nProse.\n\n## Background\n\n```sh\n# not a heading\n```\n\n## Method\n'

let app: ElectronApplication
let page: Page
let vault: string

const open = async (file: string): Promise<void> => {
  await page.locator('.tree-row--file', { hasText: file }).click()
  await expect(page.locator('.cm-content').first()).toBeVisible({ timeout: 15_000 })
  await page.waitForTimeout(400)
}

const items = (): ReturnType<Page['locator']> => page.locator('.outline__item')

test.beforeAll(async () => {
  vault = mkdtempSync(join(tmpdir(), 'orrery-outline-'))
  writeFileSync(join(vault, 'loader.ts'), CODE)
  writeFileSync(join(vault, 'Note.md'), NOTE)
  writeFileSync(join(vault, 'plain.ts'), 'const x = 1\nconst y = 2\n')
  app = await launchApp()
  page = await app.firstWindow()
  await page.setViewportSize({ width: 1300, height: 860 })
  await page.waitForSelector('.app', { timeout: 30_000 })
  await openVault(page, vault, 'Note.md')
})

test.afterAll(async () => {
  await closeCleanly(app, page)
  rmSync(vault, { recursive: true, force: true })
})

test('a note outlines by heading', async () => {
  await open('Note.md')
  await expect(items()).toHaveCount(3)
  await expect(items().nth(0)).toContainText('Title')
  // A shell comment inside a fence is not a heading.
  await expect(page.locator('.outline')).not.toContainText('not a heading')
  await expect(page.locator('.outline-count-bar')).toContainText('headings')
})

test('a code file outlines by declaration', async () => {
  await open('loader.ts')
  await expect(items()).toHaveCount(4)
  // Exact: "Note" is also a substring of "loadNote".
  await expect(items().locator('.outline__label').allTextContents()).resolves.toEqual([
    'Note',
    'loadNote',
    'Loader',
    'run'
  ])
  // `if (path === "") {` has the exact shape of a method declaration.
  await expect(page.locator('.outline')).not.toContainText('if')
  await expect(page.locator('.outline-count-bar')).toContainText('symbols')
})

test('a method is nested under its class', async () => {
  await open('loader.ts')
  const cls = await page
    .locator('.outline__item', { hasText: 'Loader' })
    .evaluate((el) => parseFloat(getComputedStyle(el).paddingLeft))
  const method = await page
    .locator('.outline__item', { hasText: 'run' })
    .evaluate((el) => parseFloat(getComputedStyle(el).paddingLeft))
  expect(method).toBeGreaterThan(cls)
})

test('clicking a symbol jumps to it', async () => {
  await open('loader.ts')
  await page.getByRole('button', { name: 'Loader', exact: true }).click()
  await expect
    .poll(
      async () => {
        const bar = await page.locator('.status-bar').textContent()
        return Number(/Ln (\d+)/.exec(bar ?? '')?.[1] ?? 0)
      },
      { timeout: 10_000 }
    )
    .toBe(14)
})

test('the filter narrows the list', async () => {
  await open('loader.ts')
  // "load" would match Loader too, which is correct and makes a poor assertion.
  await page.locator('.outline-filter__input').fill('loadn')
  await expect(items()).toHaveCount(1)
  await expect(items().first()).toContainText('loadNote')
  await expect(page.locator('.outline-count-bar')).toContainText('1 of 4')
  await page.locator('.outline-filter__input').fill('')
})

test('a file with nothing to outline says so in its own terms', async () => {
  await open('plain.ts')
  // Telling someone to add "# Headings" to a TypeScript file is advice that
  // would break it.
  await expect(page.locator('.rpanel-empty')).toContainText('functions, classes or types')
  await expect(page.locator('.rpanel-empty')).not.toContainText('# Headings')
})
