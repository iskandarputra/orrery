import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect, type Page } from '@playwright/test'
import type { ElectronApplication } from 'playwright'
import { closeCleanly, launchApp, openVault } from './helpers'

/**
 * Indentation guides, and the wrap setting they depend on.
 *
 * Code is read down its left edge, and in a long function the line that says
 * which block you are inside has usually scrolled away. The guides put it back
 * on every row, which only works while columns line up.
 */

const CODE = [
  'function outer() {', // 1
  '  if (a) {', // 2
  '    deep()', // 3
  '  }', // 4
  '}' // 5
].join('\n')

let app: ElectronApplication
let page: Page
let vault: string

const open = async (file: string): Promise<void> => {
  await page.locator('.tree-row--file', { hasText: file }).click()
  await expect(page.locator('.cm-content').first()).toBeVisible({ timeout: 15_000 })
  await page.waitForTimeout(500)
}

const settings = async (patch: Record<string, unknown>): Promise<void> => {
  await page.evaluate(async (p) => {
    const current = await window.orrery.invoke('settings:get', undefined)
    await window.orrery.invoke('settings:set', {
      ...current,
      editor: { ...current.editor, ...p }
    })
  }, patch)
  await page.waitForTimeout(600)
}

test.beforeAll(async () => {
  vault = mkdtempSync(join(tmpdir(), 'orrery-guides-'))
  writeFileSync(join(vault, 'deep.ts'), CODE)
  writeFileSync(join(vault, 'Note.md'), '# Note\n\n- one\n  - nested\n')
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

test('an indented line in code is marked', async () => {
  await open('deep.ts')
  await expect(page.locator('.cm-line.cm-indent-markers').first()).toBeVisible()
})

test('the guides are drawn, one per indent level, in the theme colour', async () => {
  const drawn = await page.evaluate(() => {
    const line = document.querySelectorAll('.cm-content .cm-line')[2] as HTMLElement
    const image = getComputedStyle(line, '::before').backgroundImage
    return {
      // Two gradients: the block the cursor is in, and the rest.
      gradients: (image.match(/repeating-linear-gradient/g) ?? []).length,
      // Drawn from the foreground token, so every theme gets guides that sit
      // the same distance from its background.
      usesForeground: image.includes(
        getComputedStyle(document.querySelector('.cm-content') as HTMLElement)
          .color.replace('rgb(', '')
          .replace(')', '')
          .split(', ')
          .map((n) => (Number(n) / 255).toFixed(6).replace(/0+$/, ''))[0]!
      ),
      periodPx: Number(/(\d+\.?\d*)px\)/.exec(image)?.[1] ?? 0)
    }
  })
  expect(drawn.gradients).toBe(2)
  expect(drawn.usesForeground).toBe(true)
  // One guide per indent unit, not per character.
  expect(drawn.periodPx).toBeGreaterThan(10)
})

test('prose is left alone: guides are for code', async () => {
  await open('Note.md')
  await expect(page.locator('.cm-line.cm-indent-markers')).toHaveCount(0)
})

test('the setting turns them off', async () => {
  await open('deep.ts')
  await settings({ indentGuides: false })
  await open('Note.md')
  await open('deep.ts')
  await expect(page.locator('.cm-line.cm-indent-markers')).toHaveCount(0)
  await settings({ indentGuides: true })
})

/**
 * Guides only mean anything while columns line up, and code used to follow the
 * prose wrap setting, which defaults on. Every code file wrapped.
 */
test('code does not wrap by default, so the columns hold', async () => {
  await open('Note.md')
  await open('deep.ts')
  // CodeMirror sets `break-spaces` when wrapping and `pre` when not.
  const wraps = await page.evaluate(() => {
    const content = document.querySelector('.cm-content') as HTMLElement
    return getComputedStyle(content).whiteSpace
  })
  expect(wraps).toBe('pre')
})

test('prose still wraps, which is what prose wants', async () => {
  await open('Note.md')
  const wraps = await page.evaluate(
    () => getComputedStyle(document.querySelector('.cm-content') as HTMLElement).whiteSpace
  )
  expect(wraps).toBe('break-spaces')
})

test('the code wrap setting is honoured when turned on', async () => {
  await settings({ wordWrapCode: true })
  await open('Note.md')
  await open('deep.ts')
  const wraps = await page.evaluate(
    () => getComputedStyle(document.querySelector('.cm-content') as HTMLElement).whiteSpace
  )
  expect(wraps).toBe('break-spaces')
  await settings({ wordWrapCode: false })
})
