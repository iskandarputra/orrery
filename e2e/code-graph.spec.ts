import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { closeCleanly, launchApp, openVault } from './helpers'

/**
 * A vault that is half notes and half code, which is what a repository with
 * documentation in it looks like.
 *
 * The graph is expected to join both: `app.ts` imports `pane.ts`, the note
 * about the editor links `[[pane]]`, and the map has to show one shape rather
 * than two disconnected ones.
 */
let app: ElectronApplication
let page: Page
let vault: string

const VAULT: Record<string, string> = {
  'Editor.md': '# Editor\n\nThe pane lives in [[pane]] and the entry point is [[app]].\n',
  'Ideas.md': '# Ideas\n\nNothing to do with the code. See [[Editor]].\n',
  'src/app.ts':
    "import { view } from './pane'\nimport { helper } from './util/helper'\nimport 'react'\n",
  'src/pane.ts': "import { helper } from './util/helper'\nexport const view = 1\n",
  'src/util/helper.ts': 'export const helper = 2\n',
  'src/orphan.ts': '// imported by nobody\nexport const alone = true\n',
  'node_modules/pkg/index.ts': "import './deep'\nexport const ignored = true\n",
  'node_modules/pkg/deep.ts': 'export const deep = 1\n'
}

async function graph(withCode: boolean): Promise<{
  nodes: { id: string; kind: string; degree: number }[]
  edges: { from: string; to: string; kind: string }[]
}> {
  return page.evaluate(
    async ({ root, code }) => {
      const analysis = await window.orrery.invoke('workspace:graph', {
        rootPath: root,
        withCode: code
      })
      return {
        nodes: analysis.nodes.map((n) => ({ id: n.id, kind: n.kind, degree: n.degree })),
        edges: analysis.edges
      }
    },
    { root: vault, code: withCode }
  )
}

const rel = (path: string): string => path.replace(`${vault}/`, '')

test.beforeAll(async () => {
  vault = mkdtempSync(join(tmpdir(), 'orrery-codegraph-'))
  for (const [name, content] of Object.entries(VAULT)) {
    const full = join(vault, name)
    mkdirSync(join(full, '..'), { recursive: true })
    writeFileSync(full, content)
  }
  app = await launchApp()
  page = await app.firstWindow()
  await page.waitForSelector('.app', { timeout: 30_000 })
  await openVault(page, vault, 'Editor.md')
})

test.afterAll(async () => {
  await closeCleanly(app, page)
  rmSync(vault, { recursive: true, force: true })
})

test('without code, the map is the notes and nothing else', async () => {
  const { nodes } = await graph(false)
  const files = nodes.filter((n) => n.id.startsWith(vault)).map((n) => rel(n.id))
  expect(files.sort()).toEqual(['Editor.md', 'Ideas.md'])
})

test('with code, source files join the map and imports are its edges', async () => {
  const { nodes, edges } = await graph(true)
  const files = nodes.filter((n) => n.id.startsWith(vault)).map((n) => rel(n.id))

  expect(files).toContain('src/app.ts')
  expect(files).toContain('src/util/helper.ts')
  // Even one nobody imports: it is in the folder, so it is on the map.
  expect(files).toContain('src/orphan.ts')

  const imports = edges
    .filter((e) => e.kind === 'import')
    .map((e) => `${rel(e.from)} → ${rel(e.to)}`)
    .sort()
  expect(imports).toEqual([
    'src/app.ts → src/pane.ts',
    'src/app.ts → src/util/helper.ts',
    'src/pane.ts → src/util/helper.ts'
  ])
})

test('a dependency outside the vault is not drawn', async () => {
  const { nodes } = await graph(true)
  // `react` is real and is not part of this folder.
  expect(nodes.some((n) => n.id.includes('react'))).toBe(false)
})

test('node_modules is not the project', async () => {
  const { nodes } = await graph(true)
  expect(nodes.some((n) => n.id.includes('node_modules'))).toBe(false)
})

test('a note linking a source file by name joins the two halves', async () => {
  const { edges } = await graph(true)
  const bridge = edges.filter((e) => rel(e.from) === 'Editor.md' && e.kind === 'link')
  expect(bridge.map((e) => rel(e.to)).sort()).toEqual(['src/app.ts', 'src/pane.ts'])
})

test('each node says whether it is a note or code', async () => {
  const { nodes } = await graph(true)
  const kindOf = (name: string): string | undefined => nodes.find((n) => rel(n.id) === name)?.kind
  expect(kindOf('Editor.md')).toBe('note')
  expect(kindOf('src/app.ts')).toBe('code')
})

test('the graph view offers the switch, and rebuilds when it is used', async () => {
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('menu:command', {
      commandId: 'view.toggleGraph'
    })
  })
  await expect(page.locator('.graph__canvas')).toBeVisible({ timeout: 20_000 })
  await page.locator('button[aria-label="Graph Physics & Display Settings"]').click()

  const toggle = page.locator('label', { hasText: 'Include code files' }).locator('input')
  await expect(toggle).toBeChecked()
  await toggle.uncheck()

  // Without code there are no files on the map, and the two notes' links to
  // `[[pane]]` and `[[app]]` become ghosts, since nothing in the map has those
  // names any more.
  await expect(page.locator('.graph__status-pill')).toContainText('4 notes · 3 links', {
    timeout: 20_000
  })
  await expect(page.locator('.graph__status-pill')).not.toContainText('files')

  await toggle.check()
  // Back to two notes, four files, and the ghosts resolved into them.
  await expect(page.locator('.graph__status-pill')).toContainText('2 notes · 4 files', {
    timeout: 20_000
  })
})
