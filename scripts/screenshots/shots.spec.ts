import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect, type Page } from '@playwright/test'
import type { ElectronApplication } from 'playwright'
import { closeCleanly, launchApp, openVault } from '../../e2e/helpers'

/**
 * The README screenshots.
 *
 * A generator rather than a test, which is why it lives outside `e2e/` — it
 * writes into the working tree, and a suite that dirties the repository every
 * time CI runs is a suite people learn to ignore.
 *
 *   npx playwright test --config playwright.config.ts scripts/screenshots
 *
 * Re-run it when the interface changes enough that the pictures lie.
 */
const OUT = 'docs/screenshots'
const THEME = 'tokyo-night'

const NOTE = `# Orbital mechanics

A note is a **body**; the links between notes are the forces. This paragraph is
*live preview* — the source is still markdown, and the markers reappear the
moment your cursor lands on them.

## What the vault knows

See [[Kepler's laws]] for the derivation, and [[Perturbation theory]] for what
happens when a third body will not sit still. Unresolved links like
[[Lagrange points]] are shown dashed until the note exists.

| Body     | Period (days) | Eccentricity |
| -------- | ------------- | ------------ |
| Mercury  | 87.97         | 0.2056       |
| Venus    | 224.70        | 0.0068       |
| Earth    | 365.26        | 0.0167       |

The ==semi-major axis== follows from the period, $T^2 \\propto a^3$:

$$
a = \\sqrt[3]{\\frac{G M T^2}{4\\pi^2}}
$$

\`\`\`mermaid
flowchart LR
  Note[A note] --> Link[[Wikilink]]
  Link --> Graph[Graph view]
  Graph --> Note
\`\`\`

\`\`\`ts
export function period(semiMajorAxis: number, mass: number): number {
  return 2 * Math.PI * Math.sqrt(semiMajorAxis ** 3 / (G * mass))
}
\`\`\`

- [x] Model the two-body case
- [ ] Add perturbations
`

const CODE = `import { readFile } from 'node:fs/promises'
import { parseFrontmatter } from './frontmatter'

export interface Note {
  path: string
  title: string
  links: string[]
}

/** Read a note and pull out what the graph needs from it. */
export async function loadNote(path: string): Promise<Note> {
  const raw = await readFile(path, 'utf-8')
  const { body, data } = parseFrontmatter(raw)
  return {
    path,
    title: data.title ?? firstHeading(body) ?? path,
    links: [...body.matchAll(/\\[\\[([^\\]|#]+)/g)].map((m) => m[1].trim())
  }
}

function firstHeading(body: string): string | null {
  for (const line of body.split('\\n')) {
    const match = /^#\\s+(.+)$/.exec(line)
    if (match) return match[1]
  }
  return null
}
`

const setTheme = async (page: Page): Promise<void> => {
  await page.evaluate(async (theme) => {
    const current = await window.orrery.invoke('settings:get', undefined)
    await window.orrery.invoke('settings:set', { ...current, theme: 'dark', darkTheme: theme })
  }, THEME)
  await page.waitForTimeout(500)
}

const run = (args: string[], cwd: string): void => {
  execFileSync('git', args, { cwd, stdio: 'ignore' })
}

let app: ElectronApplication
let page: Page
let vault: string

test.beforeAll(async () => {
  vault = mkdtempSync(join(tmpdir(), 'orrery-shots-'))
  mkdirSync(join(vault, 'src'), { recursive: true })
  writeFileSync(join(vault, 'Orbital mechanics.md'), NOTE)
  writeFileSync(
    join(vault, "Kepler's laws.md"),
    "# Kepler's laws\n\nBack to [[Orbital mechanics]].\n"
  )
  writeFileSync(
    join(vault, 'Perturbation theory.md'),
    '# Perturbation theory\n\nSee [[Orbital mechanics]].\n'
  )
  writeFileSync(
    join(vault, 'Two-body problem.md'),
    "# Two-body problem\n\n[[Kepler's laws]] and [[Orbital mechanics]].\n"
  )
  writeFileSync(join(vault, 'Resonance.md'), '# Resonance\n\n[[Perturbation theory]].\n')

  // A vault with enough shape for the graph to be worth a picture: clusters
  // that hang together, a few bridges between them, and some leaves.
  const CLUSTERS: Record<string, string[]> = {
    Mechanics: [
      'Two-body problem',
      'Three-body problem',
      'Lagrange points',
      'Hill sphere',
      'Escape velocity'
    ],
    Observation: [
      'Astrometry',
      'Radial velocity',
      'Transit photometry',
      'Parallax',
      'Proper motion'
    ],
    Instruments: ['Refractor', 'Reflector', 'Interferometer', 'Spectrograph', 'Coronagraph'],
    History: ['Ptolemy', 'Copernicus', 'Tycho Brahe', 'Galileo', 'Laplace']
  }
  for (const [hub, leaves] of Object.entries(CLUSTERS)) {
    writeFileSync(
      join(vault, `${hub}.md`),
      `# ${hub}\n\n${leaves.map((l) => `- [[${l}]]`).join('\n')}\n\nSee also [[Orbital mechanics]].\n`
    )
    leaves.forEach((leaf, i) => {
      const sibling = leaves[(i + 1) % leaves.length]
      writeFileSync(
        join(vault, `${leaf}.md`),
        `# ${leaf}\n\nPart of [[${hub}]]. Compare [[${sibling}]].\n`
      )
    })
  }
  writeFileSync(
    join(vault, 'Ptolemy.md'),
    '# Ptolemy\n\nPart of [[History]]. Superseded by [[Copernicus]], see [[Astrometry]].\n'
  )
  writeFileSync(
    join(vault, 'Laplace.md'),
    '# Laplace\n\nPart of [[History]]. Founded [[Perturbation theory]].\n'
  )
  writeFileSync(
    join(vault, 'Spectrograph.md'),
    '# Spectrograph\n\nPart of [[Instruments]]. Used for [[Radial velocity]].\n'
  )
  writeFileSync(join(vault, 'src', 'notes.ts'), CODE)

  run(['init'], vault)
  run(['config', 'user.email', 'shots@example.com'], vault)
  run(['config', 'user.name', 'Orrery'], vault)
  run(['add', '.'], vault)
  run(['commit', '-m', 'the vault so far'], vault)
  writeFileSync(
    join(vault, 'src', 'notes.ts'),
    CODE.replace(
      '    title: data.title ?? firstHeading(body) ?? path,',
      '    // Fall back through the frontmatter, then the first heading.\n    title: data.title ?? firstHeading(body) ?? basename(path),'
    ).replace('  links: string[]', '  links: string[]\n  wordCount: number')
  )

  app = await launchApp()
  page = await app.firstWindow()
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.waitForSelector('.app', { timeout: 30_000 })
  await openVault(page, vault, 'Orbital mechanics.md')
  await setTheme(page)
})

test.afterAll(async () => {
  await closeCleanly(app, page)
  rmSync(vault, { recursive: true, force: true })
})

test('editor', async () => {
  await page.locator('.tree-row--file', { hasText: 'Orbital mechanics' }).click()
  await expect(page.locator('.cm-content').first()).toContainText('Orbital mechanics', {
    timeout: 15_000
  })
  await page.waitForTimeout(3000)
  await page.screenshot({ path: `${OUT}/editor.png` })
})

test('code and git', async () => {
  await page.locator('.tree-row').filter({ hasText: 'src' }).first().click()
  await page.waitForTimeout(400)
  await page.locator('.tree-row--file', { hasText: 'notes.ts' }).click()
  await expect(page.locator('.cm-content').first()).toBeVisible({ timeout: 15_000 })
  await page.evaluate(() => {
    window.orrery.invoke('settings:get', undefined)
  })
  await page.waitForTimeout(1200)
  await page.screenshot({ path: `${OUT}/code.png` })
})

test('diff and terminal', async () => {
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('menu:command', {
      commandId: 'view.toggleGit'
    })
  })
  await page.waitForTimeout(900)
  await page.locator('.scm-row__name', { hasText: 'notes.ts' }).first().click()
  await expect(page.locator('.diff__panes')).toBeVisible({ timeout: 15_000 })
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('menu:command', {
      commandId: 'view.toggleTerminal'
    })
  })
  await expect(page.locator('.term-panel')).toBeVisible({ timeout: 15_000 })
  await page.locator('.term-panel__host').click()
  await page.keyboard.type('git status --short && git log --oneline -3')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(1600)
  await page.screenshot({ path: `${OUT}/diff-terminal.png` })
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('menu:command', {
      commandId: 'view.toggleTerminal'
    })
  })
  await page.locator('.diff button[aria-label="Close"]').click()
})

test('graph', async () => {
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('menu:command', {
      commandId: 'view.toggleGraph'
    })
  })
  await expect(page.locator('.graph__canvas')).toBeVisible({ timeout: 20_000 })
  await page.waitForTimeout(6000)
  await page.screenshot({ path: `${OUT}/graph.png` })
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('menu:command', {
      commandId: 'view.toggleGraph'
    })
  })
})
