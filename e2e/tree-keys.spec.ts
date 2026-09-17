import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { closeCleanly, launchApp, openVault } from './helpers'

/**
 * Selecting in the file tree, and the keys that act on a selection, as VS
 * Code's explorer has them: Ctrl and Shift to choose, the arrows to move,
 * Ctrl+X, Ctrl+C and Ctrl+V, Delete and F2.
 */
let app: ElectronApplication
let page: Page
let vault: string

const tree = () => page.locator('.file-tree')
/** A row by its path in the vault, not its label: copies share their names. */
const row = (rel: string) =>
  page.locator(`[id="tree-row-${encodeURIComponent(join(vault, ...rel.split('/')))}"]`)
const ctrl = { modifiers: ['ControlOrMeta' as const] }

/** The selected rows, as paths in the vault, in the order they are drawn. */
const selected = (): Promise<string[]> =>
  page.locator('.file-tree [role="treeitem"][aria-selected="true"]').evaluateAll(
    (els, root) =>
      els.map((el) =>
        decodeURIComponent(el.id.replace(/^tree-row-/, ''))
          .slice(root.length + 1)
          .replace(/\\/g, '/')
      ),
    vault
  )

test.beforeAll(async () => {
  vault = mkdtempSync(join(tmpdir(), 'orrery-tree-keys-'))
  for (const dir of ['alpha', 'beta', 'dest']) mkdirSync(join(vault, dir))
  writeFileSync(join(vault, 'alpha', 'a1.md'), 'a1\n')
  writeFileSync(join(vault, 'beta', 'b1.md'), 'b1\n')
  for (const name of ['one.md', 'two.md', 'three.md']) writeFileSync(join(vault, name), `${name}\n`)
  // Drawn after every other row, so the runs the tests above count are unchanged.
  const redPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAK0lEQVR4nO3BMQEAAADCoPVPbQ0PoAAAAAAAAAAAAAAAAAAAAAAAAAB4GxAAAAHmVwZ/AAAAAElFTkSuQmCC',
    'base64'
  )
  writeFileSync(join(vault, 'view.png'), redPng)
  writeFileSync(join(vault, 'view.md'), '# View\n\n![red](view.png)\n')

  app = await launchApp()
  page = await app.firstWindow()
  await page.setViewportSize({ width: 1300, height: 900 })
  await page.waitForSelector('.app', { timeout: 30_000 })
  await openVault(page, vault, 'one.md')
})

test.afterAll(async () => {
  await closeCleanly(app, page)
  rmSync(vault, { recursive: true, force: true })
})

test('a click selects one row, Ctrl adds and removes, Shift takes a run', async () => {
  await row('one.md').click()
  await expect(page.locator('.tab--active')).toContainText('one', { timeout: 15_000 })
  expect(await selected()).toEqual(['one.md'])

  // Chosen without being opened: the tab stays on one.md.
  await row('two.md').click(ctrl)
  expect(await selected()).toEqual(['one.md', 'two.md'])
  await expect(page.locator('.tab--active')).toContainText('one')
  await row('one.md').click(ctrl)
  expect(await selected()).toEqual(['two.md'])

  // Shift runs from the last row clicked, one.md, with or without Ctrl, as
  // VS Code's does, back up to beta: everything drawn in between.
  await row('beta').click({ modifiers: ['Shift'] })
  expect(await selected()).toEqual(['beta', 'dest', 'one.md'])
})

test('the arrows move through the rows, opening and closing folders', async () => {
  // A folder click gives the tree the keyboard without opening a file.
  await row('alpha').click()
  await expect(row('alpha/a1.md')).toBeVisible()
  await expect(tree()).toBeFocused()
  expect(await selected()).toEqual(['alpha'])

  await page.keyboard.press('ArrowDown')
  expect(await selected()).toEqual(['alpha/a1.md'])
  // Left from a file goes to its folder; Left again closes it.
  await page.keyboard.press('ArrowLeft')
  expect(await selected()).toEqual(['alpha'])
  await page.keyboard.press('ArrowLeft')
  await expect(row('alpha/a1.md')).toHaveCount(0)

  // Right opens a folder, and then steps into it.
  await page.keyboard.press('ArrowDown')
  expect(await selected()).toEqual(['beta'])
  await page.keyboard.press('ArrowRight')
  await expect(row('beta/b1.md')).toBeVisible()
  await page.keyboard.press('ArrowRight')
  expect(await selected()).toEqual(['beta/b1.md'])

  // Shift extends from where the keyboard started.
  await page.keyboard.press('Shift+ArrowDown')
  expect(await selected()).toEqual(['beta/b1.md', 'dest'])

  // Enter on a file opens it.
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  expect(await selected()).toEqual(['three.md'])
  await page.keyboard.press('Enter')
  await expect(page.locator('.tab--active')).toContainText('three', { timeout: 15_000 })
})

test('Ctrl+C and Ctrl+V copy the selection into the folder the keyboard is on', async () => {
  // A plain click first: Ctrl adds to whatever was selected before, and the
  // last test left three.md selected.
  await row('one.md').click()
  await row('two.md').click(ctrl)
  expect(await selected()).toEqual(['one.md', 'two.md'])
  await expect(tree()).toBeFocused()
  await page.keyboard.press('ControlOrMeta+c')

  await row('dest').click()
  await expect(tree()).toBeFocused()
  await page.keyboard.press('ControlOrMeta+v')
  await expect.poll(() => existsSync(join(vault, 'dest', 'two.md')), { timeout: 10_000 }).toBe(true)
  // Those two, and nothing else.
  expect(readdirSync(join(vault, 'dest')).sort()).toEqual(['one.md', 'two.md'])
  // A copy: the originals are where they were.
  expect(existsSync(join(vault, 'one.md'))).toBe(true)
})

test('Ctrl+X and Ctrl+V move them', async () => {
  // A plain click opens the file and gives the editor the keyboard; Tab, or
  // focusing the tree, is how the keyboard comes back to it.
  await row('three.md').click()
  await tree().focus()
  expect(await selected()).toEqual(['three.md'])
  await page.keyboard.press('ControlOrMeta+x')

  await row('alpha').click()
  await page.keyboard.press('ControlOrMeta+v')
  await expect
    .poll(() => existsSync(join(vault, 'alpha', 'three.md')), { timeout: 10_000 })
    .toBe(true)
  expect(existsSync(join(vault, 'three.md'))).toBe(false)
})

test('Delete asks once about everything selected', async () => {
  await row('one.md').click(ctrl)
  await page.keyboard.press('Escape')
  await row('one.md').click(ctrl)
  await row('two.md').click(ctrl)
  expect(await selected()).toEqual(['one.md', 'two.md'])

  // Declined, so nothing reaches the real trash of whoever runs this.
  const asked: string[] = []
  page.once('dialog', (dialog) => {
    asked.push(dialog.message())
    void dialog.dismiss()
  })
  await page.keyboard.press('Delete')
  await expect.poll(() => asked.length, { timeout: 10_000 }).toBe(1)
  expect(asked[0]).toBe('Move 2 items to trash?')
  expect(existsSync(join(vault, 'one.md'))).toBe(true)
  expect(existsSync(join(vault, 'two.md'))).toBe(true)
})

test('the context menu on a selection offers what applies to all of it', async () => {
  await row('one.md').click()
  await row('two.md').click(ctrl)
  expect(await selected()).toEqual(['one.md', 'two.md'])
  await row('two.md').click({ button: 'right' })
  const menu = page.locator('.ctx-menu')
  await expect(menu).toBeVisible()
  const labels = (await menu.getByRole('menuitem').allTextContents()).map((l) => l.trim())
  expect(labels).toEqual(['Cut', 'Copy', 'Copy Paths', 'Copy Relative Paths', 'Delete 2 Items'])
  await menu.getByRole('menuitem', { name: 'Copy Relative Paths', exact: true }).click()
  const copied = await app.evaluate(({ clipboard }) => clipboard.readText())
  expect(copied.split('\n').sort()).toEqual(['one.md', 'two.md'])

  // Escape closes a menu opened on the selection, and leaves the selection be.
  await row('two.md').click({ button: 'right' })
  await expect(menu).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
  expect(await selected()).toEqual(['one.md', 'two.md'])

  // A row outside the selection becomes the selection, with its own menu.
  await row('dest').click({ button: 'right' })
  expect(await selected()).toEqual(['dest'])
  await expect(menu.getByRole('menuitem', { name: 'Rename', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
})

test('F2 renames the row, and keys typed into the name stay in the name', async () => {
  await row('beta').click()
  await expect(tree()).toBeFocused()
  await page.keyboard.press('F2')
  const input = page.locator('.tree-newfile input')
  await expect(input).toBeVisible()
  await expect(input).toHaveValue('beta')

  // Delete and the arrows edit the text; they do not act on the tree.
  let asked = false
  page.once('dialog', (dialog) => {
    asked = true
    void dialog.dismiss()
  })
  await page.keyboard.press('End')
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('Delete')
  await expect(input).toHaveValue('bet')
  expect(asked).toBe(false)
  await page.keyboard.press('Escape')
  await expect(input).toHaveCount(0)
  page.removeAllListeners('dialog')
})

test('an overlay opened while the tree has the keyboard keeps its own keys', async () => {
  await row('view.md').click()
  await expect(page.locator('.cm-or-image img')).toBeVisible({ timeout: 15_000 })
  await row('dest').click()
  await expect(tree()).toBeFocused()

  // The expand button keeps focus where it was, which is the case that matters:
  // the viewer is open and the tree still holds the keyboard.
  await page.locator('.cm-or-image .cm-or-expand').click()
  const viewer = page.locator('.media-viewer__frame')
  await expect(viewer).toBeVisible()
  await expect(tree()).toBeFocused()

  // The arrows pan the image, not the selection behind it.
  await page.keyboard.press('ArrowDown')
  expect(await selected()).toEqual(['dest'])
  await page.keyboard.press('Escape')
  await expect(viewer).toBeHidden()
})

test('Ctrl+A selects every row drawn, and Escape clears the selection', async () => {
  await row('one.md').click()
  await tree().focus()
  await page.keyboard.press('ControlOrMeta+a')
  const drawn = await page.locator('.file-tree [role="treeitem"]').count()
  expect(drawn).toBeGreaterThan(5)
  expect(await selected()).toHaveLength(drawn)

  await page.keyboard.press('Escape')
  expect(await selected()).toEqual([])
})
