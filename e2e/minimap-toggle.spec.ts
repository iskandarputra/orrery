import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { closeCleanly, launchApp, openVault } from './helpers'

/**
 * Collapsing the minimap, from the status bar.
 *
 * Collapse, not hide. At 120px the preview is a grey smudge of a file you
 * cannot read anyway, but where the edits are stays legible at any width, so
 * the canvas goes and the change ruler widens to a fifth of it and takes its
 * place. What is left is a strip of green and red to scroll against, and 96px
 * back for the text.
 *
 * A real repository, because the strip is worth nothing without changes in it:
 * a test that only proved the column got narrower would pass on a version that
 * threw the diff away with the canvas.
 */

let app: ElectronApplication
let page: Page
let vault: string

/** 400 lines, so a hunk in the middle is a band rather than the whole track. */
const ORIGINAL = Array.from({ length: 400 }, (_, i) => `const value${i} = ${i} * 2`).join('\n')

const MINIMAP_WIDTH = 120
const RULER_WIDTH = 12
const COLLAPSED_WIDTH = 24

const button = (): ReturnType<Page['locator']> =>
  page.locator('.status-bar__btn', { hasText: 'Minimap' })

const open = async (file: string): Promise<void> => {
  await page.locator('.tree-row--file', { hasText: file }).click()
  await expect(page.locator('.tab--active')).toContainText(file.replace(/\.md$/, ''))
}

/** The ruler's bands, as fractions of the track, with their widths. */
async function bands(): Promise<{ count: number; width: number; colours: string[] }> {
  return page.evaluate(() => {
    const marks = [...document.querySelectorAll('.cm-or-ruler-change')].filter(
      (el) => (el as HTMLElement).style.display !== 'none'
    ) as HTMLElement[]
    return {
      count: marks.length,
      width: marks[0] ? Math.round(marks[0].getBoundingClientRect().width) : 0,
      colours: marks.map((m) => getComputedStyle(m).backgroundColor)
    }
  })
}

const rulerWidth = (): Promise<number> =>
  page
    .locator('.cm-or-ruler')
    .first()
    .evaluate((el) => Math.round(el.getBoundingClientRect().width))

const contentWidth = (): Promise<number> =>
  page
    .locator('.cm-content')
    .first()
    .evaluate((el) => Math.round(el.getBoundingClientRect().width))

test.beforeAll(async () => {
  vault = mkdtempSync(join(tmpdir(), 'orrery-minimap-'))
  const git = (...args: string[]): void => {
    execFileSync('git', args, { cwd: vault, stdio: 'ignore' })
  }
  writeFileSync(join(vault, 'Note.md'), '# Note\n\nProse, which has no minimap.\n')
  writeFileSync(join(vault, 'long.ts'), ORIGINAL)
  git('init', '-q')
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'Test')
  git('add', '.')
  git('commit', '-qm', 'first')
  // One hunk, three quarters of the way down, so a band has somewhere to be.
  writeFileSync(
    join(vault, 'long.ts'),
    ORIGINAL.split('\n')
      .map((line, i) => (i >= 300 && i < 306 ? `${line} // edited` : line))
      .join('\n')
  )
  // And the note changed too, so source control can offer a markdown diff.
  writeFileSync(join(vault, 'Note.md'), '# Note\n\nProse, which has no minimap. Edited.\n')

  app = await launchApp()
  page = await app.firstWindow()
  await page.setViewportSize({ width: 1200, height: 800 })
  await page.waitForSelector('.app', { timeout: 30_000 })
  await openVault(page, vault, 'long.ts')
})

test.afterAll(async () => {
  await closeCleanly(app, page)
  rmSync(vault, { recursive: true, force: true })
})

test('a code file gets the switch, and it says the minimap is showing', async () => {
  await open('long.ts')
  await expect(page.locator('.cm-minimap-gutter')).toBeVisible({ timeout: 15_000 })
  await expect(button()).toBeVisible()
  // Which way it is set has to be readable without hovering it: a tooltip is
  // not on screen.
  await expect(button()).toHaveAttribute('aria-pressed', 'true')
  expect(await rulerWidth()).toBe(RULER_WIDTH)
})

test('collapsing takes the preview away and leaves the changes', async () => {
  await open('long.ts')
  // The hunk is marked before the collapse, or the assertion after it proves
  // nothing about what survived.
  await expect.poll(async () => (await bands()).count, { timeout: 15_000 }).toBe(1)
  const before = await bands()

  await button().click()

  // The canvas goes...
  await expect(page.locator('.cm-minimap-gutter')).toHaveCount(0)
  await expect(button()).toHaveAttribute('aria-pressed', 'false')
  // ...the strip stays, at a fifth of the minimap rather than the minimap's
  // width or the ordinary scrollbar's...
  await expect.poll(rulerWidth).toBe(COLLAPSED_WIDTH)
  expect(COLLAPSED_WIDTH).toBe(MINIMAP_WIDTH / 5)
  // ...and the change is still on it, in the colour it was.
  const after = await bands()
  expect(after.count).toBe(1)
  expect(after.colours).toEqual(before.colours)
  // The band widens with the strip, so it is a mark and not a hairline.
  expect(after.width).toBeGreaterThan(before.width)
})

test('the band stays where the hunk is', async () => {
  // Collapsed is still a map of the whole file. A strip that showed only the
  // part scrolled near would put this band at the top.
  await open('long.ts')
  const where = await page.evaluate(() => {
    const ruler = document.querySelector('.cm-or-ruler') as HTMLElement
    const band = document.querySelector('.cm-or-ruler-change') as HTMLElement
    const track = ruler.getBoundingClientRect()
    const mark = band.getBoundingClientRect()
    return (mark.top + mark.height / 2 - track.top) / track.height
  })
  // Lines 301-306 of 400.
  expect(where).toBeGreaterThan(0.7)
  expect(where).toBeLessThan(0.82)
})

test('the editor takes back the width the preview was using', async () => {
  await open('long.ts')
  const collapsed = await contentWidth()

  await button().click()
  await expect(page.locator('.cm-minimap-gutter')).toBeVisible()
  const expanded = await contentWidth()

  // 120px of canvas back, less the 12px the strip grew by.
  expect(collapsed - expanded).toBeGreaterThan(MINIMAP_WIDTH - COLLAPSED_WIDTH - 4)
})

test('a note does not offer it, because a note never had one', async () => {
  await open('Note.md')
  await expect(page.locator('.cm-minimap-gutter')).toHaveCount(0)
  await expect(button()).toHaveCount(0)
})

test('the choice survives a restart', async () => {
  await open('long.ts')
  await button().click()
  await expect(page.locator('.cm-minimap-gutter')).toHaveCount(0)

  await page.reload()
  await page.waitForSelector('.app', { timeout: 30_000 })
  await open('long.ts')
  await expect(button()).toHaveAttribute('aria-pressed', 'false', { timeout: 15_000 })
  await expect.poll(rulerWidth).toBe(COLLAPSED_WIDTH)
})

test('the command reaches it too, and puts it back', async () => {
  await open('long.ts')
  await expect(page.locator('.cm-minimap-gutter')).toHaveCount(0)
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('menu:command', {
      commandId: 'view.toggleMinimap'
    })
  })
  await expect(page.locator('.cm-minimap-gutter')).toBeVisible()
  await expect(button()).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(rulerWidth).toBe(RULER_WIDTH)
})

test('the diff view collapses with it', async () => {
  // The switch is in the status bar over the editor, but the diff has a
  // minimap of its own and a ruler of its own, fed by its own alignment
  // rather than by git. Leaving a 120px preview standing there while the
  // editor behind it shows a strip is the switch not meaning what it says.
  await open('long.ts')
  await expect(page.locator('.cm-minimap-gutter')).toBeVisible({ timeout: 15_000 })

  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('menu:command', {
      commandId: 'view.toggleGit'
    })
  })
  await page.locator('.scm-row__name').filter({ hasText: 'long.ts' }).click()
  await expect(page.locator('.diff__panes')).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('.diff__pane--new .cm-minimap-gutter')).toBeVisible({
    timeout: 15_000
  })

  // From the status bar, not the palette. The switch has to be on a diff tab:
  // it is the view where a map of the changes is most worth having, and it
  // was missing here while every code tab had it.
  await expect(button()).toBeVisible()
  await expect(button()).toHaveAttribute('aria-pressed', 'true')
  await button().click()
  await expect(page.locator('.diff__pane--new .cm-minimap-gutter')).toHaveCount(0)
  // And the diff's own bands survive it, at the wider strip.
  const diffRuler = page.locator('.diff__pane--new .cm-or-ruler')
  await expect
    .poll(() => diffRuler.evaluate((el) => Math.round(el.getBoundingClientRect().width)))
    .toBe(COLLAPSED_WIDTH)
  await expect.poll(() => diffRuler.locator('.cm-or-ruler-change').count()).toBeGreaterThan(0)

  await button().click()
  await expect(page.locator('.diff__pane--new .cm-minimap-gutter')).toBeVisible()

  await page.locator('.diff button[aria-label="Close"]').click()
  // Source control replaces the file tree rather than sitting beside it, so
  // the tree has to be put back by name or no test after this finds a row.
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('menu:command', {
      commandId: 'view.toggleFiles'
    })
  })
  await expect(page.locator('.tree-row--file').first()).toBeVisible({ timeout: 15_000 })
})

test('a replaced block shows red and green, not green alone', async () => {
  // The bug: the left pane showed red and the right pane green, and the strip
  // between them showed green alone, so replacing a line looked exactly like
  // writing a new one. `long.ts` has six lines rewritten in place, which is a
  // replacement and not an addition.
  await open('long.ts')
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('menu:command', {
      commandId: 'view.toggleGit'
    })
  })
  await page.locator('.scm-row__name').filter({ hasText: 'long.ts' }).click()
  await expect(page.locator('.diff__panes')).toBeVisible({ timeout: 20_000 })

  const painted = await page
    .locator('.diff__pane--new .cm-or-ruler-change')
    .first()
    .evaluate((el) => {
      const style = getComputedStyle(el)
      const del = getComputedStyle(document.documentElement)
        .getPropertyValue('--or-diff-del')
        .trim()
      const add = getComputedStyle(document.documentElement)
        .getPropertyValue('--or-diff-add')
        .trim()
      // Resolve the tokens the way the browser did, so the comparison is
      // against painted values rather than against the names.
      const resolve = (css: string): string => {
        const probe = document.createElement('span')
        probe.style.color = css
        document.body.appendChild(probe)
        const out = getComputedStyle(probe).color
        probe.remove()
        return out
      }
      return {
        image: style.backgroundImage,
        del: resolve(del),
        add: resolve(add)
      }
    })

  // One band carrying both, which is what the split is.
  expect(painted.image).toContain('linear-gradient')
  expect(painted.image).toContain(painted.del)
  expect(painted.image).toContain(painted.add)
  // Red above green: what went, then what arrived.
  expect(painted.image.indexOf(painted.del)).toBeLessThan(painted.image.indexOf(painted.add))

  await page.locator('.diff button[aria-label="Close"]').click()
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('menu:command', {
      commandId: 'view.toggleFiles'
    })
  })
  await expect(page.locator('.tree-row--file').first()).toBeVisible({ timeout: 15_000 })
})

test('a markdown diff has the switch even though a markdown note does not', async () => {
  // The diff puts a minimap on its working-tree side whatever the file is, so
  // "only code gets the switch" is the wrong rule here: the tab kind is what
  // decides, not the language.
  await open('Note.md')
  await expect(button()).toHaveCount(0)

  await page.evaluate(async () => {
    const current = await window.orrery.invoke('settings:get', undefined)
    await window.orrery.invoke('settings:set', {
      editor: { ...current.editor, minimapCollapsed: false }
    })
  })
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('menu:command', {
      commandId: 'view.toggleGit'
    })
  })
  await page.locator('.scm-row__name').filter({ hasText: 'Note.md' }).click()
  await expect(page.locator('.diff__panes')).toBeVisible({ timeout: 20_000 })

  await expect(button()).toBeVisible()
  await button().click()
  await expect(page.locator('.diff__pane--new .cm-minimap-gutter')).toHaveCount(0)

  await button().click()
  await page.locator('.diff button[aria-label="Close"]').click()
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('menu:command', {
      commandId: 'view.toggleFiles'
    })
  })
  await expect(page.locator('.tree-row--file').first()).toBeVisible({ timeout: 15_000 })
})

test('switching the minimap off in Settings takes the switch with it', async () => {
  // Nothing to collapse, so nothing to offer. The ruler goes back to marking
  // the ordinary scrollbar rather than standing in for a minimap that is not
  // there.
  await open('long.ts')
  await page.evaluate(async () => {
    const current = await window.orrery.invoke('settings:get', undefined)
    await window.orrery.invoke('settings:set', {
      editor: { ...current.editor, minimap: false, minimapCollapsed: true }
    })
  })
  await expect(button()).toHaveCount(0)
  await expect(page.locator('.cm-minimap-gutter')).toHaveCount(0)
  await expect.poll(rulerWidth).toBe(RULER_WIDTH)
  // And the changes are still marked, which is the whole reason the ruler
  // exists apart from the minimap. Polled: a reconfigure builds a new ruler
  // plugin, and it draws on the next animation frame rather than in its
  // constructor, because a scroller measures zero until it has been laid out.
  await expect.poll(async () => (await bands()).count, { timeout: 10_000 }).toBe(1)
})
