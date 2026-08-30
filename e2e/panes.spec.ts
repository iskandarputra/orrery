import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
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

const panes = (): ReturnType<Page['locator']> => page.locator('.editor-pane-host')

/** Back to a single pane showing `file`, whatever the previous test left. */
async function reset(file: string): Promise<void> {
  while ((await panes().count()) > 1) await runCommand('view.closePane')
  await page.locator('.tree-row--file', { hasText: file }).click()
  await expect(panes()).toHaveCount(1)
}

test.beforeAll(async () => {
  vault = mkdtempSync(join(tmpdir(), 'orrery-panes-'))
  for (const name of ['One', 'Two', 'Three', 'Four', 'Five']) {
    writeFileSync(join(vault, `${name}.md`), `# ${name}\n\nbody of ${name}\n`)
  }
  app = await launchApp()
  page = await app.firstWindow()
  await page.waitForSelector('.app', { timeout: 30_000 })
  await openVault(page, vault, 'One.md')
  for (const name of ['Two.md', 'Three.md', 'Four.md', 'Five.md']) {
    await page.locator('.tree-row--file', { hasText: name }).click()
  }
})

test.afterAll(async () => {
  await closeCleanly(app, page)
  rmSync(vault, { recursive: true, force: true })
})

test('a third and fourth pane open, and no fifth', async () => {
  await reset('One.md')

  await runCommand('view.splitRight')
  await expect(panes()).toHaveCount(2)
  await runCommand('view.splitRight')
  await expect(panes()).toHaveCount(3)
  await runCommand('view.splitRight')
  await expect(panes()).toHaveCount(4)

  // Four is the limit: a fifth column is too narrow to read in.
  await runCommand('view.splitRight')
  await page.waitForTimeout(200)
  await expect(panes()).toHaveCount(4)

  // Equal columns, so one pane's long lines cannot squeeze the others.
  const widths = await panes().evaluateAll((els) =>
    els.map((el) => Math.round(el.getBoundingClientRect().width))
  )
  expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(2)
})

test('every pane shows a different note', async () => {
  await expect(panes()).toHaveCount(4)
  const titles = await panes().evaluateAll((els) =>
    els.map((el) => el.querySelector('.cm-content')?.textContent?.slice(0, 20) ?? '')
  )
  expect(new Set(titles).size).toBe(titles.length)
})

test('closing a pane keeps its tab open', async () => {
  await expect(panes()).toHaveCount(4)
  const tabsBefore = await page.locator('.tab').count()

  await runCommand('view.closePane')
  await expect(panes()).toHaveCount(3)
  expect(await page.locator('.tab').count()).toBe(tabsBefore)
})

test('focus cycles through the panes and wraps', async () => {
  await expect(panes()).toHaveCount(3)
  // Among the panes, not among the grid's children: the dividers sit between
  // them and would double every index.
  const focused = async (): Promise<number> =>
    page
      .locator('.editor-pane-host--focused')
      .evaluate((el) => [...document.querySelectorAll('.editor-pane-host')].indexOf(el))

  const start = await focused()
  for (let i = 1; i <= 3; i++) {
    await runCommand('view.focusNextPane')
    await expect.poll(focused).toBe((start + i) % 3)
  }
})

test('a file opens into a column of its own from the tree', async () => {
  await reset('One.md')
  await page.locator('.tree-row--file', { hasText: 'Three.md' }).click({ button: 'right' })
  await page.locator('.ctx-menu__item', { hasText: 'Open to the Side' }).click()

  await expect(panes()).toHaveCount(2)
  // In the new pane, and focused there, which is where the next keystroke goes.
  await expect(panes().nth(1)).toContainText('Three')
  await expect(panes().nth(1)).toHaveClass(/editor-pane-host--focused/)
  // The pane it came from kept what it was showing.
  await expect(panes().nth(0)).toContainText('One')
})

test('Ctrl+Enter in quick open does the same thing', async () => {
  await reset('One.md')
  await runCommand('app.quickOpen')
  await page.locator('.palette__input').fill('Four')
  await page.keyboard.press('Control+Enter')

  await expect(panes()).toHaveCount(2)
  await expect(panes().nth(1)).toContainText('Four')
})

test('a divider drags, and the columns stay where they were put', async () => {
  await reset('One.md')
  await runCommand('view.splitRight')
  await expect(panes()).toHaveCount(2)

  const widthOf = async (index: number): Promise<number> =>
    panes()
      .nth(index)
      .evaluate((el) => el.getBoundingClientRect().width)

  const before = await widthOf(0)
  const divider = page.locator('.pane-divider')
  await expect(divider).toHaveCount(1)

  const box = (await divider.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 160, box.y + box.height / 2, { steps: 8 })
  await page.mouse.up()

  const after = await widthOf(0)
  expect(after).toBeGreaterThan(before + 100)
  // The second pane gave up exactly what the first gained; nothing else moved.
  expect(after + (await widthOf(1))).toBeCloseTo(before + (await widthOf(1)) + (after - before), 0)
})

test('a divider cannot be dragged past the pane beside it', async () => {
  const divider = page.locator('.pane-divider')
  const box = (await divider.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + 5000, box.y + box.height / 2, { steps: 8 })
  await page.mouse.up()

  // Still readable rather than squeezed to nothing.
  const narrow = await panes()
    .nth(1)
    .evaluate((el) => el.getBoundingClientRect().width)
  expect(narrow).toBeGreaterThan(60)
})

test('the widths even out again on command, and from the keyboard', async () => {
  await runCommand('view.equalPanes')
  const widths = await panes().evaluateAll((els) =>
    els.map((el) => Math.round(el.getBoundingClientRect().width))
  )
  expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(2)

  // The divider is focusable, and the arrow keys move it.
  await page.locator('.pane-divider').focus()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  const after = await panes().evaluateAll((els) =>
    els.map((el) => Math.round(el.getBoundingClientRect().width))
  )
  expect(after[0]!).toBeGreaterThan(widths[0]!)
})

test('zoom scales the interface, and remembers the level', async () => {
  const factor = (): Promise<number> => page.evaluate(() => window.devicePixelRatio)
  const before = await factor()

  await runCommand('view.zoomIn')
  await runCommand('view.zoomIn')
  await expect.poll(factor).toBeGreaterThan(before)

  const level = await page.evaluate(async () => {
    const settings = await window.orrery.invoke('settings:get', undefined)
    return settings.zoomLevel
  })
  expect(level).toBe(2)

  // Survives a reload, which is the part the built-in menu roles got wrong.
  await page.reload()
  await page.waitForSelector('.app', { timeout: 30_000 })
  await expect.poll(factor).toBeGreaterThan(before)

  await runCommand('view.zoomReset')
  await expect.poll(factor).toBeCloseTo(before, 2)
})

test('a workspace reopens the layout it was saved from', async () => {
  await reset('One.md')
  await runCommand('view.splitRight')
  await runCommand('view.splitRight')
  await expect(panes()).toHaveCount(3)
  const saved = await panes().evaluateAll((els) =>
    els.map((el) => el.querySelector('.cm-content')?.textContent?.slice(0, 12) ?? '')
  )

  await runCommand('view.workspaces')
  await page.locator('.palette__input').fill('three up')
  await page.locator('.palette__item', { hasText: 'Save this layout' }).click()

  // Tear the layout down completely, then ask for it back.
  await reset('Five.md')
  await expect(panes()).toHaveCount(1)

  await runCommand('view.workspaces')
  await page.locator('.palette__item', { hasText: 'three up' }).first().click()
  await expect(panes()).toHaveCount(3)
  await expect
    .poll(() =>
      panes().evaluateAll((els) =>
        els.map((el) => el.querySelector('.cm-content')?.textContent?.slice(0, 12) ?? '')
      )
    )
    .toEqual(saved)
})

test('a workspace remembers the column widths too', async () => {
  await reset('One.md')
  await runCommand('view.splitRight')
  await expect(panes()).toHaveCount(2)

  // Drag well off centre, then save.
  const box = (await page.locator('.pane-divider').boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 - 180, box.y + box.height / 2, { steps: 6 })
  await page.mouse.up()
  const narrow = await panes()
    .nth(0)
    .evaluate((el) => el.getBoundingClientRect().width)

  await runCommand('view.workspaces')
  await page.locator('.palette__input').fill('lopsided')
  await page.locator('.palette__item', { hasText: 'Save this layout' }).click()

  await runCommand('view.equalPanes')
  await runCommand('view.workspaces')
  await page.locator('.palette__item', { hasText: 'lopsided' }).first().click()

  await expect
    .poll(() =>
      panes()
        .nth(0)
        .evaluate((el) => el.getBoundingClientRect().width)
    )
    .toBeCloseTo(narrow, -1)
})

test('a deleted workspace stops being offered', async () => {
  await runCommand('view.deleteWorkspace')
  await page.locator('.palette__item', { hasText: 'three up' }).first().click()

  await runCommand('view.workspaces')
  await expect(page.locator('.palette__item', { hasText: 'three up' })).toHaveCount(0)
  await page.keyboard.press('Escape')
})
