import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { closeCleanly, launchApp, openVault } from './helpers'

/**
 * Dragging in the file tree: a row onto a folder moves it, a selection moves
 * together, Ctrl copies, and a folder cannot be dropped inside itself.
 *
 * Each test works in a folder of its own. Files move about here, so a test that
 * leaned on the one before it would look for rows another test had taken away,
 * and Playwright starts a fresh app after any failure, which shuffles that
 * further.
 */
let app: ElectronApplication
let page: Page
let vault: string

const row = (rel: string) =>
  page.locator(`[id="tree-row-${encodeURIComponent(join(vault, ...rel.split('/')))}"]`)
const ctrl = { modifiers: ['ControlOrMeta' as const] }

/**
 * Give up on a drag without dropping anything.
 *
 * Escape before the button comes up, because letting go over a folder that
 * would take the drop is a drop. It also ends Chromium's drag session, which
 * otherwise reads every later mouse action as part of this drag and times the
 * next test out on a plain click.
 */
async function cancelDrag(): Promise<void> {
  await page.keyboard.press('Escape')
  await page.mouse.up()
}

/** Open a folder, if it is not open already. */
async function expand(rel: string): Promise<void> {
  if ((await row(rel).getAttribute('aria-expanded')) === 'true') return
  await row(rel).click()
  await expect(row(rel)).toHaveAttribute('aria-expanded', 'true')
}

/** The middle of a row, for moving the mouse there while a drag is in progress. */
async function centre(rel: string): Promise<{ x: number; y: number }> {
  const box = (await row(rel).boundingBox())!
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

/**
 * A drag held over a row, so the drop highlight and a modifier can be seen.
 * Playwright's dragTo does the whole gesture at once, which leaves nothing on
 * screen to look at. Plain mouse moves rather than hover(): with the button
 * down, hover's actionability checks never settle.
 */
async function dragOver(from: string, to: string): Promise<void> {
  const start = await centre(from)
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  const target = await centre(to)
  // Two moves: the first starts the drag, the second is the one the row sees.
  await page.mouse.move(target.x, target.y)
  await page.mouse.move(target.x, target.y + 1)
}

test.beforeAll(async () => {
  vault = mkdtempSync(join(tmpdir(), 'orrery-tree-drag-'))
  // One folder per test, so no test depends on where another left a file.
  for (const dir of ['move', 'refuse', 'many', 'onto', 'copy', 'root']) {
    mkdirSync(join(vault, dir))
    mkdirSync(join(vault, dir, 'from'))
    mkdirSync(join(vault, dir, 'to'))
    for (const name of ['one.md', 'two.md']) {
      writeFileSync(join(vault, dir, 'from', name), `${name}\n`)
    }
  }
  mkdirSync(join(vault, 'refuse', 'from', 'deep'))
  writeFileSync(join(vault, 'onto', 'to', 'sibling.md'), 'sibling\n')
  writeFileSync(join(vault, 'root', 'note.md'), 'note\n')
  // A row at the top level, for openVault to wait on.
  writeFileSync(join(vault, 'index.md'), 'index\n')

  app = await launchApp()
  page = await app.firstWindow()
  await page.setViewportSize({ width: 1300, height: 900 })
  await page.waitForSelector('.app', { timeout: 30_000 })
  await openVault(page, vault, 'index.md')
})

test.afterAll(async () => {
  await closeCleanly(app, page)
  rmSync(vault, { recursive: true, force: true })
})

test('a row dragged onto a folder moves into it', async () => {
  await expand('move')
  await expand('move/from')
  await row('move/from/one.md').dragTo(row('move/to'))

  await expect
    .poll(() => existsSync(join(vault, 'move', 'to', 'one.md')), { timeout: 10_000 })
    .toBe(true)
  expect(existsSync(join(vault, 'move', 'from', 'one.md'))).toBe(false)
  // Only the row dragged: the rest of the folder stayed.
  expect(readdirSync(join(vault, 'move', 'from'))).toEqual(['two.md'])
})

test('the folder under the pointer says whether it would take the drop', async () => {
  await expand('refuse')
  await expand('refuse/from')
  await dragOver('refuse/from/one.md', 'refuse/to')
  await expect(row('refuse/to')).toHaveClass(/tree-row--drop/)

  // Let go of the drag rather than completing it: nothing moves.
  await cancelDrag()
  expect(existsSync(join(vault, 'refuse', 'from', 'one.md'))).toBe(true)

  // A folder cannot go inside itself, so that row never lights up.
  await dragOver('refuse/from', 'refuse/from/deep')
  await expect(row('refuse/from/deep')).not.toHaveClass(/tree-row--drop/)
  await cancelDrag()
  expect(existsSync(join(vault, 'refuse', 'from', 'deep', 'from'))).toBe(false)
})

test('a selection moves together, whichever of it was dragged', async () => {
  await expand('many')
  await expand('many/from')
  await row('many/from/one.md').click()
  await row('many/from/two.md').click(ctrl)
  await row('many/from/two.md').dragTo(row('many/to'))

  await expect
    .poll(() => readdirSync(join(vault, 'many', 'to')).sort(), { timeout: 10_000 })
    .toEqual(['one.md', 'two.md'])
  expect(readdirSync(join(vault, 'many', 'from'))).toEqual([])
})

test('a drop on a file lands beside it, in the folder it is in', async () => {
  await expand('onto')
  await expand('onto/from')
  await expand('onto/to')
  await row('onto/from/one.md').dragTo(row('onto/to/sibling.md'))

  await expect
    .poll(() => readdirSync(join(vault, 'onto', 'to')).sort(), { timeout: 10_000 })
    .toEqual(['one.md', 'sibling.md'])
})

test('Ctrl copies instead of moving', async () => {
  await expand('copy')
  await expand('copy/from')
  await dragOver('copy/from/one.md', 'copy/to')
  await page.keyboard.down('ControlOrMeta')
  const target = await centre('copy/to')
  await page.mouse.move(target.x, target.y + 2)
  await page.mouse.up()
  await page.keyboard.up('ControlOrMeta')

  await expect
    .poll(() => existsSync(join(vault, 'copy', 'to', 'one.md')), { timeout: 10_000 })
    .toBe(true)
  // The original stayed where it was: that is what makes it a copy.
  expect(existsSync(join(vault, 'copy', 'from', 'one.md'))).toBe(true)
})

test('a drop on the space below the rows goes to the top of the vault', async () => {
  // Everything the tests before it opened, closed again: the space under the
  // last row is what this is about, and a tall tree leaves none in the window.
  await page.getByTitle('Collapse all folders').click()
  await expand('root')
  const tree = page.locator('.file-tree')
  // Just under the last row: the tree reaches the bottom of the sidebar, but
  // the far end of it can be scrolled out of the window.
  const last = (await page.locator('.file-tree [role="treeitem"]').last().boundingBox())!
  const start = await centre('root/note.md')
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  const empty = { x: last.x + last.width / 2, y: last.y + last.height + 10 }
  await page.mouse.move(empty.x, empty.y)
  await page.mouse.move(empty.x, empty.y - 1)
  await expect(tree).toHaveClass(/file-tree--drop/)
  await page.mouse.up()

  await expect.poll(() => existsSync(join(vault, 'note.md')), { timeout: 10_000 }).toBe(true)
  expect(existsSync(join(vault, 'root', 'note.md'))).toBe(false)
})

test('a row dragged onto the editor opens it, rather than landing in the note', async () => {
  // A note of its own to drop onto: with nothing open there is no editor, and
  // the drag would have nowhere to go.
  await row('index.md').click()
  await expect(page.locator('.tab--active')).toContainText('index', { timeout: 15_000 })
  await expect(page.locator('.cm-content')).toBeVisible()

  await expand('move')
  await expand('move/from')
  // Events rather than a real drag: Chromium's drag emulation drops this one
  // about once in four runs under load, and what is being tested is that the
  // row puts its paths on the drag and the editor reads them back.
  await page.evaluate(
    (id) => {
      const data = new DataTransfer()
      const source = document.getElementById(id)!
      const editor = document.querySelector('.cm-content')!
      const fire = (el: Element, type: string): void => {
        el.dispatchEvent(
          new DragEvent(type, { dataTransfer: data, bubbles: true, cancelable: true })
        )
      }
      fire(source, 'dragstart')
      fire(editor, 'dragover')
      fire(editor, 'drop')
    },
    `tree-row-${encodeURIComponent(join(vault, 'move', 'from', 'two.md'))}`
  )

  await expect(page.locator('.tab--active')).toContainText('two', { timeout: 15_000 })
  // index.md was dropped on, not written into: it still says what it said.
  expect(readFileSync(join(vault, 'index.md'), 'utf8')).toBe('index\n')
  expect(existsSync(join(vault, 'move', 'from', 'two.md'))).toBe(true)
})
