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
  const focused = async (): Promise<number> =>
    page.locator('.editor-pane-host--focused').evaluate((el) => {
      const all = [...(el.parentElement?.children ?? [])]
      return all.indexOf(el)
    })

  const start = await focused()
  for (let i = 1; i <= 3; i++) {
    await runCommand('view.focusNextPane')
    await expect.poll(focused).toBe((start + i) % 3)
  }
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

test('a deleted workspace stops being offered', async () => {
  await runCommand('view.deleteWorkspace')
  await page.locator('.palette__item', { hasText: 'three up' }).first().click()

  await runCommand('view.workspaces')
  await expect(page.locator('.palette__item', { hasText: 'three up' })).toHaveCount(0)
  await page.keyboard.press('Escape')
})
