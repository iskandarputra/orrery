import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  test,
  expect,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { closeCleanly, launchApp, openVault } from './helpers'

let app: ElectronApplication
let page: Page
let vault: string

const DOC = `# Title

first paragraph

- a list
- of items

\`\`\`ts
const fenced = true
\`\`\`

last paragraph
`

async function runCommand(commandId: string): Promise<void> {
  await app.evaluate(({ BrowserWindow }, id) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('menu:command', { commandId: id })
  }, commandId)
}

/** Put the caret inside the block whose text contains `needle`. */
async function caretIn(needle: string): Promise<void> {
  // Wait for the text before clicking: under load the note can still be
  // rendering, and the click then lands on whatever is there instead.
  const target = page.locator('.cm-content').getByText(needle, { exact: false }).first()
  await expect(target).toBeVisible({ timeout: 10_000 })
  await target.click()
  // Visible is not the same as ready: a click that lands while the editor is
  // still settling leaves the caret in the previous block, and the move then
  // silently moves the wrong thing — which the assertions read as the feature
  // being broken.
  await expect
    .poll(
      () => page.evaluate(() => document.querySelector('.cm-activeLine')?.textContent ?? ''),
      { timeout: 5_000 }
    )
    .toContain(needle)
}

async function saved(): Promise<string> {
  await runCommand('file.save')
  await expect(page.locator('.tab__close--dirty')).toBeHidden({ timeout: 10_000 })
  return readFileSync(join(vault, 'Note.md'), 'utf-8')
}

test.beforeAll(async () => {
  vault = mkdtempSync(join(tmpdir(), 'zymd-blocks-'))
  writeFileSync(join(vault, 'Note.md'), DOC)
  app = await launchApp()
  page = await app.firstWindow()
  await page.waitForSelector('.app', { timeout: 30_000 })
  await openVault(page, vault, 'Note.md')
  await page.locator('.tree-row--file', { hasText: 'Note.md' }).click()
  await page.waitForSelector('.cm-content')
})

test.afterAll(async () => {
  await closeCleanly(app, page)
  rmSync(vault, { recursive: true, force: true })
})

test('moves a paragraph past the block above it', async () => {
  await caretIn('first paragraph')
  await runCommand('block.moveUp')

  const text = await saved()
  expect(text.indexOf('first paragraph')).toBeLessThan(text.indexOf('# Title'))
  await runCommand('block.moveDown') // put it back
  await saved()
})

test('a list travels whole, not one line at a time', async () => {
  await caretIn('of items')
  await runCommand('block.moveUp')

  const text = await saved()
  // Both list lines moved together, above the paragraph.
  expect(text.indexOf('- a list')).toBeLessThan(text.indexOf('first paragraph'))
  expect(text.indexOf('- a list')).toBeLessThan(text.indexOf('- of items'))
  await runCommand('block.moveDown')
  await saved()
})

test('a fenced block travels whole', async () => {
  await caretIn('const fenced')
  await runCommand('block.moveDown')

  const text = await saved()
  const fence = text.indexOf('```ts')
  expect(fence).toBeGreaterThan(text.indexOf('last paragraph'))
  // The fence is still intact around its code.
  expect(text).toContain('```ts\nconst fenced = true\n```')
  await runCommand('block.moveUp')
  await saved()
})

test('refuses to move past the end, leaving the document alone', async () => {
  const before = readFileSync(join(vault, 'Note.md'), 'utf-8')
  // Live preview conceals the `#`, so the rendered text is just "Title".
  await caretIn('Title')
  await runCommand('block.moveUp')
  await page.waitForTimeout(300)
  await expect(page.locator('.tab__close--dirty')).toBeHidden()
  expect(readFileSync(join(vault, 'Note.md'), 'utf-8')).toBe(before)
})

test('dragging a block by its handle drops it elsewhere', async () => {
  const before = readFileSync(join(vault, 'Note.md'), 'utf-8')
  expect(before.indexOf('first paragraph')).toBeLessThan(before.indexOf('last paragraph'))

  const paragraph = page.locator('.cm-content').getByText('first paragraph').first()
  const paragraphBox = (await paragraph.boundingBox())!
  await paragraph.hover() // handles only appear once the editor is hovered

  // The gutter also renders a hidden spacer marker, so pick by geometry rather
  // than by index, skipping anything that isn't really on screen.
  const handleBox = await page.evaluate((y) => {
    const found = Array.from(document.querySelectorAll('.cm-zy-block-handle')).find((el) => {
      const rect = el.getBoundingClientRect()
      return getComputedStyle(el).visibility !== 'hidden' && Math.abs(rect.y - y) < 24
    })
    if (!found) return null
    const rect = found.getBoundingClientRect()
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
  }, paragraphBox.y)
  expect(handleBox, 'a handle beside the paragraph').not.toBeNull()

  const target = (await page.locator('.cm-content').getByText('last paragraph').first().boundingBox())!
  await page.mouse.move(handleBox!.x, handleBox!.y)
  await page.mouse.down()
  await page.mouse.move(target.x + 20, target.y + target.height - 2, { steps: 12 })
  await expect(page.locator('.cm-zy-drop-line')).toBeVisible()
  await page.mouse.up()

  const after = await saved()
  expect(after.indexOf('first paragraph')).toBeGreaterThan(after.indexOf('last paragraph'))
})
