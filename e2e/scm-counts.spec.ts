import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { closeCleanly, launchApp, openVault } from './helpers'

/**
 * How much has changed, said without opening anything.
 *
 * The Changes header gives the totals, lines and files, and the source control
 * icon carries the number of changed files the way VS Code's does. The icon is
 * the one that matters most here, because it is on screen while the panel is
 * not: the status it counts is read with the vault, not with the panel.
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

async function runCommand(commandId: string): Promise<void> {
  await app.evaluate(({ BrowserWindow }, id) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('menu:command', { commandId: id })
  }, commandId)
}

const icon = () =>
  page.locator(
    '.sidebar-rail__btn[data-tip^="Source Control"], .sidebar-rail__btn[data-tip^="Hide Source Control"]'
  )
const badge = () => icon().locator('.sidebar-rail__badge')
/** A section, by name rather than text: "Staged Changes" contains "Changes". */
const section = (id: 'staged' | 'changes' | 'graph') => page.locator(`[data-section="${id}"]`)
const summary = (id: 'staged' | 'changes') => section(id).locator('.scm__section .scm__summary')

test.beforeAll(async () => {
  vault = mkdtempSync(join(tmpdir(), 'orrery-scm-counts-'))
  mkdirSync(join(vault, 'deep', 'inner'), { recursive: true })
  writeFileSync(join(vault, 'Index.md'), '# Index\n')
  writeFileSync(join(vault, 'a.md'), 'one\ntwo\nthree\n')
  writeFileSync(join(vault, 'b.md'), 'one\ntwo\n')
  writeFileSync(join(vault, 'deep', 'inner', 'keep.md'), 'kept\n')
  git('init', '-q', '.')
  git('add', '.')
  git('commit', '-qm', 'base')

  // a.md: one line rewritten, unstaged.            +1 -1
  writeFileSync(join(vault, 'a.md'), 'one\nTWO\nthree\n')
  // b.md: two lines staged, then one more edit.   staged +2, unstaged +1
  writeFileSync(join(vault, 'b.md'), 'one\ntwo\nthree\nfour\n')
  git('add', 'b.md')
  writeFileSync(join(vault, 'b.md'), 'one\ntwo\nthree\nfour\nfive\n')
  // c.md: new and untracked.                       +4
  writeFileSync(join(vault, 'c.md'), '1\n2\n3\n4\n')

  app = await launchApp()
  page = await app.firstWindow()
  await page.waitForSelector('.app', { timeout: 30_000 })
  await openVault(page, vault, 'Index.md')
})

test.afterAll(async () => {
  await closeCleanly(app, page)
  rmSync(vault, { recursive: true, force: true })
})

test('the icon counts changed files with the file tree on screen', async () => {
  await expect(page.locator('.tree-row--file', { hasText: 'Index.md' })).toBeVisible()
  await expect(page.locator('.scm')).toHaveCount(0)
  // Three files, though b.md is listed twice in the panel, staged and not.
  await expect(badge()).toHaveText('3', { timeout: 15_000 })
  await expect(icon()).toHaveAttribute('aria-label', /\(3 changed files\)/)
})

test('each section header totals what its own rows add up to', async () => {
  await runCommand('view.toggleGit')
  // Staged: b.md's first edit, two lines.
  await expect(summary('staged')).toContainText('1 file', { timeout: 15_000 })
  await expect(summary('staged').locator('.scm-count__add')).toHaveText('+2', { timeout: 15_000 })
  await expect(summary('staged').locator('.scm-count__del')).toHaveCount(0)
  // Changes: a.md +1 -1, b.md's second edit +1, c.md +4.
  await expect(summary('changes')).toContainText('3 files')
  await expect(summary('changes').locator('.scm-count__add')).toHaveText('+6')
  await expect(summary('changes').locator('.scm-count__del')).toHaveText('-1')

  // Checked against each section's own column, not only against the arithmetic.
  const columns = await page.evaluate(() => {
    const sum = (id: string, sel: string): number =>
      Array.from(document.querySelectorAll(`[data-section="${id}"] .scm-row ${sel}`)).reduce(
        (n, el) => n + Math.abs(Number(el.textContent)),
        0
      )
    return {
      staged: [sum('staged', '.scm-count__add'), sum('staged', '.scm-count__del')],
      changes: [sum('changes', '.scm-count__add'), sum('changes', '.scm-count__del')]
    }
  })
  expect(columns).toEqual({ staged: [2, 0], changes: [6, 1] })

  // On the right of the header, just before the section's action, and still
  // there with the section closed.
  const placed = await page.evaluate(() => {
    const header = document.querySelector('[data-section="changes"] .scm__section')!
    const box = header.getBoundingClientRect()
    const totals = header.querySelector('.scm__summary')!.getBoundingClientRect()
    const action = header.querySelector('.scm__group-act')!.getBoundingClientRect()
    return { toAction: action.left - totals.right, toEdge: box.right - action.right }
  })
  expect(placed.toAction).toBeGreaterThanOrEqual(0)
  expect(placed.toAction).toBeLessThan(16)
  expect(placed.toEdge).toBeLessThan(16)

  // And in a sidebar this narrow, nothing in a header runs into anything else:
  // the title gives way, its chevron keeps its size.
  const crowded = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-section] > .scm__section')).flatMap((header) => {
      const id = header.parentElement!.getAttribute('data-section')
      const title = header.querySelector('.scm__section-title')!.getBoundingClientRect()
      const chevron = header.querySelector('.scm__section-toggle > svg')!.getBoundingClientRect()
      const next = header.querySelector('.scm__summary, .scm__group-act')?.getBoundingClientRect()
      const faults: string[] = []
      if (chevron.width < 10) faults.push(`${id} chevron ${chevron.width}px`)
      if (next && title.right > next.left + 0.5) faults.push(`${id} title overlaps what follows`)
      return faults
    })
  )
  expect(crowded).toEqual([])
  const toggle = section('changes').locator('.scm__section-toggle')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(summary('changes')).toContainText('3 files')
  await toggle.click()
})

test('staged changes are a section of their own, above changes, gone when nothing is staged', async () => {
  // In VS Code's order.
  const order = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.scm [data-section]')).map((el) =>
      el.getAttribute('data-section')
    )
  )
  expect(order).toEqual(['staged', 'changes', 'graph'])
  // Each holds its own side: b.md in both, the others only under Changes.
  await expect(section('staged').locator('.scm-row__file')).toHaveText(['b.md'])
  await expect(section('changes').locator('.scm-row__file')).toHaveText(['a.md', 'b.md', 'c.md'])

  // Closing one leaves the other open.
  const staged = section('staged').locator('.scm__section-toggle')
  await staged.click()
  await expect(section('staged').locator('.scm-row')).toHaveCount(0)
  await expect(section('changes').locator('.scm-row')).toHaveCount(3)
  await staged.click()

  // Unstage all, from the section's own header, and the section goes.
  await section('staged').locator('.scm__group-act', { hasText: 'Unstage all' }).click()
  await expect(section('staged')).toHaveCount(0, { timeout: 10_000 })
  await expect(section('changes').locator('.scm-row__file')).toHaveText(['a.md', 'b.md', 'c.md'])
})

test('the icon follows changes made outside the app without the panel open', async () => {
  // Back to the files, so nothing on screen is reading status for itself.
  await runCommand('view.toggleGit')
  await expect(page.locator('.scm')).toHaveCount(0)
  await expect(badge()).toHaveText('3', { timeout: 15_000 })

  // A commit in a terminal: a.md is done, b.md keeps its second edit.
  git('add', 'a.md')
  git('commit', '-qm', 'from a terminal')
  await expect(badge()).toHaveText('2', { timeout: 10_000 })

  // A file written by another program in a folder nothing watches, heard when
  // the window comes back.
  writeFileSync(join(vault, 'deep', 'inner', 'elsewhere.md'), 'x\n')
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(badge()).toHaveText('3', { timeout: 10_000 })

  // Everything committed: no count at all, not a zero.
  git('add', '-A')
  git('commit', '-qm', 'the rest')
  await expect(badge()).toHaveCount(0, { timeout: 10_000 })
  await expect(icon()).toHaveAttribute('aria-label', 'Source Control')
})
