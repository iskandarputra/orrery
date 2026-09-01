import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { closeCleanly, launchApp, openVault } from './helpers'

let app: ElectronApplication
let page: Page
let vault: string

async function runCommand(commandId: string): Promise<void> {
  await app.evaluate(({ BrowserWindow }, id) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('menu:command', { commandId: id })
  }, commandId)
}

test.beforeAll(async () => {
  vault = mkdtempSync(join(tmpdir(), 'orrery-canvas-'))
  // A small cluster, so the seeded board has something real to lay out.
  writeFileSync(join(vault, 'Rust.md'), '# Rust\n\nSee [[Ownership]] and [[Cargo]].\n')
  writeFileSync(join(vault, 'Ownership.md'), '# Ownership\n\nPart of [[Rust]].\n')
  writeFileSync(join(vault, 'Cargo.md'), '# Cargo\n\nBuilds [[Rust]].\n')
  // A hand-written board, including one deliberately broken node.
  writeFileSync(
    join(vault, 'Board.canvas'),
    JSON.stringify({
      nodes: [
        {
          id: 'a',
          type: 'text',
          text: '# First card\n\nWith **bold** text.',
          x: 0,
          y: 0,
          width: 260,
          height: 120
        },
        { id: 'b', type: 'file', file: 'Rust.md', x: 400, y: 0, width: 260, height: 120 },
        { id: 'broken', x: 0, y: 0 }
      ],
      edges: [{ id: 'e1', fromNode: 'a', toNode: 'b' }]
    })
  )

  writeFileSync(
    join(vault, 'Grouped.canvas'),
    JSON.stringify({
      nodes: [
        { id: 'g', type: 'group', label: 'Reading', x: 0, y: 0, width: 600, height: 400 },
        { id: 'in', type: 'text', text: 'inside the group', x: 60, y: 80, width: 240, height: 120 },
        { id: 'out', type: 'text', text: 'outside', x: 800, y: 80, width: 240, height: 120 }
      ],
      edges: []
    })
  )

  app = await launchApp()
  page = await app.firstWindow()
  await page.waitForSelector('.app', { timeout: 30_000 })
  await openVault(page, vault, 'Board.canvas')
})

test.afterAll(async () => {
  await closeCleanly(app, page)
  rmSync(vault, { recursive: true, force: true })
})

test('a .canvas file opens as a board, not as text', async () => {
  await page.locator('.tree-row--file', { hasText: 'Board.canvas' }).click()
  await page.waitForSelector('.canvas')

  // The markdown editor is hidden, the board is showing.
  await expect(page.locator('.editor-pane')).toBeHidden()
  // The malformed third node was dropped; the two valid ones render.
  await expect(page.locator('.canvas__card')).toHaveCount(2)
  await expect(page.locator('.canvas__card', { hasText: 'First card' })).toBeVisible()
  await expect(page.locator('.canvas__card', { hasText: 'Rust' })).toBeVisible()
  await expect(page.locator('.canvas__edge')).toHaveCount(1)
})

test('moving a card writes the board back to disk, and one gesture is one undo', async () => {
  const target = join(vault, 'Board.canvas')
  const card = page.locator('.canvas__card', { hasText: 'First card' })
  const before = (await card.boundingBox())!

  await page.mouse.move(before.x + 60, before.y + 20)
  await page.mouse.down()
  await page.mouse.move(before.x + 260, before.y + 140, { steps: 8 })
  await page.mouse.up()
  await expect(page.locator('.tab__close--dirty')).toBeVisible()

  // Screen coordinates, not board ones: the view is panned and zoomed, so the
  // only safe check is movement relative to where the card started.
  const dragged = (await card.boundingBox())!
  expect(dragged.x - before.x).toBeGreaterThan(120)

  await runCommand('file.save')
  await expect(page.locator('.tab__close--dirty')).toBeHidden()

  const written = JSON.parse(readFileSync(target, 'utf-8')) as {
    nodes: { id: string; x: number; y: number }[]
  }
  expect(written.nodes.find((n) => n.id === 'a')!.x).toBeGreaterThan(100)
  // The malformed node is gone for good once the board is written back.
  expect(written.nodes).toHaveLength(2)

  // A single undo returns the card to where the drag started.
  await page.keyboard.press('Control+z')
  await expect
    .poll(async () => Math.round((await card.boundingBox())!.x))
    .toBe(Math.round(before.x))
})

test('double-clicking empty space adds a card', async () => {
  await page.waitForSelector('.canvas__surface')
  const before = await page.locator('.canvas__card').count()
  const surface = (await page.locator('.canvas__surface').boundingBox())!
  await page.mouse.dblclick(surface.x + surface.width - 140, surface.y + surface.height - 140)

  await expect(page.locator('.canvas__card')).toHaveCount(before + 1)
  await expect(page.locator('.canvas__card-input')).toBeFocused()
  await page.keyboard.type('typed on the board')
  await page.locator('.canvas__surface').click({ position: { x: 20, y: 20 } })
  await expect(page.locator('.canvas__card', { hasText: 'typed on the board' })).toBeVisible()
})

test('seeds a board from the note cluster', async () => {
  await page.locator('.tree-row--file', { hasText: 'Rust.md' }).click()
  await expect(page.locator('.tab--active .tab__label')).toHaveText('Rust.md')

  await runCommand('canvas.fromCluster')
  await page.waitForSelector('.canvas')

  const fixtures = new Set(['Board.canvas', 'Grouped.canvas'])
  const created = readdirSync(vault).filter((f) => f.endsWith('.canvas') && !fixtures.has(f))
  expect(created).toHaveLength(1)
  const board = JSON.parse(readFileSync(join(vault, created[0]!), 'utf-8')) as {
    nodes: { type: string; file?: string }[]
    edges: unknown[]
  }
  // Every note of the cluster, wired with the links that already existed.
  expect(board.nodes).toHaveLength(3)
  expect(board.nodes.every((n) => n.type === 'file')).toBe(true)
  expect(board.edges.length).toBeGreaterThan(0)
  await expect(page.locator('.canvas__card')).toHaveCount(3)
})

test('a new blank canvas opens ready to use', async () => {
  await runCommand('canvas.new')
  await page.waitForSelector('.canvas__empty')
  expect(existsSync(join(vault, 'Canvas.canvas'))).toBe(true)
  await expect(page.locator('.canvas__card')).toHaveCount(0)
})

test('a marquee selects several cards, and delete removes them together', async () => {
  await page.locator('.tree-row--file', { hasText: 'Board.canvas' }).click()
  await page.waitForSelector('.canvas__card')
  const total = await page.locator('.canvas__card').count()
  const surface = (await page.locator('.canvas__surface').boundingBox())!

  // Drag a box across the whole board.
  await page.mouse.move(surface.x + 8, surface.y + 8)
  await page.mouse.down()
  await page.mouse.move(surface.x + surface.width - 8, surface.y + surface.height - 8, {
    steps: 10
  })
  await page.mouse.up()
  await expect(page.locator('.canvas__card--selected')).toHaveCount(total)

  await page.keyboard.press('Delete')
  await expect(page.locator('.canvas__card')).toHaveCount(0)
  await page.keyboard.press('Control+z')
  await expect(page.locator('.canvas__card')).toHaveCount(total)
})

test('dragging a group carries the cards inside it, and leaves the rest', async () => {
  await page.locator('.tree-row--file', { hasText: 'Grouped.canvas' }).click()
  await page.waitForSelector('.canvas__card--group')

  const inside = page.locator('.canvas__card', { hasText: 'inside the group' })
  const outside = page.locator('.canvas__card', { hasText: 'outside' })
  const group = page.locator('.canvas__card--group')
  const beforeIn = (await inside.boundingBox())!
  const beforeOut = (await outside.boundingBox())!
  const groupBox = (await group.boundingBox())!

  // Grab the group by its top edge, clear of the card it frames.
  await page.mouse.move(groupBox.x + groupBox.width / 2, groupBox.y + 4)
  await page.mouse.down()
  await page.mouse.move(groupBox.x + groupBox.width / 2, groupBox.y + 124, { steps: 8 })
  await page.mouse.up()

  const afterIn = (await inside.boundingBox())!
  const afterOut = (await outside.boundingBox())!
  expect(Math.round(afterIn.y - beforeIn.y)).toBeGreaterThan(80)
  // A card outside the frame stays exactly where it was.
  expect(Math.round(afterOut.y - beforeOut.y)).toBe(0)
})

test('text cards render their markdown', async () => {
  await page.locator('.tree-row--file', { hasText: 'Board.canvas' }).click()
  await page.waitForSelector('.canvas__card')

  const card = page.locator('.canvas__card', { hasText: 'First card' })
  // Rendered, not raw: the heading marker and asterisks are concealed.
  await expect(card.locator('.cm-or-h1')).toBeVisible()
  await expect(card).not.toContainText('**')
  await expect(card).not.toContainText('# First card')

  // Double-clicking still edits the underlying markdown, markers and all.
  await card.dblclick()
  await expect(page.locator('.canvas__card-input')).toHaveValue(
    '# First card\n\nWith **bold** text.'
  )
  await page.keyboard.press('Escape')
})
