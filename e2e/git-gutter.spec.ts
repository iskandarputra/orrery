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

test.beforeAll(async () => {
  vault = mkdtempSync(join(tmpdir(), 'orrery-git-'))
  writeFileSync(join(vault, 'Note.md'), '# Note\n\nProse.\n')
  writeFileSync(join(vault, 'committed.ts'), ORIGINAL + '\n')
  writeFileSync(join(vault, 'loose.ts'), 'const loose = 1\n')
  writeFileSync(join(vault, 'anchor.ts'), ORIGINAL + '\n')
  writeFileSync(join(vault, 'reloaded.ts'), ORIGINAL + '\n')

  git(['init'], vault)
  git(['config', 'user.email', 'test@example.com'], vault)
  git(['config', 'user.name', 'Test'], vault)
  git(['add', 'committed.ts', 'anchor.ts', 'reloaded.ts', 'Note.md'], vault)
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
