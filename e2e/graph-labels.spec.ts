import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { closeCleanly, launchApp, openVault } from './helpers'

/**
 * What the graph says at rest, and what it says when you go looking.
 *
 * "Always show note labels" ships off, so the map is quiet: a vault of any size
 * named every node and read as a wall of text. Off used to mean silent though,
 * because the toggle gated the whole condition, so it also took away the label
 * on the node under the pointer and on the note already open. Those two are the
 * ones worth having, and this spec is here because losing them again would not
 * fail anything else: the rule lives in a canvas draw loop, and the audit
 * suite deliberately turns labels on before it measures them.
 *
 * Labels are read as pixels of the ink the drawing code itself uses, so a label
 * painted in some other colour fails here rather than passing unmeasured.
 */
let app: ElectronApplication
let page: Page
let vault: string

const VAULT: Record<string, string> = {
  // Two notes that link to each other, so both have a degree above one and
  // would be labelled at rest if the toggle were on.
  'Alpha.md': '# Alpha\n\nSee [[Beta]].\n',
  'Beta.md': '# Beta\n\nBack to [[Alpha]].\n'
}

test.beforeAll(async () => {
  vault = mkdtempSync(join(tmpdir(), 'orrery-graphlabels-'))
  for (const [name, content] of Object.entries(VAULT)) {
    writeFileSync(join(vault, name), content)
  }
  app = await launchApp()
  page = await app.firstWindow()
  await page.waitForSelector('.app', { timeout: 30_000 })
  await openVault(page, vault, 'Alpha.md')
})

test.afterAll(async () => {
  await closeCleanly(app, page)
})

// Each test starts from a closed graph, and the settings drawer outlives a
// close, so a test that opened it would otherwise hand the next one a canvas
// with a panel over the right of it.
test.afterEach(async () => {
  if (await page.locator('.graph__panel').isVisible()) {
    await page.locator('button[aria-label="Graph Physics & Display Settings"]').click()
    await expect(page.locator('.graph__panel')).toBeHidden()
  }
  if (await page.locator('.graph__canvas').isVisible()) {
    await page.keyboard.press('Escape')
    await expect(page.locator('.graph__canvas')).toBeHidden()
  }
})

/**
 * Is any pixel on the graph canvas painted in the ink of `token`?
 *
 * Near-opaque rather than opaque: at 11px a glyph's edge pixels are only part
 * covered, and a dimmed node is drawn at a fifth of the alpha and drops out.
 */
async function inkPainted(token: string): Promise<boolean> {
  return page.evaluate((name) => {
    const canvas = document.querySelector('.graph__canvas') as HTMLCanvasElement | null
    if (!canvas) return false
    const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
    const hex = raw.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
    let ink: [number, number, number]
    if (hex) {
      const h = hex[1]!
      const full = h.length === 3 ? [...h].map((x) => x + x).join('') : h
      ink = [
        parseInt(full.slice(0, 2), 16),
        parseInt(full.slice(2, 4), 16),
        parseInt(full.slice(4, 6), 16)
      ]
    } else {
      const m = raw.match(/[\d.]+/g)!.map(Number)
      ink = [m[0]!, m[1]!, m[2]!]
    }
    const d = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3]! < 200) continue
      const near =
        Math.abs(d[i]! - ink[0]) + Math.abs(d[i + 1]! - ink[1]) + Math.abs(d[i + 2]! - ink[2])
      if (near <= 12) return true
    }
    return false
  }, token)
}

async function openGraph(): Promise<void> {
  // The command is a toggle, so sending it at an already open graph closes one.
  // Asking first is what lets each test open the graph without knowing what the
  // one before it left on screen.
  if (!(await page.locator('.graph__canvas').isVisible())) {
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.webContents.send('menu:command', {
        commandId: 'view.toggleGraph'
      })
    })
  }
  await expect(page.locator('.graph__canvas')).toBeVisible()
  // The status pill goes up a frame before anything is drawn, so wait for paint
  // rather than for a pause, which on a loaded machine is a guess either way.
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const canvas = document.querySelector('.graph__canvas') as HTMLCanvasElement | null
          if (!canvas) return false
          const d = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
          for (let i = 3; i < d.length; i += 4) if (d[i]! > 0) return true
          return false
        }),
      { timeout: 15_000 }
    )
    .toBe(true)
}

test('the map is quiet at rest but still names the note that is open', async () => {
  await page.locator('.tree-row--file', { hasText: 'Alpha.md' }).click()
  await expect(page.locator('.cm-content')).toContainText('Alpha')
  await openGraph()

  // No ambient labels: the resting ink is what every unhovered, inactive node
  // would be named in, and the toggle now ships off.
  expect(await inkPainted('--or-fg-muted')).toBe(false)

  // The open note is one of these nodes, and it names itself regardless. This
  // is the assertion that fails if "off" ever goes back to meaning "never".
  expect(await inkPainted('--or-fg')).toBe(true)
})

test('turning the toggle on names every node', async () => {
  await openGraph()
  await page.locator('button[aria-label="Graph Physics & Display Settings"]').click()
  await expect(page.locator('.graph__panel')).toBeVisible()
  await page
    .locator('.graph__panel')
    .getByRole('checkbox', { name: 'Always show note labels' })
    .click()
  // React state, then a frame: wait for the ink rather than for a pause.
  await expect.poll(() => inkPainted('--or-fg-muted'), { timeout: 15_000 }).toBe(true)
})
