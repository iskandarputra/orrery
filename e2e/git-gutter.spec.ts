import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { closeCleanly, launchApp, openVault } from './helpers'

let app: ElectronApplication
let page: Page
let vault: string

const git = (args: string[], cwd: string): void => {
  execFileSync('git', args, { cwd, stdio: 'ignore' })
}

const ORIGINAL = ['one', 'two', 'three', 'four', 'five'].map((n) => `const ${n} = 1`).join('\n')

/**
 * Long enough that where a mark sits is a measurement rather than a guess.
 *
 * Five lines all land in the top few pixels of any track, so a ruler that put
 * every band at the top would pass against ORIGINAL. Two hundred lines with the
 * edit at 150 puts the answer three quarters of the way down, which only
 * proportional placement can produce.
 */
const LONG_LINES = 200
const LONG = Array.from({ length: LONG_LINES }, (_, i) => `const n${i + 1} = 1`).join('\n') + '\n'

async function open(file: string): Promise<void> {
  await page.locator('.tree-row--file', { hasText: file }).click()
  await expect(page.locator('.cm-content')).toBeVisible({ timeout: 15_000 })
}

/** The change bars currently drawn, top to bottom. */
async function marks(): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('.cm-or-git-mark')).map((el) =>
      el.className.replace('cm-or-git-mark cm-or-git-mark--', '')
    )
  )
}

/** The text of the line each change bar actually sits beside. */
async function markedLines(): Promise<string[]> {
  return page.evaluate(() => {
    const lines = Array.from(document.querySelectorAll('.cm-content .cm-line'))
    return Array.from(document.querySelectorAll('.cm-or-git-mark')).map((mark) => {
      // The mark's centre, not its top edge: a top edge sits exactly on the
      // boundary between two lines, and any tolerance picks the wrong one.
      const box = mark.getBoundingClientRect()
      const y = box.top + box.height / 2
      const hit = lines.find((l) => {
        const r = l.getBoundingClientRect()
        return y >= r.top && y < r.bottom
      })
      return hit?.textContent ?? '(no line)'
    })
  })
}

/** Change line 150 of the long fixture, three quarters of the way down it. */
function editLong150(): void {
  const edited = LONG.split('\n')
  edited[149] = 'const n150 = 999'
  writeFileSync(join(vault, 'long.ts'), edited.join('\n'))
}

/** Every band on the scrollbar ruler, as a fraction of the track it sits on. */
async function rulerBands(): Promise<{ centre: number; height: number }[]> {
  return page.evaluate(() => {
    const ruler = document.querySelector('.cm-or-ruler')
    if (!ruler) return []
    const track = ruler.getBoundingClientRect()
    return Array.from(ruler.querySelectorAll('.cm-or-ruler-change'))
      .filter((el) => (el as HTMLElement).style.display !== 'none')
      .map((el) => {
        const box = el.getBoundingClientRect()
        return {
          centre: (box.top + box.height / 2 - track.top) / track.height,
          height: box.height
        }
      })
  })
}

test.beforeAll(async () => {
  vault = mkdtempSync(join(tmpdir(), 'orrery-git-'))
  writeFileSync(join(vault, 'Note.md'), '# Note\n\nProse.\n')
  writeFileSync(join(vault, 'committed.ts'), ORIGINAL + '\n')
  writeFileSync(join(vault, 'loose.ts'), 'const loose = 1\n')
  writeFileSync(join(vault, 'anchor.ts'), ORIGINAL + '\n')
  writeFileSync(join(vault, 'reloaded.ts'), ORIGINAL + '\n')
  writeFileSync(join(vault, 'long.ts'), LONG)

  git(['init'], vault)
  git(['config', 'user.email', 'test@example.com'], vault)
  git(['config', 'user.name', 'Test'], vault)
  git(['add', 'committed.ts', 'anchor.ts', 'reloaded.ts', 'long.ts', 'Note.md'], vault)
  git(['commit', '-m', 'base'], vault)
  // Committed clean, then changed on disk before the app ever opens it, so the
  // tab starts with exactly one bar.
  writeFileSync(
    join(vault, 'reloaded.ts'),
    [
      'const one = 999',
      'const two = 1',
      'const three = 1',
      'const four = 1',
      'const five = 1'
    ].join('\n') + '\n'
  )

  app = await launchApp()
  page = await app.firstWindow()
  await page.setViewportSize({ width: 1300, height: 850 })
  await page.waitForSelector('.app', { timeout: 30_000 })
  await openVault(page, vault, 'committed.ts')
})

test.afterAll(async () => {
  // A test here types without saving; quitting dirty raises the app's "save
  // changes?" prompt, which nothing in a headless run can answer.
  await closeCleanly(app, page)
  rmSync(vault, { recursive: true, force: true })
})

test('a file matching HEAD has a gutter but no bars', async () => {
  await open('committed.ts')
  // The column is always there; only the marks come and go.
  await expect(page.locator('.cm-or-git-gutter')).toBeVisible()
  await expect.poll(async () => (await marks()).length, { timeout: 10_000 }).toBe(0)
})

test('an edit on disk shows as modified, and an insertion as added', async () => {
  // Line 2 rewritten, and two new lines pushed in after it.
  writeFileSync(
    join(vault, 'committed.ts'),
    [
      'const one = 1',
      'const two = 999',
      'const inserted = 1',
      'const also = 1',
      'const three = 1',
      'const four = 1',
      'const five = 1'
    ].join('\n') + '\n'
  )
  await open('Note.md')
  await open('committed.ts')
  await expect
    .poll(async () => (await marks()).join(','), { timeout: 10_000 })
    .toBe('modified,added,added')
})

/**
 * Marks are anchored to document positions, not line numbers. Typing above a
 * marked line must carry the mark down with the code it belongs to — a gutter
 * that points one line off is worse than no gutter, because it is believed.
 */
/**
 * Marks are anchored to document positions, so they stay beside their code
 * while you type rather than drifting a line off — a gutter that points at the
 * wrong line is worse than none, because it is believed.
 *
 * The anchoring itself is proved directly in git-gutter.test.ts, over both
 * insertion and deletion above a mark. This checks it survives a real edit in
 * the running app.
 */
test('a mark survives typing and stays beside its code', async () => {
  writeFileSync(
    join(vault, 'anchor.ts'),
    // Same line count as HEAD, so the only mark is the modification itself.
    [
      'const one = 1',
      'const two = 999',
      'const three = 1',
      'const four = 1',
      'const five = 1'
    ].join('\n') + '\n'
  )
  await open('anchor.ts')
  await expect
    .poll(async () => (await markedLines())[0], { timeout: 10_000 })
    .toBe('const two = 999')

  await page.locator('.cm-content').click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type('x')

  // Still there, still beside the same code.
  expect(await markedLines()).toEqual(['const two = 999'])
})

test('a deletion leaves a single mark', async () => {
  writeFileSync(join(vault, 'committed.ts'), ['const one = 1', 'const five = 1'].join('\n') + '\n')
  await open('Note.md')
  await open('committed.ts')
  await expect.poll(async () => await marks(), { timeout: 10_000 }).toContain('removed')
})

test('an untracked file draws no bars, and does not error', async () => {
  await open('loose.ts')
  await expect(page.locator('.cm-or-git-gutter')).toBeVisible()
  await expect.poll(async () => (await marks()).length, { timeout: 10_000 }).toBe(0)
})

test('a note gets no git gutter', async () => {
  await open('Note.md')
  await expect(page.locator('.cm-or-git-gutter')).toHaveCount(0)
})

/**
 * A file changed by another program while it is open and in front of you.
 *
 * The reload replaces the whole document, and every mark is anchored to a
 * position inside the range being replaced — so without an explicit refresh the
 * bars are mapped away and never come back. That is worse than showing nothing:
 * the gutter goes silent on a file that has just changed underneath the user.
 */
test('marks survive the file changing on disk underneath an open tab', async () => {
  await open('reloaded.ts')
  await expect.poll(async () => (await marks()).join(','), { timeout: 10_000 }).toBe('modified')

  // The second external edit, while the tab stays in front. No tab switch here:
  // switching would rebuild the state and hide the bug being tested.
  writeFileSync(
    join(vault, 'reloaded.ts'),
    [
      'const one = 999',
      'const two = 999',
      'const three = 1',
      'const four = 1',
      'const five = 1'
    ].join('\n') + '\n'
  )
  await expect
    .poll(async () => (await marks()).join(','), { timeout: 10_000 })
    .toBe('modified,modified')
})

/**
 * The ruler is the answer to "where in this file are my edits", which the
 * gutter cannot give: the gutter only speaks for the lines on screen, and the
 * minimap only for the part of the file it is scrolled near.
 */
test('the ruler sits over the scroll track, at its full height', async () => {
  writeFileSync(join(vault, 'long.ts'), LONG)
  await open('long.ts')
  const box = await page.evaluate(() => {
    const editor = document.querySelector('.cm-editor')!.getBoundingClientRect()
    const ruler = document.querySelector('.cm-or-ruler')?.getBoundingClientRect()
    if (!ruler) return null
    return {
      width: Math.round(ruler.width),
      // Distance from each edge of the editor, which is where the native
      // scrollbar's gutter is. Anything else and the bands mark thin air.
      fromRight: Math.round(editor.right - ruler.right),
      fromTop: Math.round(ruler.top - editor.top),
      fromBottom: Math.round(editor.bottom - ruler.bottom)
    }
  })
  expect(box).toEqual({ width: 12, fromRight: 0, fromTop: 0, fromBottom: 0 })

  // And the track underneath is widened to match. The app's scrollbars are 6px
  // everywhere else; a 3px band in a 6px track is a smudge with no room either
  // side of it. The width is carried by the ruler's own CodeMirror theme, so it
  // reaches exactly the editors that have a ruler and nothing else.
  const track = await page
    .locator('.cm-scroller')
    .first()
    .evaluate((el) => el.offsetWidth - el.clientWidth)
  expect(track).toBe(12)

  // A note is not a code file: it has no ruler, and keeps the app's own width.
  await open('Note.md')
  const prose = await page
    .locator('.cm-scroller')
    .first()
    .evaluate((el) => el.offsetWidth - el.clientWidth)
  expect(prose).toBeLessThan(12)
})

test('a file matching HEAD has a ruler but no bands', async () => {
  writeFileSync(join(vault, 'long.ts'), LONG)
  await open('Note.md')
  await open('long.ts')
  await expect(page.locator('.cm-or-ruler')).toHaveCount(1)
  await expect.poll(async () => (await rulerBands()).length, { timeout: 10_000 }).toBe(0)
})

test('a band sits where in the whole file the change is, not where the view is', async () => {
  await editLong150()
  await open('Note.md')
  await open('long.ts')

  await expect.poll(async () => (await rulerBands()).length, { timeout: 10_000 }).toBe(1)
  const [band] = await rulerBands()
  // Line 150 of 200 is three quarters of the way down. The tolerance covers the
  // band being grown to its 3px floor, which on an 800px track is a fraction of
  // a percent, and nothing like the difference between 0.75 and the 0 a ruler
  // that ignored the line number would produce.
  expect(band!.centre).toBeGreaterThan(0.73)
  expect(band!.centre).toBeLessThan(0.77)

  // Scrolling must not move it: the ruler stands for the file, not the viewport.
  await page.locator('.cm-content').click()
  await page.keyboard.press('Control+End')
  await expect
    .poll(async () => (await rulerBands())[0]?.centre, { timeout: 5_000 })
    .toBeGreaterThan(0.73)
  expect((await rulerBands())[0]!.centre).toBeLessThan(0.77)
})

test('a one-line change is grown to something you can see', async () => {
  await editLong150()
  await open('Note.md')
  await open('long.ts')
  await expect.poll(async () => (await rulerBands()).length, { timeout: 10_000 }).toBe(1)
  // One line of 200 on an ~800px track is 4px, already over the floor; the
  // point is that it is never the sub-pixel a naive scaling gives on a file of
  // a few thousand lines.
  expect((await rulerBands())[0]!.height).toBeGreaterThanOrEqual(3)
})

test('the ruler stays when the minimap is switched off', async () => {
  // The case that started this: turning the minimap off used to take every view
  // of where the edits are with it, leaving only a gutter that speaks for the
  // twenty lines on screen.
  // Its own edit rather than the previous test's: a spec whose tests only pass
  // in order is a spec nobody can run one test of.
  await editLong150()
  await open('Note.md')
  await open('long.ts')
  await expect(page.locator('.cm-minimap-gutter')).toBeVisible()
  await expect.poll(async () => (await rulerBands()).length, { timeout: 10_000 }).toBe(1)

  const minimapToggle = async (): Promise<void> => {
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.webContents.send('menu:command', {
        commandId: 'app.openSettings'
      })
    })
    // The dialog opens on General, and the toggle is two sections along.
    await page.locator('.settings__nav-item', { hasText: 'Editor' }).click()
    await page.getByRole('switch', { name: 'Minimap' }).click()
    await page.keyboard.press('Escape')
    await expect(page.locator('.settings')).toHaveCount(0)
  }

  await minimapToggle()
  await expect(page.locator('.cm-minimap-gutter')).toHaveCount(0)
  await expect(page.locator('.cm-or-ruler')).toHaveCount(1)
  await expect.poll(async () => (await rulerBands()).length, { timeout: 10_000 }).toBe(1)
  const [band] = await rulerBands()
  expect(band!.centre).toBeGreaterThan(0.73)
  expect(band!.centre).toBeLessThan(0.77)

  // Put back: the setting is global and this is not the last spec to run.
  await minimapToggle()
  await expect(page.locator('.cm-minimap-gutter')).toBeVisible()
})
