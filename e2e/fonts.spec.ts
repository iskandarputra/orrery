import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect, type Page } from '@playwright/test'
import type { ElectronApplication } from 'playwright'
import { closeCleanly, launchApp, openVault } from './helpers'

/**
 * The code and terminal face.
 *
 * Declaring a font proves nothing — the questions are whether the bundled file
 * actually loaded, whether the elements that should use it do, and whether the
 * terminal, which measures glyphs itself and cannot read a CSS variable, ended
 * up with the same font as the editor.
 */

const MESLO = 'MesloLGL Nerd Font Mono'

let app: ElectronApplication
let page: Page
let vault: string

test.beforeAll(async () => {
  vault = mkdtempSync(join(tmpdir(), 'orrery-fonts-'))
  writeFileSync(
    join(vault, 'Fonts.md'),
    '# Fonts\n\nSome `inline code` here.\n\n```js\nconst x = 1\n```\n'
  )
  writeFileSync(join(vault, 'code.ts'), 'const f = (a: number) => a + 1\n')
  app = await launchApp()
  page = await app.firstWindow()
  await page.waitForSelector('.app', { timeout: 30_000 })
  await openVault(page, vault, 'Fonts.md')
  await page.locator('.tree-row--file', { hasText: 'Fonts.md' }).click()
})

test.afterAll(async () => {
  await closeCleanly(app, page)
  rmSync(vault, { recursive: true, force: true })
})

test('the bundled face really loads, in every weight and slant', async () => {
  const loaded = await page.evaluate(async (family) => {
    await document.fonts.ready
    return {
      regular: document.fonts.check(`12px "${family}"`),
      bold: document.fonts.check(`bold 12px "${family}"`),
      italic: document.fonts.check(`italic 12px "${family}"`)
    }
  }, MESLO)
  expect(loaded).toEqual({ regular: true, bold: true, italic: true })
})

test('it leads the mono token, so code inherits it', async () => {
  const stack = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--or-mono-font')
  )
  expect(stack.replace(/\s+/g, ' ').trim().startsWith(`'${MESLO}'`)).toBe(true)
})

test('inline code in the editor is drawn in it', async () => {
  const family = await page
    .locator('.cm-or-inline-code')
    .first()
    .evaluate((el) => {
      return getComputedStyle(el).fontFamily
    })
  expect(family).toContain(MESLO)
})

test('the nerd glyphs are present, which is the whole point of the patch', async () => {
  // A powerline separator (U+E0B0) and a git branch (U+E0A0). Measured against a
  // character the fallback certainly lacks a matching width for: if Meslo were
  // not in use these would be tofu, which renders at a different width.
  const widths = await page.evaluate(async (family) => {
    await document.fonts.ready
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')!
    const measure = (text: string, font: string): number => {
      ctx.font = font
      return ctx.measureText(text).width
    }
    return {
      meslo: measure('', `16px "${family}"`),
      fallback: measure('', '16px "no-such-font-at-all"')
    }
  }, MESLO)
  expect(widths.meslo).toBeGreaterThan(0)
  expect(widths.meslo).not.toBeCloseTo(widths.fallback, 1)
})

test('the terminal is drawn in the same font as the editor', async () => {
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('menu:command', {
      commandId: 'view.toggleTerminal'
    })
  })
  await expect(page.locator('.term-panel')).toBeVisible({ timeout: 15_000 })
  // xterm stamps its resolved family onto the rows it renders. Reading it back
  // proves the CSS variable was resolved rather than passed through verbatim.
  const family = await page
    .locator('.term-panel__host .xterm-rows')
    .evaluate((el) => getComputedStyle(el).fontFamily)
  expect(family).toContain(MESLO)
  expect(family).not.toContain('var(')
})

test('the terminal measured the cell with the real font, not a fallback', async () => {
  // xterm prefers an OffscreenCanvas to size its character cell, and a canvas
  // ignores an invalid `font` assignment rather than reporting one — so a family
  // it cannot parse (a CSS `var()`, say) leaves the context on its 10px
  // sans-serif default and the whole grid is silently built on the wrong cell.
  // The rendered row height is where that shows up.
  const cells = await page.evaluate(async (family) => {
    await document.fonts.ready
    const cell = (font: string): number => {
      const ctx = new OffscreenCanvas(100, 100).getContext('2d')!
      ctx.font = font
      const m = ctx.measureText('W')
      return m.fontBoundingBoxAscent + m.fontBoundingBoxDescent
    }
    const rows = document.querySelector('.term-panel__host .xterm-rows')!
    return {
      rendered: (rows.children[0] as HTMLElement).getBoundingClientRect().height,
      withFont: cell(`12px "${family}"`),
      canvasDefault: cell('')
    }
  }, MESLO)

  // The two must differ, or the assertion below proves nothing.
  expect(cells.withFont).not.toBe(cells.canvasDefault)
  expect(cells.rendered).toBe(cells.withFont)
})

test('a code file is set in the mono font, not the prose one', async () => {
  await page.locator('.tree-row--file', { hasText: 'code.ts' }).click()
  await expect(page.locator('.cm-content')).toBeVisible({ timeout: 15_000 })
  const family = await page.locator('.cm-content').evaluate((el) => getComputedStyle(el).fontFamily)
  expect(family).toContain(MESLO)
})

test('code columns line up, which is the reason a code file needs it', async () => {
  // The observable difference between a proportional face and a monospaced one:
  // every character advances by the same width. A prose font fails this outright,
  // so it catches the regression whatever font is substituted.
  const widths = await page.evaluate(async () => {
    await document.fonts.ready
    const el = document.querySelector('.cm-content') as HTMLElement
    const style = getComputedStyle(el)
    // Built from the parts: Chromium returns an empty `font` shorthand whenever
    // the longhands cannot be expressed as one, and a canvas silently ignores an
    // invalid assignment — so reading the shorthand would measure the default.
    const ctx = document.createElement('canvas').getContext('2d')!
    ctx.font = `${style.fontSize} ${style.fontFamily}`
    return ['i', 'W', 'm', '.'].map((c) => ctx.measureText(c).width)
  })
  expect(new Set(widths).size).toBe(1)
})

test('prose is left in the proportional face', async () => {
  // The mono default must apply to code files only; a note is still prose.
  await page.locator('.tree-row--file', { hasText: 'Fonts.md' }).click()
  await expect(page.locator('.cm-content')).toBeVisible({ timeout: 15_000 })
  const family = await page.locator('.cm-content').evaluate((el) => getComputedStyle(el).fontFamily)
  expect(family).not.toContain(MESLO)
  expect(family).toContain('Inter')
})
