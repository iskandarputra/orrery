import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { closeCleanly, launchApp, openVault } from './helpers'

/**
 * A changed line in the diff has to be findable at a glance.
 *
 * It was marked by a background tint and nothing else, and the tint is held to
 * 8% because it sits under the code: in Tokyo Night a removed line measured
 * 1.07:1 against the unchanged line beside it, which is a change you find by
 * reading every line. The bar and the coloured number are the fix, so these
 * measure them where they are drawn: which line each one sits beside, what
 * colour it came out, and whether it stands out from the gutter in every theme.
 */
let app: ElectronApplication
let page: Page
let vault: string

const git = (...args: string[]): void => {
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], {
    cwd: vault,
    stdio: 'ignore'
  })
}

// Lines 3 and 4 are rewritten into 3 to 5, and line 8 is removed.
const OLD = `// Index of the things
export function add(a: number, b: number): number {
  // keep it simple
  return a + b
}

export const name = 'orrery'
export const count = 3
`
const NEW = `// Index of the things
export function add(a: number, b: number): number {
  // a comment that was rewritten in this change
  const total = a + b
  return total
}

export const name = 'orrery'
`

interface Row {
  /** The number the gutter shows beside the line, or '' if it shows none. */
  number: string
  tinted: boolean
  numberIsDiffColour: boolean
  bar: { isDiffColour: boolean; width: number; withinLine: boolean } | null
}

/** Click a changed file until its diff is up; the panel redraws under a click. */
async function openDiff(): Promise<void> {
  if (!(await page.locator('.scm').isVisible())) {
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.webContents.send('menu:command', {
        commandId: 'view.toggleGit'
      })
    })
  }
  await expect(page.locator('.scm')).toBeVisible({ timeout: 15_000 })
  await expect
    .poll(
      async () => {
        if (!(await page.locator('.diff__panes').isVisible())) {
          await page
            .locator('.scm-row__name')
            .filter({ hasText: 'math.ts' })
            .click()
            .catch(() => {})
        }
        return page.locator('.diff__panes').isVisible()
      },
      { timeout: 20_000 }
    )
    .toBe(true)
  await expect(page.locator('.diff__pane--new .cm-or-diff-line--new').first()).toBeVisible()
}

/** Only the working-tree pane carries a modifier; the other is the first. */
const PANE = {
  old: '.diff__panes > .diff__pane:first-child',
  new: '.diff__pane--new'
} as const

/**
 * Everything drawn beside each line of one pane, matched to the line by where
 * it is on screen rather than by the class that is meant to put it there.
 */
async function readPane(side: 'old' | 'new'): Promise<Row[]> {
  return page.evaluate(
    ([s, PANE]) => {
      const pane = document.querySelector(PANE[s])!
      const token = getComputedStyle(document.documentElement)
        .getPropertyValue(s === 'old' ? '--or-diff-del' : '--or-diff-add')
        .trim()
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 1
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!
      const rgb = (css: string): string => {
        ctx.clearRect(0, 0, 1, 1)
        ctx.fillStyle = css
        ctx.fillRect(0, 0, 1, 1)
        return Array.from(ctx.getImageData(0, 0, 1, 1).data).join(',')
      }
      const diffColour = rgb(token)
      const middle = (el: Element): number => {
        const r = el.getBoundingClientRect()
        return (r.top + r.bottom) / 2
      }
      const numbers = Array.from(pane.querySelectorAll('.cm-lineNumbers .cm-gutterElement')).filter(
        (el) => getComputedStyle(el).visibility !== 'hidden'
      )
      const bars = Array.from(pane.querySelectorAll('.cm-or-diff-gutter .cm-or-diff-bar'))
      return Array.from(pane.querySelectorAll('.cm-content > .cm-line')).map((line) => {
        const box = line.getBoundingClientRect()
        const beside = (el: Element): boolean => middle(el) > box.top && middle(el) < box.bottom
        const number = numbers.find(beside)
        const bar = bars.find(beside)
        const barBox = bar?.getBoundingClientRect()
        return {
          number: number?.textContent?.trim() ?? '',
          tinted: line.classList.contains('cm-or-diff-line'),
          numberIsDiffColour: !!number && rgb(getComputedStyle(number).color) === diffColour,
          bar:
            bar && barBox
              ? {
                  isDiffColour: rgb(getComputedStyle(bar).backgroundColor) === diffColour,
                  width: barBox.width,
                  withinLine: barBox.top >= box.top - 1 && barBox.bottom <= box.bottom + 1
                }
              : null
        }
      })
    },
    [side, PANE] as const
  )
}

function numbersOf(rows: Row[], pick: (row: Row) => boolean): number[] {
  return rows.flatMap((row, i) => (pick(row) ? [i + 1] : []))
}

/** Every line: its own number shown, and a bar and colour exactly when tinted. */
function expectMarked(rows: Row[], changed: number[]): void {
  // First, because a number hidden behind a marker is the easiest way to get
  // this wrong, and it also stretches the bar beside it into the next line.
  rows.forEach((row, i) => {
    expect(row.number, `line ${i + 1} shows its number`).toBe(String(i + 1))
  })
  expect(numbersOf(rows, (r) => r.tinted)).toEqual(changed)
  expect(numbersOf(rows, (r) => r.bar !== null)).toEqual(changed)
  expect(numbersOf(rows, (r) => r.numberIsDiffColour)).toEqual(changed)
  rows.forEach((row, i) => {
    if (!row.bar) return
    expect(row.bar.isDiffColour, `line ${i + 1} bar colour`).toBe(true)
    expect(row.bar.width, `line ${i + 1} bar width`).toBeGreaterThanOrEqual(3)
    expect(row.bar.withinLine, `line ${i + 1} bar stays beside its own line`).toBe(true)
  })
}

test.beforeAll(async () => {
  vault = mkdtempSync(join(tmpdir(), 'orrery-diff-marks-'))
  writeFileSync(join(vault, 'Index.md'), '# Index\n')
  writeFileSync(join(vault, 'math.ts'), OLD)
  git('init', '-q', '.')
  git('add', '.')
  git('commit', '-qm', 'init')
  writeFileSync(join(vault, 'math.ts'), NEW)

  app = await launchApp()
  page = await app.firstWindow()
  await page.waitForSelector('.app', { timeout: 30_000 })
  // GitHub Light, where the tint was reported as too faint to see. Set before
  // openVault, whose reload is what brings settings into the renderer.
  await page.evaluate(async () => {
    const current = await window.orrery.invoke('settings:get', undefined)
    await window.orrery.invoke('settings:set', {
      ...current,
      theme: 'light',
      lightTheme: 'github-light'
    })
  })
  await openVault(page, vault, 'Index.md')
  await openDiff()
})

test.afterAll(async () => {
  await closeCleanly(app, page)
  rmSync(vault, { recursive: true, force: true })
})

test('every changed line has a bar and a coloured number, and no other line does', async () => {
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('github-light')
  expectMarked(await readPane('old'), [3, 4, 8])
  expectMarked(await readPane('new'), [3, 4, 5])
})

test('the marks move with their lines when the working copy is edited', async () => {
  const right = page.locator('.diff__pane--new .cm-content')
  await right.locator('.cm-line').first().click()
  await page.keyboard.press('Home')
  await page.keyboard.press('Enter')
  await expect
    .poll(async () => numbersOf(await readPane('new'), (r) => r.tinted))
    .toEqual([4, 5, 6])
  expectMarked(await readPane('new'), [4, 5, 6])

  await page.keyboard.press('ControlOrMeta+z')
  await expect
    .poll(async () => numbersOf(await readPane('new'), (r) => r.tinted))
    .toEqual([3, 4, 5])
})

test('the bar and the number stand out from the gutter in every theme', async () => {
  // Every palette the app ships, read from the stylesheet it injects. The
  // attribute is set directly: these marks are colours from CSS variables and
  // nothing else, so what a theme change does to them is exactly this.
  const themes = await page.evaluate(() =>
    Array.from(
      document.getElementById('orrery-themes')!.textContent!.matchAll(/data-theme='([^']+)'\] \{/g),
      (m) => m[1]!
    )
  )
  expect(themes.length).toBeGreaterThan(20)

  const shortfalls: string[] = []
  for (const theme of themes) {
    await page.evaluate((t) => {
      document.documentElement.dataset.theme = t
    }, theme)
    await page.waitForTimeout(50)
    const measured = await page.evaluate((PANE) => {
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 1
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!
      const paint = (...layers: string[]): number[] => {
        ctx.clearRect(0, 0, 1, 1)
        for (const layer of layers) {
          ctx.fillStyle = layer
          ctx.fillRect(0, 0, 1, 1)
        }
        return Array.from(ctx.getImageData(0, 0, 1, 1).data).slice(0, 3)
      }
      const luminance = (c: number[]): number => {
        const [r, g, b] = c.map((v) => {
          const x = v / 255
          return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4
        })
        return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
      }
      const ratio = (a: number[], b: number[]): number => {
        const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
        return (hi! + 0.05) / (lo! + 0.05)
      }
      const opaque = (el: Element | null): string => {
        while (el) {
          const bg = getComputedStyle(el).backgroundColor
          if (bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)') return bg
          el = el.parentElement
        }
        return '#fff'
      }
      return (['old', 'new'] as const).map((side) => {
        const pane = document.querySelector(PANE[side])!
        const gutters = pane.querySelector('.cm-gutters')!
        const layers = [opaque(gutters.parentElement), getComputedStyle(gutters).backgroundColor]
        const ground = paint(...layers)
        // Painted over the gutter, not on its own. A translucent colour read off
        // an empty canvas comes back at full strength, and a bar faded to 30%
        // passed every theme that way.
        const against = (colour: string): number => ratio(paint(...layers, colour), ground)
        const bar = pane.querySelector('.cm-or-diff-bar')
        const number = pane.querySelector('.cm-lineNumbers .cm-or-diff-changed')
        // Absent reads as no contrast at all, which is what it is to the eye.
        return {
          side,
          bar: bar ? against(getComputedStyle(bar).backgroundColor) : 1,
          number: number ? against(getComputedStyle(number).color) : 1
        }
      })
    }, PANE)
    for (const { side, bar, number } of measured) {
      // 3:1 is what WCAG asks of a mark that carries meaning, 4.5:1 of text.
      if (bar < 3) shortfalls.push(`${theme} ${side} bar ${bar.toFixed(2)}:1`)
      if (number < 4.5) shortfalls.push(`${theme} ${side} number ${number.toFixed(2)}:1`)
    }
  }
  expect(shortfalls).toEqual([])
})
