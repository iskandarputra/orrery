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
  await expect(page.locator('.scm__group-label').filter({ hasText: 'Changes' })).toBeVisible()
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
  await expect(page.locator('.scm__group-label').filter({ hasText: 'Changes' })).toBeVisible({
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
  await expect(diff.locator('.diff__cell--added')).toHaveCount(1)
  await expect(diff.locator('.diff__cell--added')).toContainText('an added line')
  await expect(diff.locator('.diff__stat--added')).toHaveText('+1')
  await expect(diff.locator('.diff__stat--removed')).toHaveText('-0')
  // Context lines carry both line numbers; an addition only carries the new one.
  await expect(diff.locator('.diff__cell--context').first()).toContainText('alpha')

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

  // Edit the right column in place, as VS Code lets you edit its right pane.
  const line = page.locator('.diff__cell--added .diff__text--editable').first()
  await expect(line).toBeVisible()
  await line.click()
  await page.keyboard.press('Control+a')
  await page.keyboard.type('rewritten from the diff')
  await page.keyboard.press('Enter')

  // The file on disk carries the edit...
  await expect
    .poll(() => readFileSync(join(vault, 'Editable.md'), 'utf-8'), { timeout: 10_000 })
    .toContain('rewritten from the diff')
  // ...and the diff re-reads itself to show it.
  await expect(page.locator('.diff__cell--added')).toContainText('rewritten from the diff')

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
  await expect(page.locator('.diff__text--editable')).toHaveCount(0)

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
  await expect(diff.locator('.diff__cell--removed')).toHaveCount(0)

  await page.locator('.diff button[aria-label="Close"]').click()
  rmSync(join(vault, 'Fresh.md'))
})

test('commit is refused without a message or staged work', async () => {
  await openPanel()
  await refresh()
  // Nothing staged: the button is disabled and so is the message box.
  await expect(page.locator('.scm__commit-btn')).toBeDisabled()
})
