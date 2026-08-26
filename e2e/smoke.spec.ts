import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  test,
  expect,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { launchApp, openVault } from './helpers'

let app: ElectronApplication
let page: Page
let vault: string

/**
 * Native menu accelerators aren't fired by Playwright's synthetic key events,
 * so menu-dispatched actions are driven through the exact same channel the
 * native menu uses: the `menu:command` IPC event → renderer command registry.
 * This is a faithful e2e of the command system, not a shortcut around it.
 */
async function runCommand(commandId: string): Promise<void> {
  await app.evaluate(({ BrowserWindow }, id) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('menu:command', { commandId: id })
  }, commandId)
}

test.beforeAll(async () => {
  vault = mkdtempSync(join(tmpdir(), 'zymd-e2e-'))
  writeFileSync(
    join(vault, 'Home.md'),
    '# Home\n\nWelcome. Link to [[Ideas]] and some **bold** text.\n\n| A | B |\n| - | - |\n| 1 | 2 |\n'
  )
  writeFileSync(join(vault, 'Ideas.md'), '# Ideas\n\nBack to [[Home]].\n')
  // 64×64 red PNG for the inline-image test.
  const redPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAK0lEQVR4nO3BMQEAAADCoPVPbQ0PoAAAAAAAAAAAAAAAAAAAAAAAAAB4GxAAAAHmVwZ/AAAAAElFTkSuQmCC',
    'base64'
  )
  writeFileSync(join(vault, 'pic.png'), redPng)
  writeFileSync(
    join(vault, 'Media.md'),
    '# Media\n\nInline image: ![red](pic.png)\n\nParagraph two.\n\nParagraph three.\n'
  )
  writeFileSync(
    join(vault, 'Reflow.md'),
    '# Reflow\n\nThis paragraph is hard\nwrapped over three\nsource lines.\n'
  )

  app = await launchApp()
  page = await app.firstWindow()
  await page.waitForSelector('.app', { timeout: 30_000 })

  await openVault(page, vault, 'Home.md')
})

test.afterAll(async () => {
  await app?.close()
  rmSync(vault, { recursive: true, force: true })
})

test('loads the workspace and lists notes', async () => {
  await expect(page.locator('.sidebar__title')).toHaveText(/e2e/i)
  await expect(page.locator('.tree-row--file', { hasText: 'Home.md' })).toBeVisible()
})

test('opens a note and renders live preview', async () => {
  await page.locator('.tree-row--file', { hasText: 'Home.md' }).click()
  await expect(page.locator('.cm-content')).toContainText('Home')
  await expect(page.locator('.cm-zy-h1').first()).toBeVisible()
  await expect(page.locator('.cm-zy-wikilink', { hasText: 'Ideas' })).toBeVisible()
  await expect(page.locator('.cm-zy-table table')).toBeVisible()
})

test('edits and saves to disk', async () => {
  await page.locator('.tree-row--file', { hasText: 'Home.md' }).click()
  await page.locator('.cm-content').click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type('\n\nAdded by e2e.')
  await expect(page.locator('.tab__close--dirty')).toBeVisible()
  await runCommand('file.save')
  await expect(page.locator('.tab__close--dirty')).toBeHidden()
  expect(readFileSync(join(vault, 'Home.md'), 'utf-8')).toContain('Added by e2e.')
})

test('a new note opens in the pane and takes the caret', async () => {
  await page.locator('.tree-row--file', { hasText: 'Home.md' }).click()
  const before = await page.locator('.tab').count()

  await page.locator('.tab-bar__new-btn').click()
  await expect(page.locator('.tab')).toHaveCount(before + 1)

  // `activeId` mirrors the focused pane's buffer. Setting one without the
  // other showed the new tab while the pane kept the old note — so the note
  // looked open, took no focus, and swallowed everything typed into it.
  await expect(page.locator('.editor-pane-host .cm-content').first()).toHaveText('')
  await expect(page.locator('.cm-editor.cm-focused')).toBeVisible()

  await page.keyboard.type('straight into the new note')
  await expect(page.locator('.editor-pane-host .cm-content').first()).toHaveText(
    'straight into the new note'
  )

  // Leave the suite on a saved, known note.
  await page.locator('.tab--active .tab__close').click()
  await page.locator('.tree-row--file', { hasText: 'Home.md' }).click()
})

test('quick-open switches notes', async () => {
  await runCommand('app.quickOpen')
  await expect(page.locator('.palette')).toBeVisible()
  await page.locator('.palette__input').fill('ide')
  await page.keyboard.press('Enter')
  await expect(page.locator('.tab--active .tab__label')).toHaveText('Ideas.md')
})

test('command palette runs a command', async () => {
  await runCommand('app.commandPalette')
  await expect(page.locator('.palette')).toBeVisible()
  await page.locator('.palette__input').fill('graph')
  await page.keyboard.press('Enter')
  await expect(page.locator('.graph')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('.graph')).toBeHidden()
})

test('backlinks panel finds references', async () => {
  // Make Ideas.md active; Home.md links to it.
  await page.locator('.tree-row--file', { hasText: 'Ideas.md' }).click()
  await runCommand('view.toggleBacklinks')
  await expect(page.locator('.rpanel')).toBeVisible()
  await expect(page.locator('.result-group__file', { hasText: 'Home.md' })).toBeVisible()
})

test('renders a local inline image via the asset protocol', async () => {
  await page.locator('.tree-row--file', { hasText: 'Media.md' }).click()
  const img = page.locator('.cm-zy-image img')
  await expect(img).toBeVisible()
  // The asset actually decoded (not a broken image).
  await expect
    .poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth))
    .toBeGreaterThan(0)
})

test('source mode shows raw markdown; toggling back restores rendering', async () => {
  await page.locator('.tree-row--file', { hasText: 'Home.md' }).click()
  await expect(page.locator('.cm-zy-table table')).toBeVisible()
  await runCommand('view.toggleSourceMode')
  await expect(page.locator('.cm-zy-table table')).toBeHidden()
  await expect(page.locator('.cm-content')).toContainText('| A | B |')
  await runCommand('view.toggleSourceMode')
  await expect(page.locator('.cm-zy-table table')).toBeVisible()
})

test('view modes: edit / hybrid / reading', async () => {
  await page.locator('.tree-row--file', { hasText: 'Home.md' }).click()
  // Hybrid (default) renders the table and is editable.
  await runCommand('view.modeHybrid')
  await expect(page.locator('.cm-zy-table table')).toBeVisible()
  await expect(page.locator('.cm-content')).toHaveAttribute('contenteditable', 'true')

  // Reading: still rendered, but read-only (not editable).
  await runCommand('view.modeReading')
  await expect(page.locator('.cm-zy-table table')).toBeVisible()
  await expect(page.locator('.cm-content')).toHaveAttribute('contenteditable', 'false')
  // Clicking in reading mode must NOT flip the table to source (static render).
  await page.locator('.cm-zy-table').click({ position: { x: 30, y: 15 } })
  await expect(page.locator('.cm-zy-table table')).toBeVisible()
  await expect(page.locator('.cm-zy-table-src')).toHaveCount(0)

  // Edit: raw markdown, editable again.
  await runCommand('view.modeEdit')
  await expect(page.locator('.cm-zy-table table')).toBeHidden()
  await expect(page.locator('.cm-content')).toContainText('| A | B |')
  await expect(page.locator('.cm-content')).toHaveAttribute('contenteditable', 'true')

  await runCommand('view.modeHybrid') // restore
  await expect(page.locator('.cm-zy-table table')).toBeVisible()
})

test('focus mode dims inactive lines', async () => {
  await page.locator('.tree-row--file', { hasText: 'Media.md' }).click()
  await page.locator('.cm-content').click()
  await runCommand('view.toggleFocusMode')
  await expect(page.locator('.cm-zy-dim').first()).toBeVisible()
  await runCommand('view.toggleFocusMode')
  await expect(page.locator('.cm-zy-dim')).toHaveCount(0)
})

test('reflow toggle applies and syncs across file switches', async () => {
  // Deterministic start (the app shares real userData settings): force reflow on.
  await page.evaluate(() =>
    window.zymd
      .invoke('settings:get', undefined)
      .then((s) =>
        window.zymd.invoke('settings:set', { markdown: { ...s.markdown, reflowParagraphs: true } })
      )
  )
  await page.reload()
  await page.waitForSelector('.sidebar__title')

  // Reflow.md's intro paragraph spans three source lines → two soft breaks.
  await page.locator('.tree-row--file', { hasText: 'Reflow.md' }).click()
  await expect(page.locator('.cm-zy-softbreak')).toHaveCount(2)

  // Toggle off while Reflow.md is active.
  await runCommand('view.toggleReflow')
  await expect(page.locator('.cm-zy-softbreak')).toHaveCount(0)

  // Switch away and back — the OFF setting must hold (proving the per-buffer
  // reconfigure applies current settings, not creation-time ones). This is the
  // exact "had to toggle again after changing file" bug, now covered.
  await page.locator('.tree-row--file', { hasText: 'Home.md' }).click()
  await page.locator('.tree-row--file', { hasText: 'Reflow.md' }).click()
  await expect(page.locator('.cm-zy-softbreak')).toHaveCount(0)

  await runCommand('view.toggleReflow') // restore
  await expect(page.locator('.cm-zy-softbreak')).toHaveCount(2)
})
