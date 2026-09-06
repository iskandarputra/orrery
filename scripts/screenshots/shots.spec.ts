import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect, type Page } from '@playwright/test'
import type { ElectronApplication } from 'playwright'
import { closeCleanly, launchApp, openVault } from '../../e2e/helpers'
import { makePdf } from '../../src/main/services/__fixtures__/make-pdf'

/**
 * The README screenshots.
 *
 * A generator rather than a test, which is why it lives outside `e2e/` — it
 * writes into the working tree, and a suite that dirties the repository every
 * time CI runs is a suite people learn to ignore.
 *
 *   ./orrery.sh shots
 *
 * Re-run it when the interface changes enough that the pictures lie. It has its
 * own Playwright config because this folder is outside `testDir` and Playwright
 * has no flag to point at another one, so the instruction that used to be here
 * could not run at all: the pictures went eighty-nine commits stale unnoticed.
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

/** A sheet, for the grid. Real columns, so the picture is worth looking at. */
const CSV = `planet,period_days,depth_ppm,radius_earth,discovered
Kepler-10b,0.8375,152,1.47,2011
Kepler-16b,228.776,1690,8.45,2011
Kepler-22b,289.862,492,2.38,2011
Kepler-186f,129.944,410,1.17,2014
Kepler-442b,112.305,570,1.34,2015
Kepler-452b,384.843,489,1.63,2015
TRAPPIST-1e,6.099,519,0.92,2017
TRAPPIST-1f,9.207,633,1.05,2017
Proxima b,11.186,,1.07,2016
`

/** A page the reader can show off on: a diagram it draws, and maths it typesets. */
const PAGE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Observing log</title>
    <script src="https://cdn.jsdelivr.net/npm/mermaid/dist/mermaid.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/mathjax/es5/tex-mml-chtml.js"></script>
    <style>
      body { font: 16px/1.6 system-ui, sans-serif; max-width: 46rem; margin: 2rem auto; padding: 0 1rem; color: #1a1a1a; }
      h1 { font-size: 1.7rem; margin-bottom: 0.2rem; }
      p.lede { color: #555; margin-top: 0; }
      img { border-radius: 6px; }
    </style>
  </head>
  <body>
    <h1>Observing log, 14 March</h1>
    <p class="lede">Transit of Kepler-16b, recorded from the roof.</p>
    <p>
      Depth follows from the radius ratio, \\(\\delta = (R_p / R_\\star)^2\\), so a
      body an eleventh of its star's width takes about a percent of the light:
    </p>
    <p>$$\\delta = \\left(\\frac{R_p}{R_\\star}\\right)^2 \\approx 8.3 \\times 10^{-3}$$</p>
    <h2>How a night goes</h2>
    <pre class="mermaid">flowchart LR
  Plan[Pick a target] --> Align[Align the mount]
  Align --> Capture[Capture frames]
  Capture --> Reduce[Reduce and stack]
  Reduce --> Fit[Fit the light curve]
  Fit --> Plan
</pre>
    <p><img src="https://example.invalid/finder-chart.png" alt="finder chart" width="320" /></p>
    <script>
      document.body.dataset.ran = 'yes'
    </script>
  </body>
</html>
`

/** A short paper, for the PDF reader: three pages and an outline to match. */
const PDF_PAGES = [
  [
    'A NEW DETERMINATION OF THE ORBITAL ELEMENTS',
    '',
    'J. Kepler, Observatory of Prague',
    '',
    'ABSTRACT',
    '',
    'The orbit of Mars is fitted against ten years of naked-eye',
    'positions recorded by Tycho Brahe. A circular orbit leaves a',
    'residual of eight arcminutes, which the observations do not',
    'permit. An ellipse with the Sun at one focus removes it.'
  ],
  [
    'THE THREE LAWS',
    '',
    'I. The orbit of a planet is an ellipse with the Sun at one',
    '   of the two foci.',
    '',
    'II. A line joining a planet and the Sun sweeps out equal',
    '    areas during equal intervals of time.',
    '',
    'III. The square of the orbital period is proportional to the',
    '     cube of the semi-major axis.'
  ],
  [
    'METHOD',
    '',
    'Positions were reduced to the ecliptic and corrected for',
    'parallax. The residual of eight arcminutes is larger than',
    'Tycho ever erred, and it is on that refusal to discard an',
    'inconvenient number that the whole of the above rests.'
  ]
]

/** A small database, for the table viewer. */
function makeCatalogue(path: string): void {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { DatabaseSync } = require('node:sqlite') as {
    DatabaseSync: new (p: string) => { exec(sql: string): void; close(): void }
  }
  const db = new DatabaseSync(path)
  db.exec(`
    CREATE TABLE observations (
      id INTEGER PRIMARY KEY, target TEXT NOT NULL, night TEXT, frames INTEGER, seeing REAL
    );
    INSERT INTO observations (target, night, frames, seeing) VALUES
      ('Kepler-16b', '2026-03-14', 1840, 1.6),
      ('Kepler-22b', '2026-03-15', 1204, 2.1),
      ('TRAPPIST-1e', '2026-03-19', 2610, 1.2),
      ('TRAPPIST-1f', '2026-03-20', 2455, 1.4),
      ('Proxima b', '2026-04-02', 980, 2.8),
      ('Kepler-452b', '2026-04-11', 1733, 1.9);
    CREATE TABLE targets (name TEXT PRIMARY KEY, constellation TEXT, magnitude REAL);
    INSERT INTO targets VALUES ('Kepler-16b', 'Cygnus', 11.7), ('Proxima b', 'Centaurus', 11.1);
  `)
  db.close()
}

const command = async (commandId: string): Promise<void> => {
  await app.evaluate(({ BrowserWindow }, id) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('menu:command', { commandId: id })
  }, commandId)
}

const run = (args: string[], cwd: string): void => {
  execFileSync('git', args, { cwd, stdio: 'ignore' })
}

let app: ElectronApplication
let page: Page
let vault: string
/** The temp directory holding it, which is what gets cleaned up. */
let scratch: string

test.beforeAll(async () => {
  // The folder's name is on screen three times: the sidebar title, the
  // breadcrumb and the terminal's working directory. `orrery-shots-Xq10bo`
  // reads as a test fixture, which is what it is, but the pictures are the
  // first thing anyone sees of the app.
  scratch = mkdtempSync(join(tmpdir(), 'orrery-shots-'))
  vault = join(scratch, 'Astronomy')
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
  writeFileSync(join(vault, 'Transit depths.csv'), CSV)
  writeFileSync(join(vault, 'Observing log.html'), PAGE)
  writeFileSync(
    join(vault, 'Kepler 1959.pdf'),
    makePdf({
      pages: PDF_PAGES,
      outline: [
        { title: 'Abstract', page: 1 },
        { title: 'The three laws', page: 2 },
        { title: 'Method', page: 3 }
      ]
    })
  )
  makeCatalogue(join(vault, 'Catalogue.db'))

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
  rmSync(scratch, { recursive: true, force: true })
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
  // The outline has nothing to say about a TypeScript diff, and an empty panel
  // reading "No headings found" takes a quarter of the picture and clips the
  // working-tree column of the very diff the caption is about.
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('menu:command', {
      commandId: 'view.toggleOutline'
    })
  })
  await expect(page.locator('.term-panel')).toBeVisible({ timeout: 15_000 })
  await page.locator('.term-panel__host').click()
  // The shell is the developer's own, and so is its prompt: the first run of
  // this put `someone@their-laptop` into a picture bound for a public README.
  // A bare `$` is also simply easier to read at screenshot size.
  await page.waitForTimeout(700)
  await page.keyboard.type("PS1='$ '; clear")
  await page.keyboard.press('Enter')
  await page.waitForTimeout(700)
  await page.keyboard.type('git status --short && git log --oneline -3')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(1600)
  await page.screenshot({ path: `${OUT}/diff-terminal.png` })
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('menu:command', {
      commandId: 'view.toggleTerminal'
    })
  })
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('menu:command', {
      commandId: 'view.toggleOutline'
    })
  })
  await page.locator('.diff button[aria-label="Close"]').click()
  // Source control replaces the file tree rather than sitting beside it, and
  // `view.toggleGit` shows rather than toggles, so the sidebar has to be put
  // back by name. Without this, every shot after this one has no tree to click.
  await command('view.toggleFiles')
  await expect(page.locator('.tree-row--file').first()).toBeVisible({ timeout: 15_000 })
})

test('graph', async () => {
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('menu:command', {
      commandId: 'view.toggleGraph'
    })
  })
  await expect(page.locator('.graph__canvas')).toBeVisible({ timeout: 20_000 })

  // Colour by cluster. It is off by default, and the caption in the README
  // talks about the clusters the graph found: with every node the same blue,
  // the picture was not showing the thing the sentence beside it described.
  await page.locator('button[aria-label="Graph Physics & Display Settings"]').click()
  await page.locator('.graph__panel select').nth(1).selectOption('cluster')
  await page.locator('button[aria-label="Graph Physics & Display Settings"]').click()

  await page.waitForTimeout(6000)
  await page.screenshot({ path: `${OUT}/graph.png` })
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('menu:command', {
      commandId: 'view.toggleGraph'
    })
  })
})

test('reading a note', async () => {
  // The Hybrid shot above is the editor. This is the other end of the same
  // note: fully rendered, with the diagram and the maths drawn out, which is
  // what the three view modes are for.
  await page.locator('.tree-row--file', { hasText: 'Orbital mechanics.md' }).click()
  await page.locator('.header-viewmode__btn', { hasText: 'Read' }).click()
  await page.waitForTimeout(2500)
  await page
    .locator('.editor-pane .cm-scroller, .reading__scroll')
    .first()
    .evaluate((el) => {
      el.scrollTop = 620
    })
  await page.waitForTimeout(900)
  await page.screenshot({ path: `${OUT}/reading.png` })
  await page.locator('.header-viewmode__btn', { hasText: 'Hybrid' }).click()
})

test('a pdf', async () => {
  // The outline panel is closed for this and everything below it. None of
  // these surfaces is a note, so it has nothing to say about any of them, and
  // "An outline is for text; this is a PDF" is a quarter of the picture spent
  // on a sentence about the picture's own furniture.
  await command('view.toggleOutline')
  await page.locator('.tree-row--file', { hasText: 'Kepler 1959.pdf' }).click()
  await expect(page.locator('.pdfv__count')).toHaveText('of 3', { timeout: 25_000 })
  // The PDF's own sidebar, holding the pages and the outline, is open already:
  // clicking the toggle here shut it and took the thumbnails out of the shot.
  await page.waitForTimeout(2000)
  await page.screenshot({ path: `${OUT}/pdf.png` })
})

test('a sheet', async () => {
  await page.locator('.tree-row--file', { hasText: 'Transit depths.csv' }).click()
  await expect(page.locator('.csv__table')).toBeVisible({ timeout: 20_000 })
  await page.waitForTimeout(1200)
  await page.screenshot({ path: `${OUT}/csv.png` })
})

test('a database', async () => {
  // Its own picture rather than a second pane beside the sheet. Two grids in
  // one window is two grids too narrow to read, and the point of each is the
  // columns.
  await page.locator('.tree-row--file', { hasText: 'Catalogue.db' }).click()
  await expect(page.locator('.db__grid')).toBeVisible({ timeout: 25_000 })
  await page.waitForTimeout(1200)
  await page.screenshot({ path: `${OUT}/database.png` })
})

test('an html page, read', async () => {
  // The bar is half the point: it says what the reader drew for the page and
  // what it refused to fetch on its behalf.
  await page.locator('.tree-row--file', { hasText: 'Observing log.html' }).click()
  // The tab, not the text: CodeMirror only renders the lines in view, so the
  // title of a page is off screen the moment the file is longer than the pane.
  await expect(page.locator('.tab--active')).toContainText('Observing log.html', {
    timeout: 20_000
  })
  await page.locator('.header-viewmode__btn', { hasText: 'Read' }).click()
  await expect(page.locator('.htmlv__frame')).toBeVisible({ timeout: 20_000 })
  await page.waitForTimeout(2500)
  await page.screenshot({ path: `${OUT}/html.png` })
})
