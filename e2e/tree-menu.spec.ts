import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { closeCleanly, launchApp, openVault } from './helpers'

/**
 * The file tree's context menu, as VS Code's explorer has taught everyone to
 * expect it: open a terminal or a search in a folder, cut, copy and paste,
 * and copy a path relative to the vault.
 */
let app: ElectronApplication
let page: Page
let vault: string

const dirRow = (name: string) => page.locator('.tree-row--dir', { hasText: name }).first()
const fileRow = (name: string) => page.locator('.tree-row--file', { hasText: name }).first()
const menu = () => page.locator('.ctx-menu')
const item = (label: string) => menu().getByRole('menuitem', { name: label, exact: true })

/** What the terminal is showing, whitespace collapsed. */
const screen = async (): Promise<string> =>
  (await page.locator('.term-panel__host').textContent())?.replace(/\s+/g, ' ') ?? ''

/** Run a command in the terminal and wait for a marker it prints. */
async function runInTerminal(command: string, marker: string): Promise<void> {
  await page.locator('.term-panel__host').click()
  await page.keyboard.type(command)
  await page.keyboard.press('Enter')
  await expect.poll(screen, { timeout: 20_000 }).toContain(marker)
}

test.beforeAll(async () => {
  vault = mkdtempSync(join(tmpdir(), 'orrery-tree-menu-'))
  mkdirSync(join(vault, 'deep'))
  mkdirSync(join(vault, 'dest'))
  writeFileSync(join(vault, 'Index.md'), '# Index\n')
  writeFileSync(join(vault, 'top.md'), 'a needle at the top\n')
  writeFileSync(join(vault, 'deep', 'inside.md'), 'a needle inside\n')
  writeFileSync(join(vault, 'note.md'), 'the original\n')
  writeFileSync(join(vault, 'move-me.md'), 'moving\n')
  writeFileSync(join(vault, 'clash.md'), 'root clash\n')
  writeFileSync(join(vault, 'dest', 'clash.md'), 'dest clash\n')

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

test('a folder offers what the explorer in VS Code does, in that order', async () => {
  await dirRow('deep').click({ button: 'right' })
  await expect(menu()).toBeVisible()
  const labels = await menu().getByRole('menuitem').allTextContents()
  expect(labels.map((l) => l.trim())).toEqual([
    'New File',
    'New Folder',
    'Reveal in File Manager',
    'Open in Integrated Terminal',
    'Find in Folder…',
    'Cut',
    'Copy',
    'Paste',
    'Copy Path',
    'Copy Relative Path',
    'Rename',
    'Delete'
  ])
  // Nothing cut or copied yet.
  await expect(item('Paste')).toBeDisabled()
  await page.keyboard.press('Escape')
})

test('Copy Relative Path gives the path from the vault', async () => {
  await dirRow('deep').click()
  await fileRow('inside.md').click({ button: 'right' })
  await item('Copy Relative Path').click()
  const copied = await app.evaluate(({ clipboard }) => clipboard.readText())
  expect(copied).toBe('deep/inside.md')
  await dirRow('deep').click()
})

test('Find in Folder searches that folder and nothing beside it', async () => {
  await dirRow('deep').click({ button: 'right' })
  await item('Find in Folder…').click()
  const include = page.locator('.gsearch__filter-input').first()
  await expect(include).toHaveValue('deep/**', { timeout: 10_000 })
  // Ready for the query without a click.
  await expect(page.locator('.gsearch__input')).toBeFocused()
  await page.keyboard.type('needle')
  await page.keyboard.press('Enter')
  const results = page.locator('.gsearch')
  await expect(results).toContainText('inside.md', { timeout: 15_000 })
  await expect(results).not.toContainText('top.md')
})

test('Open in Integrated Terminal starts the shell in that folder', async () => {
  await dirRow('deep').click({ button: 'right' })
  await item('Open in Integrated Terminal').click()
  await expect(page.locator('.term-panel')).toBeVisible({ timeout: 15_000 })
  await runInTerminal('pwd; echo marker-one', 'marker-one')
  expect(await screen()).toContain(join(vault, 'deep'))
})

test('a shell running something is not replaced without asking', async () => {
  await runInTerminal('echo started-sleep; sleep 30', 'started-sleep')

  // Declined: the running command is left alone.
  const asked: string[] = []
  page.once('dialog', (dialog) => {
    asked.push(dialog.message())
    void dialog.dismiss()
  })
  await dirRow('dest').click({ button: 'right' })
  await item('Open in Integrated Terminal').click()
  await expect.poll(() => asked.length, { timeout: 10_000 }).toBe(1)
  expect(asked[0]).toContain('still running')
  // Interrupted by hand, and still in the folder it was in.
  await page.locator('.term-panel__host').click()
  await page.keyboard.press('Control+C')
  await runInTerminal('pwd; echo marker-two', 'marker-two')
  expect(await screen()).toContain(join(vault, 'deep'))

  // Idle at its prompt now, so a new folder needs no question.
  let questioned = false
  page.once('dialog', (dialog) => {
    questioned = true
    void dialog.dismiss()
  })
  await dirRow('dest').click({ button: 'right' })
  await item('Open in Integrated Terminal').click()
  await expect.poll(screen, { timeout: 20_000 }).not.toContain('marker-two')
  await runInTerminal('pwd; echo marker-three', 'marker-three')
  expect(await screen()).toContain(join(vault, 'dest'))
  expect(questioned).toBe(false)
  page.removeAllListeners('dialog')
})

test('cut and paste moves a file, and its open tab goes with it', async () => {
  await fileRow('move-me.md').click()
  await expect(page.locator('.tab--active')).toContainText('move-me', { timeout: 15_000 })
  await fileRow('move-me.md').click({ button: 'right' })
  await item('Cut').click()
  await dirRow('dest').click({ button: 'right' })
  await item('Paste').click()

  await expect
    .poll(() => existsSync(join(vault, 'dest', 'move-me.md')), { timeout: 10_000 })
    .toBe(true)
  expect(existsSync(join(vault, 'move-me.md'))).toBe(false)

  // The tab now belongs to the new place: a save writes there.
  await page.locator('.cm-content').first().click()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.type('\nsaved after the move')
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('menu:command', { commandId: 'file.save' })
  })
  await expect
    .poll(() => readFileSync(join(vault, 'dest', 'move-me.md'), 'utf-8'), { timeout: 10_000 })
    .toContain('saved after the move')
  expect(existsSync(join(vault, 'move-me.md'))).toBe(false)

  // A cut is used up by pasting it.
  await dirRow('deep').click({ button: 'right' })
  await expect(item('Paste')).toBeDisabled()
  await page.keyboard.press('Escape')
})

test('copy and paste twice makes two copies and never touches the original', async () => {
  await fileRow('note.md').click({ button: 'right' })
  await item('Copy').click()
  // Into the top of the vault, through the empty space under the last row: the
  // vault's own menu, not a row's, which would paste there too.
  const scroll = (await page.locator('.sidebar__scroll').boundingBox())!
  const lastRow = (await page.locator('.file-tree .tree-row').last().boundingBox())!
  // Clear of the scroll area's own bottom padding, which is not the tree's.
  const below = { x: scroll.x + scroll.width / 2, y: scroll.y + scroll.height - 30 }
  expect(below.y).toBeGreaterThan(lastRow.y + lastRow.height)
  const pasteIntoVault = async (): Promise<void> => {
    await page.mouse.click(below.x, below.y, { button: 'right' })
    await expect(item('New Folder')).toBeVisible()
    await expect(item('Rename')).toHaveCount(0)
    await item('Paste').click()
  }
  await pasteIntoVault()
  await expect.poll(() => existsSync(join(vault, 'note copy.md')), { timeout: 10_000 }).toBe(true)
  await pasteIntoVault()
  await expect.poll(() => existsSync(join(vault, 'note copy 2.md')), { timeout: 10_000 }).toBe(true)
  expect(readFileSync(join(vault, 'note.md'), 'utf-8')).toBe('the original\n')
  expect(readFileSync(join(vault, 'note copy 2.md'), 'utf-8')).toBe('the original\n')
})

test('a move onto a name already there is refused, and says so', async () => {
  await fileRow('clash.md').click({ button: 'right' })
  await item('Cut').click()
  await dirRow('dest').click({ button: 'right' })
  await item('Paste').click()
  await expect(page.locator('.toast__message')).toContainText('already in that folder', {
    timeout: 10_000
  })
  expect(readFileSync(join(vault, 'clash.md'), 'utf-8')).toBe('root clash\n')
  expect(readFileSync(join(vault, 'dest', 'clash.md'), 'utf-8')).toBe('dest clash\n')
})
