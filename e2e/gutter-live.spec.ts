import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { closeCleanly, launchApp, openVault } from './helpers'

/**
 * The change bars beside a code file, kept current and kept visible.
 *
 * They were read when a file opened or saved and at no other time, so a commit
 * made in a terminal left them standing beside lines that were no longer
 * changes. And they were drawn in a fixed palette that measured under 3:1
 * against a white editor.
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

const BASE = [
  'const one = 1',
  'const two = 2',
  'const three = 3',
  'const four = 4',
  'const five = 5'
]

const marks = () => page.locator('.cm-or-git-mark')

test.beforeAll(async () => {
  vault = mkdtempSync(join(tmpdir(), 'orrery-gutter-live-'))
  writeFileSync(join(vault, 'Index.md'), '# Index\n')
  writeFileSync(join(vault, 'util.ts'), BASE.join('\n') + '\n')
  git('init', '-q', '.')
  git('add', '.')
  git('commit', '-qm', 'base')
  // One line changed and one added, before the app opens the file.
  writeFileSync(
    join(vault, 'util.ts'),
    ['const one = 1', 'const two = 22', ...BASE.slice(2), 'const six = 6'].join('\n') + '\n'
  )

  app = await launchApp()
  page = await app.firstWindow()
  await page.setViewportSize({ width: 1200, height: 800 })
  await page.waitForSelector('.app', { timeout: 30_000 })
  await openVault(page, vault, 'util.ts')
  await page.locator('.tree-row--file', { hasText: 'util.ts' }).click()
  await expect(page.locator('.cm-content')).toContainText('const six', { timeout: 15_000 })
})

test.afterAll(async () => {
  await closeCleanly(app, page)
  rmSync(vault, { recursive: true, force: true })
})

test('a commit made in a terminal clears the bars without touching the file', async () => {
  await expect(marks()).toHaveCount(2, { timeout: 15_000 })
  git('commit', '-qam', 'from a terminal')
  // Nothing in the editor changed, and nothing was saved.
  await expect(marks()).toHaveCount(0, { timeout: 10_000 })
})

test('each kind of bar is drawn in its diff colour and stands out in every theme', async () => {
  // Changed on disk while open and clean, so the editor reloads it: one line
  // modified, one removed, one added.
  writeFileSync(
    join(vault, 'util.ts'),
    [
      'const one = 1',
      'const two = 222',
      'const three = 3',
      'const five = 5',
      'const six = 6',
      'const seven = 7'
    ].join('\n') + '\n'
  )
  await expect(page.locator('.cm-content')).toContainText('const seven', { timeout: 15_000 })
  for (const kind of ['added', 'modified', 'removed']) {
    await expect(page.locator(`.cm-or-git-mark--${kind}`).first()).toBeAttached({
      timeout: 15_000
    })
  }

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
    const measured = await page.evaluate(() => {
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
      const root = getComputedStyle(document.documentElement)
      const gutters = document.querySelector('.cm-gutters')!
      let behind: Element | null = gutters
      let ground = '#fff'
      while (behind) {
        const bg = getComputedStyle(behind).backgroundColor
        if (bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)') {
          ground = bg
          break
        }
        behind = behind.parentElement
      }
      const token = { added: '--or-diff-add', modified: '--or-diff-mod', removed: '--or-diff-del' }
      return (['added', 'modified', 'removed'] as const).map((kind) => {
        const mark = document.querySelector(`.cm-or-git-mark--${kind}`)!
        const style = getComputedStyle(mark)
        // A removal is a wedge drawn by its left border, not a filled bar.
        const drawn = kind === 'removed' ? style.borderLeftColor : style.backgroundColor
        const colour = paint(ground, drawn)
        return {
          kind,
          isToken:
            colour.join() === paint(ground, root.getPropertyValue(token[kind]).trim()).join(),
          ratio: ratio(colour, paint(ground))
        }
      })
    })
    for (const m of measured) {
      if (!m.isToken) shortfalls.push(`${theme} ${m.kind} is not the diff colour`)
      // 3:1 is what WCAG asks of a mark that carries meaning.
      if (m.ratio < 3) shortfalls.push(`${theme} ${m.kind} ${m.ratio.toFixed(2)}:1`)
    }
  }
  expect(shortfalls).toEqual([])
})
