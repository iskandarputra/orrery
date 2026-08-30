import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
  await page.locator('.scm-row__name').filter({ hasText: 'Preview.md' }).click()
  await expect(page.locator('.diff')).toBeVisible({ timeout: 10_000 })
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
