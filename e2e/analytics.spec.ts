import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
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

/**
 * A vault with a known shape: two topic clusters joined by a bridge note, one
 * orphan, one broken link. Every number asserted below follows from it.
 */
const VAULT: Record<string, string> = {
  'Index.md': '# Index\n\nStart at [[Rust]] or [[Cooking]].\n',
  'projects/Rust.md': '# Rust\n\nSee [[Ownership]], [[Lifetimes]], [[Cargo]] and [[Index]].\n',
  'projects/Ownership.md': '# Ownership\n\nRelated: [[Lifetimes]], [[Rust]].\n',
  'projects/Lifetimes.md': '# Lifetimes\n\nBuilds on [[Ownership]] and [[Rust]].\n',
  'projects/Cargo.md': '# Cargo\n\nUsed by [[Rust]]. Also [[Missing Note]].\n',
  'projects/Bridge.md': '# Bridge\n\nConnects [[Rust]] and [[Cooking]] worlds.\n',
  'kitchen/Cooking.md': '# Cooking\n\nSee [[Bread]], [[Pasta]], [[Stock]], [[Bridge]].\n',
  'kitchen/Bread.md': '# Bread\n\nSee [[Cooking]].\n',
  'kitchen/Pasta.md': '# Pasta\n\nWith [[Stock]] and [[Cooking]].\n',
  'kitchen/Stock.md': '# Stock\n\nBase for [[Pasta]] and [[Bread]].\n',
  'Scratch.md': '# Scratch\n\nNothing links here and it links nowhere. Mentions Cooking plainly.\n'
}

/** Open the right panel on its Analysis tab, whatever state it was left in. */
async function openAnalysisTab(): Promise<void> {
  await runCommand('view.toggleBacklinks') // any tab: only 'backlinks' would close it
  await page.waitForSelector('.rpanel')
  await page.locator('.rpanel__tab[aria-label="Analysis"]').click()
  await page.waitForSelector('.note-analysis')
}

async function openNote(query: string): Promise<void> {
  await runCommand('app.quickOpen')
  await page.locator('.palette__input').fill(query)
  await page.keyboard.press('Enter')
  await expect(page.locator('.palette')).toBeHidden()
}

async function runCommand(commandId: string): Promise<void> {
  await app.evaluate(({ BrowserWindow }, id) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('menu:command', { commandId: id })
  }, commandId)
}

test.beforeAll(async () => {
  vault = mkdtempSync(join(tmpdir(), 'orrery-analytics-'))
  for (const [rel, body] of Object.entries(VAULT)) {
    const full = join(vault, rel)
    mkdirSync(join(full, '..'), { recursive: true })
    writeFileSync(full, body)
  }
  app = await launchApp()
  page = await app.firstWindow()
  await page.waitForSelector('.app', { timeout: 30_000 })
  await openVault(page, vault, 'Index.md')
})

test.afterAll(async () => {
  await closeCleanly(app, page)
  rmSync(vault, { recursive: true, force: true })
})

test('the vault scan returns a structural analysis', async () => {
  const analysis = await page.evaluate(
    async (root) => window.orrery.invoke('workspace:graph', { rootPath: root }),
    vault
  )

  expect(analysis.stats).toMatchObject({ notes: 11, ghosts: 1, links: 23, components: 2 })
  expect(analysis.stats.words).toBeGreaterThan(0)

  // Rust and Cooking are the two cluster centres, so they lead on influence.
  expect(analysis.insights.hubs.slice(0, 2).map((h) => h.label).sort()).toEqual([
    'Cooking',
    'Rust'
  ])
  // PageRank is a distribution over the vault.
  const total = analysis.nodes.reduce((sum, n) => sum + n.pagerank, 0)
  expect(total).toBeCloseTo(1, 5)

  expect(analysis.insights.orphans.map((o) => o.label)).toEqual(['Scratch'])
  expect(analysis.insights.brokenLinks).toHaveLength(1)
  expect(analysis.insights.brokenLinks[0]).toMatchObject({ label: 'Missing Note' })

  // The two topics separate, and the orphan is its own island.
  const communities = new Set(analysis.nodes.map((n) => n.community))
  expect(communities.size).toBeGreaterThanOrEqual(3)
  const rust = analysis.nodes.find((n) => n.label === 'Rust')!
  const cooking = analysis.nodes.find((n) => n.label === 'Cooking')!
  expect(rust.community).not.toBe(cooking.community)
  expect(rust.inDegree + rust.outDegree).toBeGreaterThan(0)
})

test('the analytics view reports the vault and opens notes from it', async () => {
  await runCommand('view.toggleAnalytics')
  await page.waitForSelector('.analytics__body')

  const tiles = await page.locator('.analytics__tile').allTextContents()
  expect(tiles[0]).toContain('11')
  expect(tiles[1]).toContain('23')

  await expect(page.locator('.analytics__row', { hasText: 'Scratch' })).toBeVisible()
  await expect(page.locator('.analytics__row', { hasText: 'Missing Note' })).toBeVisible()
  // Clusters carry a colour swatch, matching the graph.
  expect(await page.locator('.analytics__swatch').count()).toBeGreaterThanOrEqual(2)
  // The distribution has a bar per link count.
  expect(await page.locator('.analytics__hist-bar').count()).toBeGreaterThan(1)

  // A ranked row is a way into the note.
  await page.locator('.analytics__row', { hasText: 'Rust' }).first().click()
  await expect(page.locator('.analytics__body')).toBeHidden()
  await expect(page.locator('.tab--active .tab__label')).toHaveText('Rust.md')
})

test('the graph can encode analysis as size and colour', async () => {
  await runCommand('view.toggleGraph')
  await page.waitForSelector('.graph__canvas')
  await page.locator('button[aria-label="Graph Physics & Display Settings"]').click()

  const selects = page.locator('.graph__select')
  await expect(selects).toHaveCount(2)
  await selects.nth(0).selectOption('influence')
  await selects.nth(1).selectOption('cluster')
  await expect(selects.nth(0)).toHaveValue('influence')
  await expect(selects.nth(1)).toHaveValue('cluster')

  // The canvas keeps rendering after the switch (no crash, graph still counted).
  await expect(page.locator('.graph__status-pill')).toContainText('notes')
  await runCommand('view.toggleGraph')
})

test('the note panel analyses the open note', async () => {
  // Whichever note the engine ranks first must read as #1 in the panel — the
  // point is that the panel and the engine agree, not which note wins.
  const top = await page.evaluate(async (root) => {
    const g = await window.orrery.invoke('workspace:graph', { rootPath: root })
    return g.insights.hubs[0]!.label
  }, vault)

  await openNote(top)
  await expect(page.locator('.tab--active .tab__label')).toHaveText(`${top}.md`)
  await openAnalysisTab()

  await expect(page.locator('.note-analysis__tiles .analytics__tile').first()).toContainText('#1')
  const body = (await page.locator('.note-analysis').textContent()) ?? ''
  expect(body).toContain('Links in')
  expect(body).toContain('Neighbours')
  expect(body).toContain('of 11 by influence')
  // Its neighbours are the notes it links with.
  expect(await page.locator('.note-analysis__list .analytics__row').count()).toBeGreaterThan(0)
})

test('unlinked mentions surface notes that name this one without linking', async () => {
  // Scratch mentions "Cooking" in plain text and links nothing.
  await openNote('cooking')
  await expect(page.locator('.tab--active .tab__label')).toHaveText('Cooking.md')
  await openAnalysisTab()

  const mentions = page.locator('.note-analysis__section', { hasText: 'Unlinked mentions' })
  await expect(mentions.locator('.analytics__row', { hasText: 'Scratch' })).toBeVisible()
})

test('link suggestions degrade gracefully with no embedding index', async () => {
  // No Ollama and no index in this environment: the channel must answer
  // empty rather than throw, and the panel must say what is missing.
  const suggestions = await page.evaluate(
    async (root) =>
      window.orrery.invoke('embeddings:suggestLinks', {
        rootPath: root,
        path: `${root}/Index.md`,
        limit: 5
      }),
    vault
  )
  expect(suggestions).toEqual([])

  await openNote('index')
  await openAnalysisTab()
  const section = page.locator('.note-analysis__section', { hasText: 'Suggested links' })
  await expect(section).toBeVisible()
  await expect(section).toContainText('Reindex vault')
})
