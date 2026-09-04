import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { closeCleanly, launchApp, openVault } from './helpers'

let app: ElectronApplication
let page: Page
let vault: string

const git = (...args: string[]): void => {
  execFileSync('git', args, { cwd: vault, stdio: 'ignore' })
}

async function openPanel(): Promise<void> {
  if (await page.locator('.scm').isVisible()) return
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('menu:command', {
      commandId: 'view.toggleGit'
    })
  })
  // The panel briefly shows a 'checking' empty state before the repo is known.
  await expect(page.locator('.scm')).toBeVisible({ timeout: 15_000 })
}

const refresh = async (): Promise<void> => {
  await page.locator('button[aria-label="Refresh status"]').click()
  await page.waitForTimeout(300)
}

/**
 * Click a changed file until its diff is up.
 *
 * The panel redraws every time a git status arrives, and a click that lands on
 * a row which has just been replaced does nothing at all — so this is a retry
 * rather than a single click and a wait.
 */
async function openDiff(name: string): Promise<void> {
  await expect
    .poll(
      async () => {
        if (!(await page.locator('.diff__panes').isVisible())) {
          await page
            .locator('.scm-row__name')
            .filter({ hasText: name })
            .click()
            .catch(() => {})
        }
        return page.locator('.diff__panes').isVisible()
      },
      { timeout: 20_000 }
    )
    .toBe(true)
}

test.beforeAll(async () => {
  vault = mkdtempSync(join(tmpdir(), 'orrery-scm-'))
  writeFileSync(join(vault, 'Index.md'), '# Index\n\noriginal\n')
  git('init', '-q', '.')
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'Test')
  git('config', 'commit.gpgsign', 'false')
  git('add', '.')
  git('commit', '-qm', 'base')

  app = await launchApp()
  page = await app.firstWindow()
  await page.setViewportSize({ width: 1300, height: 900 })
  await page.waitForSelector('.app', { timeout: 30_000 })
  await openVault(page, vault, 'Index.md')
})

test.afterAll(async () => {
  await closeCleanly(app, page)
  rmSync(vault, { recursive: true, force: true })
})

test('shows the branch and a clean tree', async () => {
  await openPanel()
  await expect(page.locator('.scm__branch')).toContainText(/main|master/, { timeout: 10_000 })
  await expect(page.locator('.scm')).toContainText('working tree is clean')
})

test('lists an edit, stages it, and commits it', async () => {
  writeFileSync(join(vault, 'Index.md'), '# Index\n\nedited\n')
  await openPanel()
  await refresh()

  // Appears as an unstaged change.
  await expect(page.locator('.scm__group-label').filter({ hasText: 'Unstaged' })).toBeVisible()
  await expect(page.locator('.scm-row__file')).toHaveText('Index.md')

  await page.locator('button[aria-label="Stage Index.md"]').click()
  await expect(page.locator('.scm__group-label').filter({ hasText: 'Staged' })).toBeVisible({
    timeout: 10_000
  })

  await page.locator('.scm__message').fill('a commit from the panel')
  await page.locator('.scm__commit-btn').click()

  // Clean again, and git records the message verbatim.
  await expect(page.locator('.scm')).toContainText('working tree is clean', { timeout: 10_000 })
  const subject = execFileSync('git', ['log', '-1', '--format=%s'], { cwd: vault })
    .toString()
    .trim()
  expect(subject).toBe('a commit from the panel')
})

test('an untracked file shows, and unstaging returns it', async () => {
  writeFileSync(join(vault, 'brand new.md'), 'hello\n')
  await openPanel()
  await refresh()
  await expect(page.locator('.scm-row__file')).toHaveText('brand new.md')

  await page.locator('button[aria-label="Stage brand new.md"]').click()
  await expect(page.locator('.scm__group-label').filter({ hasText: 'Staged' })).toBeVisible({
    timeout: 10_000
  })

  await page.locator('button[aria-label="Unstage brand new.md"]').click()
  await expect(page.locator('.scm__group-label').filter({ hasText: 'Unstaged' })).toBeVisible({
    timeout: 10_000
  })
  // Still on disk — unstaging must never touch the working tree.
  expect(execFileSync('git', ['status', '--porcelain'], { cwd: vault }).toString()).toContain(
    'brand new.md'
  )
})

test('clicking a file shows its diff', async () => {
  // Its own committed file: an earlier test commits Index.md, so sharing it
  // would diff against whatever that test happened to leave behind.
  writeFileSync(join(vault, 'Diffme.md'), 'alpha\nbeta\n')
  git('add', 'Diffme.md')
  git('commit', '-qm', 'add Diffme')
  writeFileSync(join(vault, 'Diffme.md'), 'alpha\nan added line\nbeta\n')

  await openPanel()
  await refresh()
  await page.locator('.scm-row__name').filter({ hasText: 'Diffme.md' }).click()

  const diff = page.locator('.diff')
  await expect(diff).toBeVisible({ timeout: 10_000 })
  await expect(diff.locator('.diff__path')).toHaveText('Diffme.md')

  // One inserted line, nothing removed, and the counts agree with the lines.
  await expect(diff.locator('.diff__stat--added')).toHaveText('+1')
  await expect(diff.locator('.diff__stat--removed')).toHaveText('-0')
  await expect(diff.locator('.cm-or-diff-line--new')).toHaveCount(1)
  await expect(diff.locator('.cm-or-diff-line--new')).toContainText('an added line')
  await expect(diff.locator('.cm-or-diff-line--old')).toHaveCount(0)

  // Both sides show the whole file, not only the changed region — that is what
  // lets the panes be read past the first hunk.
  await expect(diff.locator('.diff__pane').first().locator('.cm-line')).toContainText([
    'alpha',
    'beta'
  ])

  // And the shorter side is padded so the two stay level: the old file is one
  // line short, so it gets exactly one filler.
  await expect(diff.locator('.diff__pane').first().locator('.cm-or-diff-filler')).toHaveCount(1)

  // It is a tab, so it appears in the tab bar and closes like any other.
  await expect(page.locator('.tab--active')).toContainText('Diffme.md (diff)')
  await page.locator('.diff button[aria-label="Close"]').click()
  await expect(diff).toBeHidden()
  writeFileSync(join(vault, 'Diffme.md'), 'alpha\nbeta\n')
})

test('the working-tree column is editable and writes to the file', async () => {
  writeFileSync(join(vault, 'Editable.md'), 'first\nsecond\n')
  git('add', 'Editable.md')
  git('commit', '-qm', 'add Editable')
  writeFileSync(join(vault, 'Editable.md'), 'first\nsecond changed\n')

  await openPanel()
  await refresh()
  await page.locator('.scm-row__name').filter({ hasText: 'Editable.md' }).click()
  await expect(page.locator('.diff')).toBeVisible({ timeout: 10_000 })

  // The right pane is a real editor, so this is ordinary editing: put the
  // cursor at the end of the document and type a line, newline included. The
  // old per-line contentEditable cells could do none of that — Enter committed
  // instead of inserting, and only already-changed lines could be touched.
  const right = page.locator('.diff__pane--new .cm-content')
  await right.click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type('\nrewritten from the diff')

  // Nothing is written until it is saved, which is how an editor behaves.
  expect(readFileSync(join(vault, 'Editable.md'), 'utf-8')).not.toContain('rewritten')
  await page.keyboard.press('Control+s')

  // The file on disk carries the edit...
  await expect
    .poll(() => readFileSync(join(vault, 'Editable.md'), 'utf-8'), { timeout: 10_000 })
    .toContain('rewritten from the diff')
  // ...and the diff re-reads itself, so the new line shows as an addition.
  await expect(
    page.locator('.cm-or-diff-line--new', { hasText: 'rewritten from the diff' })
  ).toHaveCount(1)

  await page.locator('.diff button[aria-label="Close"]').click()
})

test('the staged column is read-only', async () => {
  writeFileSync(join(vault, 'Stagedonly.md'), 'alpha\n')
  git('add', 'Stagedonly.md')

  await openPanel()
  await refresh()
  // The staged group's row opens the index-vs-HEAD diff, which cannot be edited.
  await page.locator('.scm-row__name').filter({ hasText: 'Stagedonly.md' }).first().click()
  await expect(page.locator('.diff')).toBeVisible({ timeout: 10_000 })
  await expect(page.locator('.diff__heads')).toContainText('read-only')
  // Not merely undecorated: the pane refuses the keystroke.
  const before = await page.locator('.diff__pane--new .cm-content').textContent()
  await page.locator('.diff__pane--new .cm-content').click()
  await page.keyboard.type('nope')
  expect(await page.locator('.diff__pane--new .cm-content').textContent()).toBe(before)
  await expect(page.locator('.diff__edit', { hasText: 'Save' })).toHaveCount(0)

  await page.locator('.diff button[aria-label="Close"]').click()
  git('restore', '--staged', 'Stagedonly.md')
  rmSync(join(vault, 'Stagedonly.md'))
})

test('an untracked file diffs as all additions', async () => {
  writeFileSync(join(vault, 'Fresh.md'), 'alpha\nbeta\n')
  await openPanel()
  await refresh()

  await page.locator('.scm-row__name').filter({ hasText: 'Fresh.md' }).click()
  const diff = page.locator('.diff')
  await expect(diff).toBeVisible({ timeout: 10_000 })
  // Nothing in git to compare against, so every line is new.
  await expect(diff.locator('.diff__stat--added')).toHaveText('+2')
  await expect(diff.locator('.cm-or-diff-line--old')).toHaveCount(0)

  await page.locator('.diff button[aria-label="Close"]').click()
  rmSync(join(vault, 'Fresh.md'))
})

test('the graph section shows the history', async () => {
  await openPanel()
  await page.locator('.scm__section').filter({ hasText: 'Graph' }).click()

  const graph = page.locator('.gitgraph')
  await expect(graph).toBeVisible({ timeout: 10_000 })
  // Every commit made by this spec so far, each with a lane drawn beside it.
  await expect(graph.locator('.gitgraph__row').first()).toBeVisible()
  await expect(graph.locator('.gitgraph__lanes').first()).toBeVisible()
  await expect(graph).toContainText('base')
  // The branch name is shown as a ref chip on the commit it points at.
  await expect(graph.locator('.gitgraph__ref').first()).toBeVisible()

  // Switching back hides the graph and shows the changes again.
  await page.locator('.scm__section').filter({ hasText: 'Changes' }).click()
  await expect(graph).toBeHidden()
})

test('a branch is drawn in its own lane', async () => {
  // A branch that is merely ahead is still one line of development. Both sides
  // need a commit the other lacks before the graph has two lanes to draw.
  git('checkout', '-qb', 'a-side-branch')
  writeFileSync(join(vault, 'Sidework.md'), 'side\n')
  git('add', 'Sidework.md')
  git('commit', '-qm', 'work on the side')
  git('checkout', '-q', '-')
  writeFileSync(join(vault, 'Mainwork.md'), 'main\n')
  git('add', 'Mainwork.md')
  git('commit', '-qm', 'work on main')

  await openPanel()
  await page.locator('.scm__section').filter({ hasText: 'Graph' }).click()
  await expect(page.locator('.gitgraph')).toBeVisible({ timeout: 10_000 })
  await expect(page.locator('.gitgraph')).toContainText('work on the side')

  // Two lines of development means the lane column is wider than one lane.
  // Two diverged lines of development, so the lane column is two lanes wide.
  const width = await page
    .locator('.gitgraph__lanes')
    .first()
    .evaluate((el) => Number(el.getAttribute('width')))
  expect(width).toBeGreaterThan(12)
  await expect(page.locator('.gitgraph')).toContainText('work on main')

  await page.locator('.scm__section').filter({ hasText: 'Changes' }).click()
})

test('a lane crossing a row is drawn without a gap in it', async () => {
  // Each row is its own SVG, so a line crossing several rows is drawn in
  // pieces. Every row only ever drew the half below its middle, so the piece
  // above it was missing and a long-running lane — the leftmost one, which
  // crosses the most rows — came out as a column of dashes.
  //
  // Measured on the rendered geometry rather than on the markup: what matters
  // is that the painted segments meet, not how many elements say so.
  await openPanel()
  await page.locator('.scm__section').filter({ hasText: 'Graph' }).click()
  await expect(page.locator('.gitgraph')).toBeVisible({ timeout: 10_000 })

  const gaps = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('.gitgraph__lanes')) as SVGSVGElement[]
    const holes: string[] = []

    rows.forEach((svg, index) => {
      const height = Number(svg.getAttribute('height'))
      // Leftmost lane only. It is the one a linear history runs down, so in
      // every row but the first and the last it is passing through.
      const segments = (Array.from(svg.querySelectorAll('line')) as SVGLineElement[])
        .filter((l) => Math.abs(Number(l.getAttribute('x1')) - 6) < 0.01)
        .map((l) => [Number(l.getAttribute('y1')), Number(l.getAttribute('y2'))] as const)
        .sort((a, b) => a[0] - b[0])
      if (segments.length === 0) return

      const top = Math.min(...segments.map((sg) => sg[0]))
      const bottom = Math.max(...segments.map((sg) => sg[1]))
      const covered = segments.reduce((sum, sg) => sum + (sg[1] - sg[0]), 0)

      // Contiguous: the pieces add up to the span they cover, so none of the
      // middle is missing.
      if (covered < bottom - top - 0.01) holes.push(`row ${index}: pieces do not meet`)
      // A row in the middle of a run is crossed, so it is covered end to end.
      const middleRow = index > 0 && index < rows.length - 1
      if (middleRow && (top > 0.01 || bottom < height - 0.01)) {
        holes.push(`row ${index}: covers ${top}–${bottom} of 0–${height}`)
      }
    })
    return { holes, rows: rows.length }
  })

  expect(gaps.rows, 'several commits, so several rows to cross').toBeGreaterThan(2)
  expect(gaps.holes, 'the leftmost lane is one unbroken line').toEqual([])

  await page.locator('.scm__section').filter({ hasText: 'Changes' }).click()
})

test('commit is refused without a message or staged work', async () => {
  await openPanel()
  await refresh()
  // Nothing staged: the button is disabled and so is the message box.
  await expect(page.locator('.scm__commit-btn')).toBeDisabled()
})

test('the preview bands the changes across its width, in green and red', async () => {
  // Long enough that the preview draws a window of lines rather than the whole
  // file, which is the case the band arithmetic has to get right.
  const lines = Array.from({ length: 300 }, (_, i) => `line ${i + 1}`)
  writeFileSync(join(vault, 'Preview.md'), `${lines.join('\n')}\n`)
  git('add', 'Preview.md')
  git('commit', '-qm', 'a long file')

  const edited = [...lines]
  edited[9] = 'line 10, rewritten'
  edited.splice(20, 3)
  writeFileSync(join(vault, 'Preview.md'), `${edited.join('\n')}\n`)

  await openPanel()
  await refresh()
  await openDiff('Preview.md')
  await expect(page.locator('.diff__pane--new .cm-minimap-gutter')).toBeVisible({ timeout: 10_000 })

  const measure = async (): Promise<{
    bands: { top: number; height: number; width: number; red: number; green: number }[]
    gutterWidth: number
    lineTop: number
  } | null> =>
    page.evaluate(() => {
      const pane = document.querySelector('.diff__pane--new')
      const inner = pane?.querySelector('.cm-minimap-inner')
      const gutter = pane?.querySelector('.cm-minimap-gutter')
      const content = pane?.querySelector('.cm-content')
      const line = [...(pane?.querySelectorAll('.cm-line') ?? [])].find((el) =>
        el.textContent?.includes('line 10, rewritten')
      )
      if (!inner || !gutter || !content || !line) return null

      const innerTop = inner.getBoundingClientRect().top
      const bands = [...inner.querySelectorAll('.cm-or-minimap-change')]
        .filter((el) => getComputedStyle(el).display !== 'none')
        .map((el) => {
          const box = el.getBoundingClientRect()
          const [red = 0, green = 0] = (
            getComputedStyle(el).backgroundColor.match(/\d+/g) ?? []
          ).map(Number)
          return { top: box.top - innerTop, height: box.height, width: box.width, red, green }
        })
      return {
        bands,
        gutterWidth: gutter.getBoundingClientRect().width,
        // Where the rewritten line sits in the text, measured from the top of
        // the content box so the document's own padding is included.
        lineTop: line.getBoundingClientRect().top - content.getBoundingClientRect().top
      }
    })

  // The bands are placed on an animation frame, as the canvas beside them is.
  await expect.poll(async () => (await measure())?.bands.length ?? 0).toBeGreaterThanOrEqual(2)
  const seen = (await measure())!

  // Both kinds are marked: the rewritten line, and the hole three deleted lines
  // left behind — which the working tree has no line of its own for.
  const added = seen.bands.filter((band) => band.green > band.red)
  const removed = seen.bands.filter((band) => band.red > band.green)
  expect(added.length).toBeGreaterThanOrEqual(1)
  expect(removed.length).toBeGreaterThanOrEqual(1)

  // The whole width of the preview, not a strip down one edge of it. The
  // package's own gutter draws four canvas pixels, which is two here.
  for (const band of seen.bands) {
    expect(band.width).toBeGreaterThan(seen.gutterWidth * 0.8)
    expect(band.width).toBeGreaterThan(8)
    expect(band.height).toBeGreaterThanOrEqual(3)
  }

  // And beside the line it marks. A minimap line is a quarter of an editor line
  // on a canvas of twice the pixels, so the text's own geometry says where the
  // band belongs — worked out from the editor rather than from the same
  // arithmetic the bands are placed with.
  const first = added.sort((a, b) => a.top - b.top)[0]!
  expect(first.top).toBeGreaterThan(seen.lineTop / 8 - 4)
  expect(first.top).toBeLessThan(seen.lineTop / 8 + 4)

  await page.locator('.diff button[aria-label="Close"]').click()
  git('checkout', '-q', '--', 'Preview.md')
})

test('the two columns can be dragged, and the split is remembered', async () => {
  writeFileSync(join(vault, 'Preview.md'), '# rewritten\n\nwith a couple of lines\n')
  await openPanel()
  await refresh()
  await openDiff('Preview.md')

  const widths = (): Promise<number[]> =>
    page
      .locator('.diff__pane')
      .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().width))
  const drag = async (dx: number): Promise<void> => {
    const grip = (await page.locator('.diff .pane-divider').boundingBox())!
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2)
    await page.mouse.down()
    await page.mouse.move(grip.x + grip.width / 2 + dx, grip.y + grip.height / 2, { steps: 10 })
    await page.mouse.up()
  }

  const [oldLeft, oldRight] = await widths()
  // Equal columns to start with, which is what a diff opens as.
  expect(Math.abs(oldLeft! - oldRight!)).toBeLessThan(3)

  await drag(180)
  const [wideLeft, narrowRight] = await widths()
  expect(wideLeft! - oldLeft!).toBeGreaterThan(160)
  expect(oldRight! - narrowRight!).toBeGreaterThan(160)
  // The pair keeps the space between them: the panes do not grow past their box.
  expect(wideLeft! + narrowRight!).toBeCloseTo(oldLeft! + oldRight!, 0)

  // Dragging past the other column stops rather than squeezing it away, so a
  // column can always be found again.
  await drag(-4000)
  const [tinyLeft, hugeRight] = await widths()
  expect(tinyLeft!).toBeGreaterThan((tinyLeft! + hugeRight!) * 0.1)
  expect(tinyLeft!).toBeLessThan((tinyLeft! + hugeRight!) * 0.2)

  // The header stays over the column it names.
  const label = (await page.locator('.diff__head').first().boundingBox())!
  expect(Math.abs(label.width - tinyLeft!)).toBeLessThan(3)

  await page.locator('.diff .pane-divider').dblclick()
  const [evenLeft, evenRight] = await widths()
  expect(Math.abs(evenLeft! - evenRight!)).toBeLessThan(3)

  // A share is a way of looking at a diff rather than a property of one, so it
  // outlives the tab it was chosen in.
  await drag(-120)
  const chosen = (await widths())[0]!
  await page.locator('.diff button[aria-label="Close"]').click()
  await openDiff('Preview.md')
  expect((await widths())[0]!).toBeCloseTo(chosen, 0)

  // And the keyboard moves it too, for anyone not using a mouse.
  await page.locator('.diff .pane-divider').focus()
  await page.keyboard.press('ArrowRight')
  await expect.poll(async () => (await widths())[0]!).toBeGreaterThan(chosen + 5)

  await page.locator('.diff .pane-divider').dblclick()
  await page.locator('.diff button[aria-label="Close"]').click()
  git('checkout', '-q', '--', 'Preview.md')
})

/**
 * How much each file changed, beside its name.
 *
 * The three cases are three different sources: git's numstat for a tracked
 * edit, the same for something already staged, and a count this app does
 * itself for a file git will not diff because it has never seen it.
 */
test('every changed file says how much it changed', async () => {
  await openPanel()
  // Twelve lines in, two of them replaced by six: +6 -2, worked out by hand so
  // the assertion is a fact about the file rather than about whatever git said.
  const before = Array.from({ length: 12 }, (_, i) => `line ${i}`).join('\n') + '\n'
  writeFileSync(join(vault, 'Counted.md'), before)
  // Its own file rather than the shared `Index.md`: other tests commit to that
  // one, so what HEAD holds by the time this runs depends on the order the
  // file ran in, and the count would be asserted against a moving baseline.
  writeFileSync(join(vault, 'Stagedcount.md'), 'alpha\nbeta\n')
  git('add', 'Counted.md', 'Stagedcount.md')
  git('commit', '-m', 'counted')

  const after =
    Array.from({ length: 10 }, (_, i) => `line ${i}`).join('\n') +
    '\n' +
    Array.from({ length: 6 }, (_, i) => `added ${i}`).join('\n') +
    '\n'
  writeFileSync(join(vault, 'Counted.md'), after)
  // A file git has never seen: numstat says nothing about it, and every one of
  // its four lines is an addition.
  writeFileSync(join(vault, 'Newborn.md'), 'a\nb\nc\nd\n')
  // And one already in the index, to prove the staged side is counted too.
  writeFileSync(join(vault, 'Stagedcount.md'), 'alpha\nbeta\ngamma\ndelta\n')
  git('add', 'Stagedcount.md')
  await refresh()
  await page.waitForTimeout(600)

  const row = (name: string) =>
    page.locator('.scm-row').filter({ has: page.getByText(name, { exact: true }) })

  await expect(row('Counted.md').locator('.scm-count__add')).toHaveText('+6')
  await expect(row('Counted.md').locator('.scm-count__del')).toHaveText('-2')

  await expect(row('Newborn.md').locator('.scm-count__add')).toHaveText('+4')
  // Nothing was removed from a file that did not exist, so no count is drawn
  // rather than a "-0" that would read as a deletion of nothing.
  await expect(row('Newborn.md').locator('.scm-count__del')).toHaveCount(0)

  await expect(row('Stagedcount.md').locator('.scm-count__add')).toHaveText('+2')

  git('checkout', '-q', '--', 'Counted.md')
  git('reset', '-q', 'HEAD', 'Stagedcount.md')
  git('checkout', '-q', '--', 'Stagedcount.md')
  rmSync(join(vault, 'Newborn.md'), { force: true })
  await refresh()
})

test('a row names the file, and keeps the path for the hover', async () => {
  await openPanel()
  // A path repeated after the name it already contains is noise in a narrow
  // panel; it stays reachable on the row's title instead.
  mkdirSync(join(vault, 'deep'), { recursive: true })
  writeFileSync(join(vault, 'deep', 'Buried.md'), 'changed\n')
  await refresh()
  await page.waitForTimeout(400)

  const row = page.locator('.scm-row').filter({ has: page.getByText('Buried.md', { exact: true }) })
  await expect(row.locator('.scm-row__file')).toHaveText('Buried.md')
  await expect(row).toHaveAttribute('title', 'deep/Buried.md')
  // The directory is not printed on the row itself, in either view mode.
  await expect(row).not.toContainText('deep/')

  await page.locator('button[aria-label="View as tree"]').click()
  await page.waitForTimeout(300)
  const nested = page
    .locator('.scm-row')
    .filter({ has: page.getByText('Buried.md', { exact: true }) })
  await expect(nested.locator('.scm-row__file')).toHaveText('Buried.md')
  await page.locator('button[aria-label="View as list"]').click()

  rmSync(join(vault, 'deep', 'Buried.md'), { force: true })
  await refresh()
})
