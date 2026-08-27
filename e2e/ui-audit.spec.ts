import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { launchApp, openVault } from './helpers'

let app: ElectronApplication
let page: Page
let vault: string

/**
 * Contrast and target size, measured on the running app.
 *
 * Both are properties of the rendered pixels, not of any one rule: a token can
 * be correct and still fail once a theme, a translucent background, an inner
 * span from the syntax highlighter and a font size combine. The only honest way
 * to check them is to compute them from what the app actually painted.
 */

/**
 * Palettes chosen for where they break, not for coverage: the light themes with
 * the least headroom between their own ink and paper, plus a dark spread. The
 * per-theme token maths is unit-tested; what this catches is a rule that paints
 * over those tokens, which is theme-independent but only visible on the
 * palettes with no margin.
 */
const THEMES: [string, 'light' | 'dark'][] = [
  ['zinc-light', 'light'],
  ['solarized-light', 'light'],
  ['everforest-light', 'light'],
  ['ayu-light', 'light'],
  ['zinc-dark', 'dark'],
  ['monokai-pro', 'dark'],
  ['solarized-dark', 'dark']
]

test.beforeAll(async () => {
  vault = mkdtempSync(join(tmpdir(), 'zymd-ui-audit-'))
  mkdirSync(join(vault, 'Folder'), { recursive: true })
  // Every construct that dresses its own text: a wikilink's colour comes from
  // the link rule but its inner span comes from the highlighter, and only one
  // of those was right until this fixture grew a link.
  writeFileSync(
    join(vault, 'Index.md'),
    '# Weekly review\n\nProse with **bold**, `code`, a #tag, a [[Other]] and a [link](https://x.com).\n\n' +
      '- one\n- [ ] two\n\n> [!NOTE] Heads up\n> Body of the note.\n\n```ts\nconst a = 1\n```\n'
  )
  writeFileSync(join(vault, 'Other.md'), '# Other\n\nBack to [[Index]]. #tag\n')
  writeFileSync(join(vault, 'Folder', 'Deep.md'), '# Deep\n\nSee [[Index]].\n')

  app = await launchApp()
  page = await app.firstWindow()
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.waitForSelector('.app', { timeout: 30_000 })
  await openVault(page, vault, 'Index.md')
  await page.locator('.tree-row--file', { hasText: 'Index.md' }).click()
  await expect(page.locator('.tree-row--active')).toBeVisible({ timeout: 10_000 })
  await page.waitForTimeout(400)
})

test.afterAll(async () => {
  await app.close()
  rmSync(vault, { recursive: true, force: true })
})

interface Fail {
  sel: string
  parent: string
  text: string
  ratio: number
  size: number
  /** Syntax-highlighted code, which the themes colour from upstream palettes. */
  code: boolean
}

/** Every visible piece of text whose contrast is under its WCAG AA threshold. */
async function contrastFailures(): Promise<Fail[]> {
  return page.evaluate(() => {
    const parse = (c: string): [number, number, number, number] => {
      const m = c.match(/[\d.]+/g)!.map(Number)
      return [m[0]!, m[1]!, m[2]!, m[3] ?? 1]
    }
    const channel = (v: number): number => {
      const s = v / 255
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
    }
    const lum = (c: [number, number, number]): number =>
      0.2126 * channel(c[0]) + 0.7152 * channel(c[1]) + 0.0722 * channel(c[2])
    // Composite translucent ink over the first opaque surface behind it.
    const surfaceOf = (el: Element): [number, number, number] => {
      let node: Element | null = el
      while (node) {
        const c = parse(getComputedStyle(node).backgroundColor)
        if (c[3] > 0.95) return [c[0], c[1], c[2]]
        node = node.parentElement
      }
      return [255, 255, 255]
    }
    const name = (el: Element | null): string =>
      el ? el.className.toString().split(' ').slice(0, 2).join('.') || el.tagName : ''

    const out: Fail[] = []
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      const ownText = Array.from(el.childNodes).some(
        (n) => n.nodeType === 3 && (n.textContent ?? '').trim().length > 0
      )
      if (!ownText) continue
      const rect = el.getBoundingClientRect()
      if (rect.width < 1 || rect.height < 1) continue
      const cs = getComputedStyle(el)
      if (cs.visibility === 'hidden' || cs.opacity === '0') continue

      const bg = surfaceOf(el)
      const ink = parse(cs.color)
      const fg: [number, number, number] = [
        ink[0] * ink[3] + bg[0] * (1 - ink[3]),
        ink[1] * ink[3] + bg[1] * (1 - ink[3]),
        ink[2] * ink[3] + bg[2] * (1 - ink[3])
      ]
      const a = lum(fg)
      const b = lum(bg)
      const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
      const size = parseFloat(cs.fontSize)
      const large = size >= 24 || (size >= 18.66 && Number(cs.fontWeight) >= 700)
      if (ratio < (large ? 3 : 4.5) - 0.01) {
        out.push({
          sel: name(el),
          parent: name(el.parentElement),
          text: (el.textContent ?? '').trim().slice(0, 30),
          ratio: Math.round(ratio * 100) / 100,
          size,
          code: !!el.closest('.cm-zy-code-line, .cm-zy-inline-code, .cm-zy-code-block')
        })
      }
    }
    return out.sort((x, y) => x.ratio - y.ratio)
  }) as Promise<Fail[]>
}

/** Switch palette. Settings reach the renderer on reload, as openVault does. */
async function useTheme(
  id: string,
  appearance: 'light' | 'dark',
  highContrastCode = false
): Promise<void> {
  await page.evaluate(
    async ([themeId, mode, hc]) => {
      const current = await window.zymd.invoke('settings:get', undefined)
      await window.zymd.invoke('settings:set', {
        ...current,
        theme: mode,
        highContrastCode: hc === 'on',
        lightTheme: mode === 'light' ? themeId : current.lightTheme,
        darkTheme: mode === 'dark' ? themeId : current.darkTheme
      })
    },
    [id, appearance, highContrastCode ? 'on' : 'off']
  )
  await page.reload()
  await page.waitForSelector('.app', { timeout: 30_000 })
  await page.locator('.tree-row--file', { hasText: 'Index.md' }).click()
  await expect(page.locator('.tree-row--active')).toBeVisible({ timeout: 10_000 })
  await page.waitForTimeout(400)
  await expect
    .poll(() => page.evaluate(() => document.documentElement.getAttribute('data-theme')))
    .toBe(id)
}

for (const [id, appearance] of THEMES) {
  test(`UI text meets WCAG AA in ${id}`, async () => {
    await useTheme(id, appearance)
    const fails = await contrastFailures()

    // Syntax highlighting is held out, and counted out loud rather than
    // quietly dropped. Those seven colours per theme are the upstream
    // palettes — Dracula's comment grey, Nord's cyan — and 26 of the 28 themes
    // ship at least one under AA, seven of them all seven. Repainting them to
    // clear 4.5:1 would mean these no longer look like the themes they are
    // named after, which is a product decision rather than a defect to fix
    // behind a test.
    const code = fails.filter((f) => f.code)
    const chrome = fails.filter((f) => !f.code)
    if (code.length) {
      console.log(
        `${id}: ${code.length} syntax-highlighting token(s) under AA, worst ` +
          `${Math.min(...code.map((c) => c.ratio))}:1 — held out by design`
      )
    }
    expect(chrome, JSON.stringify(chrome, null, 1)).toHaveLength(0)
  })
}

test('high-contrast code makes the worst palette readable', async () => {
  // Ayu Light is the sharpest case: as published, every one of its seven code
  // colours is under AA and its `function` colour sits at 1.78:1.
  await useTheme('ayu-light', 'light')
  const before = (await contrastFailures()).filter((f) => f.code)
  expect(before.length, 'the default keeps the palette as published').toBeGreaterThan(0)

  await useTheme('ayu-light', 'light', true)
  const after = (await contrastFailures()).filter((f) => f.code)
  expect(after, JSON.stringify(after, null, 1)).toHaveLength(0)

  // ...and it is the code that changed, not the rest of the UI.
  const chrome = (await contrastFailures()).filter((f) => !f.code)
  expect(chrome, JSON.stringify(chrome, null, 1)).toHaveLength(0)

  await useTheme('zinc-light', 'light')
})

test('every control is reachable and named', async () => {
  const targets = await page.evaluate(() =>
    Array.from(document.querySelectorAll('button, [role="button"], a'))
      .map((el) => {
        const r = el.getBoundingClientRect()
        const cx = r.left + r.width / 2
        const cy = r.top + r.height / 2
        // The clickable area, which is what the criterion is about — a small
        // glyph may still carry a full-size hit area around it.
        const reaches = (dx: number, dy: number): boolean => {
          const at = document.elementFromPoint(cx + dx, cy + dy)
          return !!at && (at === el || el.contains(at))
        }
        return {
          sel: el.className.toString().split(' ').slice(0, 2).join('.') || el.tagName,
          label: (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 24),
          named: !!(el.getAttribute('title') ?? el.getAttribute('aria-label')),
          w: Math.round(r.width),
          h: Math.round(r.height),
          reach:
            r.width >= 24 && r.height >= 24
              ? true
              : reaches(-11, -11) && reaches(11, -11) && reaches(-11, 11) && reaches(11, 11)
        }
      })
      .filter((t) => t.w > 0 && t.h > 0)
  )

  expect(targets.length).toBeGreaterThan(8)
  const unnamed = targets.filter((t) => !t.named && !t.label)
  expect(unnamed, JSON.stringify(unnamed)).toHaveLength(0)
  const tooSmall = targets.filter((t) => !t.reach)
  expect(tooSmall, JSON.stringify(tooSmall, null, 1)).toHaveLength(0)
})
