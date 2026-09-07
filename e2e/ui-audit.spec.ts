import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { launchApp, openVault } from './helpers'
import { makePdf } from '../src/main/services/__fixtures__/make-pdf'
import { makePng } from '../src/main/services/__fixtures__/make-png'

let app: ElectronApplication
let page: Page
let vault: string

/**
 * Contrast and target size, measured on the running app.
 *
 * Both are properties of the rendered pixels, not of any one rule: a token can
 * be correct and still fail once a theme, a translucent background, an inner
 * span from the syntax highlighter and a font size combine. The only honest way
 * to check them is to compute them from what the app actually painted.
 *
 * An audit that only ever sees the note you land on is an audit of one screen,
 * so the scans below walk the surfaces a session actually opens — the palette,
 * the graph and its settings drawer, analytics, history, document statistics
 * and a canvas board — opening each, measuring it, and closing it again.
 */

/**
 * Palettes chosen for where they break, not for coverage: the light themes with
 * the least headroom between their own ink and paper, plus a dark spread. The
 * per-theme token maths is unit-tested; what this catches is a rule that paints
 * over those tokens, which is theme-independent but only visible on the
 * palettes with no margin.
 */
const THEMES: [string, 'light' | 'dark'][] = [
  ['zinc-light', 'light'],
  ['solarized-light', 'light'],
  ['everforest-light', 'light'],
  ['ayu-light', 'light'],
  ['zinc-dark', 'dark'],
  ['monokai-pro', 'dark'],
  ['solarized-dark', 'dark']
]

async function runCommand(commandId: string): Promise<void> {
  await app.evaluate(({ BrowserWindow }, id) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('menu:command', { commandId: id })
  }, commandId)
}

/**
 * Leave the outline showing, whether or not it already is.
 *
 * `view.toggleOutline` is a toggle, and source control no longer displaces the
 * right-hand panel — it moved to the left sidebar — so after a source-control
 * surface the outline is still open and toggling would close the very thing
 * the next surface measures.
 */
async function showOutline(): Promise<void> {
  if (!(await page.locator('.outline-filter__input').isVisible())) {
    await runCommand('view.toggleOutline')
  }
  await expect(page.locator('.outline-filter__input')).toBeVisible()
}

/**
 * Leave the sidebar on the file tree.
 *
 * Also a toggle, for the same reason, and it matters between themes: the
 * workspace surface each theme opens with types into the tree's filter, which
 * only exists on this view.
 */
async function showFiles(): Promise<void> {
  if (!(await page.locator('.sidebar__filter-input').isVisible())) {
    await runCommand('view.toggleFiles')
  }
  await expect(page.locator('.sidebar__filter-input')).toBeVisible()
}

test.beforeAll(async () => {
  vault = mkdtempSync(join(tmpdir(), 'orrery-ui-audit-'))
  mkdirSync(join(vault, 'Folder'), { recursive: true })
  // Every construct that dresses its own text: a wikilink's colour comes from
  // the link rule but its inner span comes from the highlighter, and only one
  // of those was right until this fixture grew a link.
  writeFileSync(
    join(vault, 'Index.md'),
    '# Weekly review\n\nProse with **bold**, `code`, a #tag, a [[Other]] and a [link](https://x.com).\n\n' +
      '- one\n- [ ] two\n\n> [!NOTE] Heads up\n> Body of the note.\n\n```ts\nconst a = 1\n```\n'
  )
  writeFileSync(join(vault, 'Other.md'), '# Other\n\nBack to [[Index]]. #tag\n')
  // Rendered media, so the blocks that carry an expand control — and the viewer
  // that control opens — are audited rather than assumed. 64x64 red PNG.
  writeFileSync(join(vault, 'pic.png'), makePng(64, 64))
  writeFileSync(
    join(vault, 'Diagram.md'),
    '# Diagram\n\n```mermaid\nflowchart LR\n  A[Start] --> B[Middle]\n  B --> C[End]\n```\n\n' +
      'An image: ![red](pic.png)\n\n$$\n\\int_0^1 x^2 dx = \\frac{1}{3}\n$$\n\nTail.\n'
  )
  writeFileSync(join(vault, 'Folder', 'Deep.md'), '# Deep\n\nSee [[Index]].\n')
  // Code joining the map: app.ts imports a file that exists and one that
  // doesn't, so the backlinks panel has an import hit to show and the graph
  // has a broken-import node drawn in its "does not exist" styling, which
  // before this branch only an unwritten note ever wore.
  writeFileSync(
    join(vault, 'app.ts'),
    "import { helper } from './helper'\nimport { gone } from './gone'\n\n" +
      'export function run(): number {\n  return helper() + gone()\n}\n'
  )
  writeFileSync(join(vault, 'helper.ts'), 'export function helper(): number {\n  return 1\n}\n')
  // A second `helper.ts`, so `[[helper]]` in note.md has somewhere else it
  // could have meant. `note.md` sits next to the root one and wins on folder,
  // but the choice still happened, and the backlinks row for it carries the
  // ambiguous marker this measures.
  writeFileSync(
    join(vault, 'Folder', 'helper.ts'),
    'export function helper(): number {\n  return 2\n}\n'
  )
  writeFileSync(join(vault, 'note.md'), '# Note\n\nSee [[helper]] for the code behind this.\n')
  // A repository with one changed file, so the source control panel and the
  // side-by-side diff have real content to be measured against rather than an
  // empty state that says nothing about either.
  writeFileSync(
    join(vault, 'lexer.ts'),
    'export function parse(a: string) {\n  return a.length\n}\n'
  )
  const git = (...args: string[]): void => {
    execFileSync('git', args, { cwd: vault, stdio: 'ignore' })
  }
  git('init')
  git('config', 'user.email', 'audit@example.com')
  git('config', 'user.name', 'Audit')
  git('add', 'lexer.ts')
  git('commit', '-m', 'base')
  writeFileSync(
    join(vault, 'lexer.ts'),
    'export function parse(a: string) {\n  // counts the characters\n  return a.length + 1\n}\n'
  )
  // A web page with a script and a picture it would fetch from the internet, so
  // the reader's bar is measured with every chip it can show on it — the mode
  // pill, the note that scripts did not run, and the offer to load what was
  // refused — rather than in the one state that happens to have the least text.
  writeFileSync(
    join(vault, 'audit.html'),
    '<!doctype html>\n<html><head><meta charset="utf-8"><title>Audit</title></head>\n' +
      '<body><h1>A page</h1><p>Some prose in it.</p>\n' +
      '<img src="https://example.invalid/pixel.png" alt="">\n' +
      '<script>document.title = "ran"</script>\n</body></html>\n'
  )
  // A PDF, so the reader's toolbar, its page rail and its outline are measured
  // rather than assumed.
  writeFileSync(
    join(vault, 'audit.pdf'),
    makePdf({
      pages: [['A page of prose for the audit.'], ['And a second one.']],
      outline: [{ title: 'The only chapter', page: 1 }]
    })
  )
  // A small database, so the viewer has tables, rows and a query box to
  // measure rather than an empty state.
  {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { DatabaseSync } = require('node:sqlite') as {
      DatabaseSync: new (p: string) => { exec(sql: string): void; close(): void }
    }
    const db = new DatabaseSync(join(vault, 'audit.db'))
    db.exec(
      `CREATE TABLE notes (id INTEGER PRIMARY KEY, title TEXT, size REAL);
       INSERT INTO notes (title, size) VALUES ('alpha', 3.5), ('beta', 1.5);`
    )
    db.close()
  }

  // A board with one of each kind of card, so the canvas surface has its own
  // text to measure: rendered markdown, a note preview and a group label.
  writeFileSync(
    join(vault, 'Board.canvas'),
    JSON.stringify({
      nodes: [
        {
          id: 'text',
          type: 'text',
          text: '# On the board\n\nProse with **bold** and `code`.',
          x: 0,
          y: 0,
          width: 260,
          height: 140
        },
        { id: 'file', type: 'file', file: 'Other.md', x: 320, y: 0, width: 260, height: 140 },
        { id: 'group', type: 'group', label: 'Reading', x: -40, y: 200, width: 640, height: 260 }
      ],
      edges: [{ id: 'edge', fromNode: 'text', toNode: 'file' }]
    })
  )

  app = await launchApp()
  page = await app.firstWindow()
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.waitForSelector('.app', { timeout: 30_000 })
  await openVault(page, vault, 'Index.md')
  await page.locator('.tree-row--file', { hasText: 'Index.md' }).click()
  await expect(page.locator('.tree-row--active')).toBeVisible({ timeout: 10_000 })
  await page.waitForTimeout(400)

  // One saved version, so the history modal is audited with a list, a preview
  // and a restore button rather than in its empty state.
  await page.locator('.cm-content').click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type('\n\nA second thought, saved.')
  await runCommand('file.save')
  await expect(page.locator('.tab__close--dirty')).toBeHidden({ timeout: 10_000 })

  // Include code in the graph explicitly rather than trusting the schema
  // default: the graph and backlinks surfaces below only have anything of
  // their own to show once source files are part of the map.
  await page.evaluate(async () => {
    await window.orrery.invoke('settings:set', { graph: { includeCode: true } })
  })

  // One MCP server, connected once here rather than per theme: the panel and
  // the approval dialog are measured against a real server's tools, and 28
  // themes do not each need their own child process.
  await page.evaluate(
    async ({ command, fixture }) => {
      const current = await window.orrery.invoke('settings:get', undefined)
      await window.orrery.invoke('settings:set', {
        mcp: {
          ...current.mcp,
          servers: [
            {
              id: 'fixture',
              name: 'Fixture',
              enabled: true,
              transport: 'stdio',
              command,
              args: [fixture],
              env: {},
              cwd: ''
            }
          ]
        }
      })
      await window.orrery.invoke('mcp:connect', { id: 'fixture' })
    },
    {
      command: process.execPath,
      fixture: resolve(__dirname, '../src/main/services/__fixtures__/mcp-fixture-server.mjs')
    }
  )
})

test.afterAll(async () => {
  await app.close()
  rmSync(vault, { recursive: true, force: true })
})

/**
 * Put a disclosure into the state the surface needs.
 *
 * Clicking to toggle assumes what it is starting from, and a surface that runs
 * after another one — or after a reload — cannot assume that. Two of the theme
 * runs failed on exactly this before the audit asked instead of toggled.
 */
async function setExpanded(selector: string, hasText: string, expanded: boolean): Promise<void> {
  const control = page.locator(selector, { hasText })
  await expect(control.first()).toBeVisible({ timeout: 15_000 })
  if ((await control.first().getAttribute('aria-expanded')) !== String(expanded)) {
    await control.first().click()
  }
  await expect(control.first()).toHaveAttribute('aria-expanded', String(expanded))
}

interface Fail {
  surface: string
  sel: string
  parent: string
  text: string
  ratio: number
  size: number
  /** Syntax-highlighted code, which the themes colour from upstream palettes. */
  code: boolean
}

interface Scan {
  /** How much text the scan actually saw — a scoped scan that finds none is a
   * surface that failed to open, and would otherwise pass by measuring nothing. */
  scanned: number
  fails: Omit<Fail, 'surface'>[]
}

/**
 * Every visible piece of text under `root` whose contrast is under its WCAG AA
 * threshold.
 *
 * Scoped rather than run over the whole body: with a modal open the app behind
 * it is still in the DOM, dimmed by the backdrop and unreadable by design, and
 * measuring it would report the backdrop as a contrast defect.
 */
async function contrastFailures(root: string): Promise<Scan> {
  return page.evaluate((sel) => {
    const parse = (c: string): [number, number, number, number] => {
      const m = c.match(/[\d.]+/g)!.map(Number)
      return [m[0]!, m[1]!, m[2]!, m[3] ?? 1]
    }
    const channel = (v: number): number => {
      const s = v / 255
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
    }
    const lum = (c: [number, number, number]): number =>
      0.2126 * channel(c[0]) + 0.7152 * channel(c[1]) + 0.0722 * channel(c[2])
    // Composite translucent ink over the first opaque surface behind it.
    const surfaceOf = (el: Element): [number, number, number] => {
      let node: Element | null = el
      while (node) {
        const c = parse(getComputedStyle(node).backgroundColor)
        if (c[3] > 0.95) return [c[0], c[1], c[2]]
        node = node.parentElement
      }
      return [255, 255, 255]
    }
    const name = (el: Element | null): string =>
      el ? el.className.toString().split(' ').slice(0, 2).join('.') || el.tagName : ''

    const out: Omit<Fail, 'surface'>[] = []
    let scanned = 0
    for (const el of Array.from(document.querySelectorAll(`${sel}, ${sel} *`))) {
      const ownText = Array.from(el.childNodes).some(
        (n) => n.nodeType === 3 && (n.textContent ?? '').trim().length > 0
      )
      if (!ownText) continue
      const rect = el.getBoundingClientRect()
      if (rect.width < 1 || rect.height < 1) continue
      const cs = getComputedStyle(el)
      if (cs.visibility === 'hidden' || cs.opacity === '0') continue
      // pdf.js paints a page's glyphs onto a canvas and lays transparent copies
      // of the words over the top so a mouse can select them. That layer is
      // deliberately inkless — the legible text is the canvas underneath, which
      // no contrast rule can read anyway.
      if (el.closest('.textLayer')) continue
      scanned++

      const bg = surfaceOf(el)
      const ink = parse(cs.color)
      const fg: [number, number, number] = [
        ink[0] * ink[3] + bg[0] * (1 - ink[3]),
        ink[1] * ink[3] + bg[1] * (1 - ink[3]),
        ink[2] * ink[3] + bg[2] * (1 - ink[3])
      ]
      const a = lum(fg)
      const b = lum(bg)
      const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
      const size = parseFloat(cs.fontSize)
      const large = size >= 24 || (size >= 18.66 && Number(cs.fontWeight) >= 700)
      if (ratio < (large ? 3 : 4.5) - 0.01) {
        out.push({
          sel: name(el),
          parent: name(el.parentElement),
          text: (el.textContent ?? '').trim().slice(0, 30),
          ratio: Math.round(ratio * 100) / 100,
          size,
          // Markdown's code containers, plus syntax highlighting anywhere else
          // CodeMirror renders it — a code file, or either pane of the diff.
          // Those classes are generated by CodeMirror's style module and all
          // carry its `ͼ` prefix, which is the only thing distinguishing a
          // highlighted token from the plain text around it.
          code:
            !!el.closest('.cm-or-code-line, .cm-or-inline-code, .cm-or-code-block') ||
            (!!el.closest('.cm-content') && /ͼ/.test(String(el.className)))
        })
      }
    }
    return { scanned, fails: out.sort((x, y) => x.ratio - y.ratio) }
  }, root)
}

/**
 * The graph draws its note labels onto a <canvas>, where no computed style can
 * reach them — so a DOM scan reports the graph as clean however those labels
 * are painted.
 *
 * They are measured instead from the two live values the drawing code itself
 * reads: the label token, and the surface the canvas is cleared to. The painted
 * pixels are then searched for that ink, so a label drawn in some other colour
 * fails here rather than passing unmeasured.
 */
async function graphCanvasLabels(): Promise<Omit<Fail, 'surface'>[]> {
  return page.evaluate(() => {
    const rgb = (c: string): [number, number, number] => {
      const hex = c.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
      if (hex) {
        const h = hex[1]!
        const full = h.length === 3 ? [...h].map((x) => x + x).join('') : h
        return [
          parseInt(full.slice(0, 2), 16),
          parseInt(full.slice(2, 4), 16),
          parseInt(full.slice(4, 6), 16)
        ]
      }
      const m = c.match(/[\d.]+/g)!.map(Number)
      return [m[0]!, m[1]!, m[2]!]
    }
    const channel = (v: number): number => {
      const s = v / 255
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
    }
    const lum = (c: [number, number, number]): number =>
      0.2126 * channel(c[0]) + 0.7152 * channel(c[1]) + 0.0722 * channel(c[2])
    const ratioOf = (a: [number, number, number], b: [number, number, number]): number => {
      const [x, y] = [lum(a), lum(b)]
      return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
    }

    const canvas = document.querySelector('.graph__canvas') as HTMLCanvasElement | null
    if (!canvas) return []

    // The canvas is cleared to transparent every frame, so what sits behind the
    // labels is whatever the first opaque element under it paints.
    let paper: [number, number, number] = [255, 255, 255]
    for (let node: Element | null = canvas; node; node = node.parentElement) {
      const c = getComputedStyle(node)
        .backgroundColor.match(/[\d.]+/g)!
        .map(Number)
      if ((c[3] ?? 1) > 0.95) {
        paper = [c[0]!, c[1]!, c[2]!]
        break
      }
    }

    const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
    const style = getComputedStyle(document.documentElement)
    const out: Omit<Fail, 'surface'>[] = []

    // Both inks the labels are drawn in: the resting one, and the one the
    // hovered and active notes are picked out with. The second is on the canvas
    // because the note behind the graph is one of its nodes — a surface that
    // opened the graph over a canvas board instead would report it missing.
    for (const [what, token] of [
      ['graph node label', '--or-fg-muted'],
      ['graph node label (active)', '--or-fg']
    ] as const) {
      const ink = rgb(style.getPropertyValue(token))
      // A glyph's core pixels carry the fill colour unblended; its edges are
      // part-covered, and at 11px a 400-weight stroke peaks a little short of
      // fully opaque — so near-opaque, not opaque, is what a painted label
      // looks like. Anything dimmed is drawn at a fifth of that and drops out.
      let painted = false
      for (let i = 0; i < pixels.length && !painted; i += 4) {
        if (pixels[i + 3]! < 200) continue
        painted =
          Math.abs(pixels[i]! - ink[0]) +
            Math.abs(pixels[i + 1]! - ink[1]) +
            Math.abs(pixels[i + 2]! - ink[2]) <=
          12
      }
      const ratio = ratioOf(ink, paper)
      // A label that is nowhere on the canvas is a label this check never
      // measured, and saying so is more use than a silent pass.
      if (!painted) {
        out.push({
          sel: what,
          parent: 'graph__canvas',
          text: `no pixels painted in ${style.getPropertyValue(token).trim()}`,
          ratio: 0,
          size: 11,
          code: false
        })
      } else if (ratio < 4.49) {
        out.push({
          sel: what,
          parent: 'graph__canvas',
          text: `${style.getPropertyValue(token).trim()} on rgb(${paper.join(',')})`,
          ratio: Math.round(ratio * 100) / 100,
          size: 11,
          code: false
        })
      }
    }
    return out
  })
}

/**
 * Is the resting label ink on the canvas yet?
 *
 * `graphCanvasLabels` reads the canvas once, and the graph now starts with
 * note labels off, so the surface that measures them has to turn them on and
 * then wait for a frame drawn with them. Waiting for the ink itself beats a
 * fixed pause, which on a loaded machine is a guess either way.
 *
 * The colour arithmetic is repeated from `graphCanvasLabels` rather than
 * shared, because each runs inside its own `page.evaluate` and nothing crosses
 * that boundary but data.
 */
async function restingLabelInkPainted(): Promise<boolean> {
  return page.evaluate(() => {
    const canvas = document.querySelector('.graph__canvas') as HTMLCanvasElement | null
    if (!canvas) return false
    const raw = getComputedStyle(document.documentElement).getPropertyValue('--or-fg-muted').trim()
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
      if (
        Math.abs(d[i]! - ink[0]) + Math.abs(d[i + 1]! - ink[1]) + Math.abs(d[i + 2]! - ink[2]) <=
        12
      ) {
        return true
      }
    }
    return false
  })
}

interface Target {
  sel: string
  label: string
  named: boolean
  /** Buttons and links carry their own name; a form control gets one from a label. */
  namable: boolean
  /** Sits in a line of prose, where 2.5.8 stops asking for 24px. */
  inline: boolean
  w: number
  h: number
  reach: boolean
}

/** Every control under `root`, with the size of the area it can be hit in. */
async function controls(root: string): Promise<Target[]> {
  return page.evaluate(
    (sel) =>
      Array.from(
        document.querySelectorAll(
          `${sel} button, ${sel} [role="button"], ${sel} a, ` +
            `${sel} input:not([type="hidden"]), ${sel} select, ${sel} textarea`
        )
      )
        .map((el) => {
          // A tick box is operated by clicking the words next to it, so the
          // target is the whole label rather than the box at the end of it.
          // Only where that holds: clicking a slider's label focuses it but
          // does not move it, so a slider is measured on its own track.
          const label = el.closest('label')
          const activatedByLabel =
            !!label && el.matches('input[type="checkbox"], input[type="radio"]')
          const r = (activatedByLabel ? label : el).getBoundingClientRect()
          const cx = r.left + r.width / 2
          const cy = r.top + r.height / 2
          // The clickable area, which is what the criterion is about — a small
          // glyph may still carry a full-size hit area around it.
          const reaches = (dx: number, dy: number): boolean => {
            const at = document.elementFromPoint(cx + dx, cy + dy)
            if (!at) return false
            if (at === el || el.contains(at)) return true
            const hit = at.closest('label')
            return !!hit && (hit as HTMLLabelElement).control === el
          }
          /**
           * The third way a control gets a name, and the one this missed.
           *
           * `aria-labelledby` points at text already on screen, which is what a
           * settings row is: the words are in the row's label, and repeating
           * them into an `aria-label` is the version that goes stale. Resolved
           * rather than trusted, because an id pointing at nothing names
           * nothing, and counting the attribute alone would turn a typo into a
           * pass.
           */
          const labelledBy = (el.getAttribute('aria-labelledby') ?? '')
            .split(/\s+/)
            .filter(Boolean)
            .map((id) => document.getElementById(id)?.textContent?.trim() ?? '')
            .join(' ')
            .trim()
          return {
            sel: el.className.toString().split(' ').slice(0, 2).join('.') || el.tagName,
            label: (el.getAttribute('aria-label') ?? (labelledBy || null) ?? el.textContent ?? '')
              .trim()
              .slice(0, 24),
            named: !!(el.getAttribute('title') ?? el.getAttribute('aria-label')) || !!labelledBy,
            namable: !!el.closest('button, [role="button"], a'),
            inline: !!el.closest('.cm-line'),
            w: Math.round(r.width),
            h: Math.round(r.height),
            reach:
              r.width >= 24 && r.height >= 24
                ? true
                : reaches(-11, -11) && reaches(11, -11) && reaches(-11, 11) && reaches(11, 11)
          }
        })
        .filter((t) => t.w > 0 && t.h > 0),
    root
  )
}

/**
 * A screen the audit opens, measures and closes again.
 *
 * `root` scopes both scans to what the surface owns, and `hidden` lets a
 * surface report the text it paints somewhere a DOM scan cannot follow.
 */
interface Surface {
  name: string
  root: string
  open(): Promise<void>
  close(): Promise<void>
  hidden?(): Promise<Omit<Fail, 'surface'>[]>
}

async function openGraph(): Promise<void> {
  await runCommand('view.toggleGraph')
  await expect(page.locator('.graph__canvas')).toBeVisible()
  await expect(page.locator('.graph__status-pill')).toContainText('notes')
  // The pill goes up when the graph is built, which is one animation frame
  // before anything is drawn — so wait for paint rather than for a fixed pause,
  // which on a loaded machine is a guess either way.
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

async function closeGraph(): Promise<void> {
  await page.keyboard.press('Escape')
  await expect(page.locator('.graph__canvas')).toBeHidden()
  // Park the pointer somewhere inert: left over a node it would leave a hover
  // style on whatever the next surface puts underneath it.
  await page.mouse.move(2, 2)
}

/**
 * Hover a node the way a mouse finds one, by moving until the graph reacts.
 *
 * `label`, when given, keeps trying candidate points until the card names
 * that node rather than settling for whichever one the sweep reaches first.
 * The layout is a physics simulation with no exposed coordinates, so which
 * node ends up under which point on screen is not the caller's to predict.
 * The only way to find a specific one is to keep asking until it turns up.
 */
async function hoverGraphNode(label?: string): Promise<void> {
  const card = page.locator('.graph__hover-card')
  for (let attempt = 0; attempt < 5; attempt++) {
    // The whole search runs inside the page, not through Playwright's driver.
    // An earlier version drove the sweep from outside: a real page.mouse.move
    // plus a 1s card.waitFor for every 8px grid cell that merely hit *some*
    // node, so that a run naming a label kept going past the first candidate.
    // On this fixture that was dozens of round trips, most of them a wrong
    // node the card was already showing, and it burned through Playwright's
    // whole 60s test timeout rather than the few seconds this takes. The
    // cursor is set synchronously by the graph's own handler, so a synthetic
    // dispatch answers "is anything here" for free; only the label check
    // needs a painted frame, so that wait is paid once per node actually
    // found, not once per grid cell.
    const point = await page.evaluate(async (wanted: string | null) => {
      const canvas = document.querySelector('.graph__canvas') as HTMLCanvasElement
      const r = canvas.getBoundingClientRect()
      const frame = (): Promise<void> =>
        new Promise((resolve) => requestAnimationFrame(() => resolve()))
      // A node's hit radius is never under 12px, so an 8px grid cannot step
      // over one.
      for (let y = r.top + 4; y < r.bottom; y += 8) {
        for (let x = r.left + 4; x < r.right; x += 8) {
          canvas.dispatchEvent(new MouseEvent('mousemove', { clientX: x, clientY: y }))
          if (canvas.style.cursor !== 'pointer') continue
          if (!wanted) return { x, y }
          await frame()
          const title = document.querySelector('.graph__hover-title')?.textContent?.trim()
          if (title === wanted) return { x, y }
        }
      }
      return null
    }, label ?? null)
    if (point) {
      // One real hover, so what is actually asserted is a genuine pointer
      // event painting the card, not just the synthetic sweep that found it.
      await page.mouse.move(point.x, point.y)
      try {
        await card.waitFor({ state: 'visible', timeout: 1_000 })
        if (!label) return
        const title = (await page.locator('.graph__hover-title').textContent())?.trim()
        if (title === label) return
      } catch {
        // Drifted since the sweep found it: the next attempt sweeps again
        // against wherever the simulation has settled by then.
      }
    }
    await page.waitForTimeout(200)
  }
  throw new Error(`no graph node could be hovered${label ? ` (wanted "${label}")` : ''}`)
}

async function openBoard(): Promise<void> {
  await page.locator('.tree-row--file', { hasText: 'Board.canvas' }).click()
  await expect(page.locator('.canvas__card').first()).toBeVisible()
  await expect(page.locator('.canvas__card')).toHaveCount(3)
}

async function closeBoard(): Promise<void> {
  await page.locator('.tree-row--file', { hasText: 'Index.md' }).click()
  await expect(page.locator('.editor-pane')).toBeVisible()
}

async function openDiagramNote(): Promise<void> {
  await page.locator('.tree-row--file', { hasText: 'Diagram.md' }).click()
  // The mermaid bundle is loaded on demand, so the first note of a fresh reload
  // waits on a ~1MB chunk before there is a diagram to measure.
  await expect(page.locator('.cm-or-mermaid > svg')).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('.cm-or-image img')).toBeVisible()
}

async function closeDiagramNote(): Promise<void> {
  await page.locator('.tree-row--file', { hasText: 'Index.md' }).click()
  await expect(page.locator('.cm-or-mermaid')).toBeHidden()
}

const SURFACES: Surface[] = [
  {
    name: 'workspace',
    root: '.app',
    open: async () => {
      // With both filters in use: a filter's clear button only exists once
      // something has been typed into it, so an idle workspace never shows one.
      await page.locator('.sidebar__filter-input').fill('Index')
      await page.locator('.outline-filter__input').fill('week')
      await expect(page.locator('.sidebar__filter-clear')).toBeVisible()
      await expect(page.locator('.outline-filter__clear')).toBeVisible()
    },
    close: async () => {
      await page.locator('.sidebar__filter-clear').click()
      await page.locator('.outline-filter__clear').click()
      await expect(page.locator('.tree-row--file', { hasText: 'Board.canvas' })).toBeVisible()
    }
  },
  {
    /**
     * The settings dialog, on the section that carries the reader's standing
     * answer about running a page's code.
     *
     * The whole dialog had never been measured. It is added here because the
     * change that brought the two rows below had to add a surface for them, and
     * a surface for two rows that skipped the panel they sit in would be the
     * kind of coverage that only looks like coverage.
     */
    name: 'settings',
    root: '.settings',
    open: async () => {
      await runCommand('app.openSettings')
      await expect(page.locator('.settings')).toBeVisible()
      await expect(page.getByText('Run scripts in HTML files')).toBeVisible()
    },
    close: async () => {
      await page.keyboard.press('Escape')
      await expect(page.locator('.settings')).toHaveCount(0)
    }
  },
  {
    name: 'command palette',
    root: '.palette',
    open: async () => {
      await runCommand('app.commandPalette')
      await expect(page.locator('.palette__item').first()).toBeVisible()
    },
    close: async () => {
      await page.keyboard.press('Escape')
      await expect(page.locator('.palette')).toBeHidden()
    }
  },
  {
    name: 'workspaces palette',
    root: '.palette',
    open: async () => {
      await runCommand('view.workspaces')
      // With a name typed, so the offer to save is on screen and audited too.
      await page.locator('.palette__input').fill('audit layout')
      await expect(page.locator('.palette__item').first()).toBeVisible()
    },
    close: async () => {
      await page.keyboard.press('Escape')
      await expect(page.locator('.palette')).toBeHidden()
    }
  },
  {
    // Expanded down to a tool's own form: the rows, the status words and the
    // schema fields are where the small text lives.
    name: 'mcp panel',
    root: '.rpanel',
    open: async () => {
      await runCommand('view.toggleMcp')
      await expect(page.locator('.mcp-server__name')).toBeVisible({ timeout: 15_000 })
      await setExpanded('.mcp-server__toggle', 'Fixture', true)
      await setExpanded('.mcp-tool__name', 'Echo', true)
      await expect(page.locator('.schema-form__input').first()).toBeVisible()
    },
    close: async () => {
      await setExpanded('.mcp-tool__name', 'Echo', false)
      await runCommand('view.toggleOutline')
      await expect(page.locator('.outline-filter__input')).toBeVisible()
    }
  },
  {
    // The dialog that stands between a tool and the machine, with a real call
    // waiting on it. Denied on the way out, so nothing runs.
    name: 'mcp approval',
    root: '.mcp-approve',
    open: async () => {
      await runCommand('view.toggleMcp')
      await setExpanded('.mcp-server__toggle', 'Fixture', true)
      await setExpanded('.mcp-tool__name', 'wipe', true)
      await page.locator('.mcp-tool__body .mcp-tool__run').click()
      await expect(page.locator('.mcp-approve')).toBeVisible({ timeout: 15_000 })
    },
    close: async () => {
      await page.locator('.mcp-approve').getByRole('button', { name: 'Deny', exact: true }).click()
      await expect(page.locator('.mcp-approve')).toHaveCount(0)
      await setExpanded('.mcp-tool__name', 'wipe', false)
      await setExpanded('.mcp-server__toggle', 'Fixture', false)
      await runCommand('view.toggleOutline')
      await expect(page.locator('.outline-filter__input')).toBeVisible()
    }
  },
  {
    // The form a server's prompt asks for, which is the same form elicitation
    // and a tool's arguments use.
    name: 'mcp prompt form',
    root: '.mcp-approve',
    open: async () => {
      await runCommand('view.toggleMcp')
      await setExpanded('.mcp-server__toggle', 'Fixture', true)
      await page.locator('.mcp-server__resource', { hasText: 'summarise' }).click()
      await expect(page.locator('[aria-label="Prompt arguments"]')).toBeVisible({ timeout: 15_000 })
    },
    close: async () => {
      await page
        .locator('[aria-label="Prompt arguments"]')
        .getByRole('button', { name: 'Cancel' })
        .click()
      await expect(page.locator('[aria-label="Prompt arguments"]')).toHaveCount(0)
      await setExpanded('.mcp-server__toggle', 'Fixture', false)
      await runCommand('view.toggleOutline')
      await expect(page.locator('.outline-filter__input')).toBeVisible()
    }
  },
  {
    // The PDF reader: its toolbar, the page rail beside it, and the outline —
    // small controls and smaller labels, over a white page that a dark theme
    // has to stay legible against.
    name: 'pdf reader',
    root: '.pdfv',
    open: async () => {
      await page.locator('.tree-row--file', { hasText: 'audit.pdf' }).click()
      await expect(page.locator('.pdfViewer .page').first()).toBeVisible({ timeout: 30_000 })
      await expect(page.locator('.pdfv__outline-row').first()).toBeVisible()
      await page.locator('button[aria-label="Find in this document"]').click()
      await expect(page.locator('.pdfv__find-input')).toBeVisible()
    },
    close: async () => {
      await page.locator('button[aria-label="Close find"]').click()
      await page.locator('.tree-row--file', { hasText: 'Index.md' }).click()
      await expect(page.locator('.cm-content').first()).toBeVisible()
    }
  },
  {
    // Editing the page itself: a box around every line, the handles that move,
    // resize and turn what is picked, and the panel that opens over it. All of
    // it is drawn on top of a white page, which is the hard case for a dark
    // theme, and none of it had ever been measured.
    name: 'pdf page editor',
    root: '.pdfv',
    open: async () => {
      await page.locator('.tree-row--file', { hasText: 'audit.pdf' }).click()
      await expect(page.locator('.pdfViewer .page').first()).toBeVisible({ timeout: 30_000 })
      await page.locator('button[aria-label="Edit the page itself"]').click()
      const box = page.locator('.pdfv__object').first()
      await expect(box).toBeVisible({ timeout: 20_000 })
      // Picked, so the handles and the panel are on screen to be measured.
      const at = (await box.boundingBox())!
      await page.mouse.click(at.x + at.width / 2, at.y + at.height / 2)
      await expect(page.locator('.pdfv__object-handle')).toBeVisible()
      await expect(page.locator('.pdfv__object-turn')).toBeVisible()
    },
    close: async () => {
      await page.keyboard.press('Escape')
      await page.locator('button[aria-label="Edit the page itself"]').click()
      await page.locator('.tree-row--file', { hasText: 'Index.md' }).click()
      await expect(page.locator('.cm-content').first()).toBeVisible()
    }
  },
  {
    // The image viewer: a name, the dimensions and the zoom readout, all in
    // small text over whatever colour the picture happens to be.
    name: 'image viewer',
    root: '.imgv',
    open: async () => {
      await page.locator('.tree-row--file', { hasText: 'pic.png' }).click()
      await expect(page.locator('.imgv__image')).toBeVisible({ timeout: 20_000 })
      await expect(page.locator('.imgv__size')).toContainText('64')
    },
    close: async () => {
      await page.locator('.tree-row--file', { hasText: 'Index.md' }).click()
      await expect(page.locator('.cm-content').first()).toBeVisible()
    }
  },
  {
    // The HTML reader's bar: the mode pill, what it refused to run, and the
    // offer to fetch what it refused to load. Small text and small targets over
    // the page's own white ground, which no theme controls. The page inside the
    // frame is somebody else's document and is deliberately not audited — a DOM
    // scan cannot enter a sandboxed frame, and what it looks like is not this
    // app's to answer for.
    name: 'html reader',
    root: '.htmlv',
    open: async () => {
      await page.locator('.tree-row--file', { hasText: 'audit.html' }).click()
      await expect(page.locator('.header-viewmode__btn', { hasText: 'Read' })).toBeVisible({
        timeout: 20_000
      })
      await page.locator('.header-viewmode__btn', { hasText: 'Read' }).click()
      await expect(page.locator('.htmlv__frame')).toBeVisible({ timeout: 20_000 })
      await expect(page.locator('.htmlv__action', { hasText: /Load 1 remote/ })).toBeVisible()
      // Scripts turned on, because the notice saying so is a control of its
      // own now (the way to take the consent back), and it is the one thing in
      // this bar drawn in the accent rather than the muted foreground. Left
      // unpressed it is a button no theme is ever measured against.
      await page.locator('.htmlv__action', { hasText: /Run \d+ scripts?/ }).click()
      await expect(page.locator('.htmlv__action--live')).toBeVisible({ timeout: 20_000 })
    },
    close: async () => {
      // Given back before leaving. Consent outlives the tab, and a surface that
      // leaves it behind is a surface that changes what the next run measures.
      await page.locator('.htmlv__action--live').click()
      await expect(page.locator('.htmlv__action', { hasText: /Run \d+ scripts?/ })).toBeVisible({
        timeout: 20_000
      })
      await page.locator('.htmlv__action', { hasText: 'Edit' }).click()
      // The tab goes too, not just the view. Every open tab takes room from the
      // ones beside it, and the close control on a tab is already at the size
      // 2.5.8 asks for with nothing to spare — so a surface that opens a file
      // and only navigates away leaves the tab strip a little tighter than it
      // found it, and the audit reads that as the *tab bar* failing.
      await page.getByRole('button', { name: 'Close audit.html' }).click()
      await expect(page.locator('.tab', { hasText: 'audit.html' })).toHaveCount(0)
      await page.locator('.tree-row--file', { hasText: 'Index.md' }).click()
      await expect(page.locator('.cm-content').first()).toBeVisible()
    }
  },
  {
    // The database viewer: a table list, a grid and the query box, which is
    // the smallest text on it.
    name: 'database viewer',
    root: '.db',
    open: async () => {
      await page.locator('.tree-row--file', { hasText: 'audit.db' }).click()
      await expect(page.locator('.db__table-name').first()).toBeVisible({ timeout: 20_000 })
      await page.locator('.db__action', { hasText: 'SQL' }).click()
      await expect(page.locator('.db__sql-input')).toBeVisible()
    },
    close: async () => {
      await page.locator('.db__action', { hasText: 'SQL' }).click()
      await page.locator('.tree-row--file', { hasText: 'Index.md' }).click()
      await expect(page.locator('.cm-content').first()).toBeVisible()
    }
  },
  {
    name: 'document statistics',
    root: '.doc-stats-modal',
    open: async () => {
      await page.locator('.header-stats-pill').click()
      await expect(page.locator('.doc-stat-card').first()).toBeVisible()
    },
    close: async () => {
      await page.locator('.doc-stats-modal .icon-btn').click()
      await expect(page.locator('.doc-stats-modal')).toBeHidden()
    }
  },
  {
    name: 'version history',
    root: '.history',
    open: async () => {
      await runCommand('note.history')
      await expect(page.locator('.history__item').first()).toBeVisible()
    },
    close: async () => {
      await page.keyboard.press('Escape')
      await expect(page.locator('.history')).toBeHidden()
    }
  },
  {
    name: 'analytics',
    root: '.analytics',
    open: async () => {
      await runCommand('view.toggleAnalytics')
      await expect(page.locator('.analytics__body')).toBeVisible()
      // Bridges was empty before code joined the map, so scrolling to it was
      // never needed: the whole panel fit. Two rows of real content now push
      // it past the fold, and a control the corner-reach check cannot find
      // because it is scrolled away is a false positive rather than a real
      // target-size defect.
      await page.locator('.analytics__list', { hasText: 'Bridges' }).scrollIntoViewIfNeeded()
    },
    close: async () => {
      await page.keyboard.press('Escape')
      await expect(page.locator('.analytics')).toBeHidden()
    }
  },
  {
    // With the settings drawer open and note labels turned on: every label is
    // painted in its resting ink, which is what `graphCanvasLabels` goes
    // looking for.
    //
    // The toggle is switched on here rather than left alone, because the app
    // now ships it off: at rest the graph names only the node under the pointer
    // and the note that is open. Left at its default this surface would paint
    // no label at all, and `graphCanvasLabels` reports an unpainted label as a
    // failure rather than a pass, which is the right behaviour and the wrong
    // outcome. Turning it on measures the resting ink the setting exists for.
    name: 'graph',
    root: '[aria-label="Knowledge Graph View"]',
    open: async () => {
      await openGraph()
      await page.locator('button[aria-label="Graph Physics & Display Settings"]').click()
      await expect(page.locator('.graph__panel')).toBeVisible()
      await page
        .locator('.graph__panel')
        .getByRole('checkbox', { name: 'Always show note labels' })
        .click()
      // The toggle is React state and the canvas redraws on the next frame, so
      // the scan below would otherwise read a canvas painted without labels.
      await expect.poll(restingLabelInkPainted, { timeout: 15_000 }).toBe(true)
    },
    close: async () => {
      // The drawer outlives a close, so the next surface would open with it
      // still covering the right of the canvas — and the hover sweep with it.
      await page.locator('button[aria-label="Graph Physics & Display Settings"]').click()
      await expect(page.locator('.graph__panel')).toBeHidden()
      await closeGraph()
    },
    hidden: graphCanvasLabels
  },
  {
    name: 'graph hover',
    root: '[aria-label="Knowledge Graph View"]',
    open: async () => {
      await openGraph()
      // A query in the filter box is what puts its clear button on screen.
      await page.locator('.graph__header-search input').fill('e')
      await hoverGraphNode()
    },
    close: closeGraph
  },
  {
    // `app.ts` imports `./gone`, which has no file behind it, so the graph
    // draws it in the same ghost styling a missing wikilink already had.
    // Before this branch the only non-existent nodes were unwritten notes.
    // The hover card's "nothing behind this" branch is only reachable by
    // finding that specific node, since the layout gives no other way to
    // aim at it.
    name: 'graph broken import',
    root: '[aria-label="Knowledge Graph View"]',
    open: async () => {
      await openGraph()
      // The node itself has no DOM to assert on: it is drawn on the canvas.
      // Checked directly over IPC first, so a fixture that stopped producing
      // it fails here with a clear message rather than as a hover search that
      // never finds anything.
      const graph = await page.evaluate(
        (root) => window.orrery.invoke('workspace:graph', { rootPath: root, withCode: true }),
        vault
      )
      expect(
        graph.nodes.some((n) => !n.exists && n.kind === 'code' && n.label === 'gone'),
        'the fixture has a missing-import node to draw'
      ).toBe(true)
      await hoverGraphNode('gone')
      await expect(page.locator('.graph__hover-ghost')).toBeVisible()
    },
    close: closeGraph
  },
  {
    name: 'canvas board',
    root: '.canvas',
    open: openBoard,
    close: closeBoard
  },
  {
    name: 'canvas note picker',
    root: '.canvas__picker',
    open: async () => {
      await openBoard()
      await page.locator('.canvas__toolbar button[title="Add note"]').click()
      await expect(page.locator('.canvas__picker-list button').first()).toBeVisible()
    },
    close: async () => {
      await page.keyboard.press('Escape')
      await expect(page.locator('.canvas__picker')).toBeHidden()
      await closeBoard()
    }
  },
  {
    // Hovered on the control itself, which is where it takes its emphasised
    // colours — at rest it is deliberately quiet.
    name: 'editor media controls',
    root: '.editor-pane',
    open: async () => {
      await openDiagramNote()
      await expect(page.locator('.cm-or-mermaid .cm-or-expand')).toBeVisible()
      await page.locator('.cm-or-mermaid .cm-or-expand').hover()
    },
    close: closeDiagramNote
  },
  {
    // Both a resolved link and a missing one, since the missing style is the
    // one carrying information and the one most likely to be too quiet.
    name: 'outgoing links',
    root: '.rpanel',
    open: async () => {
      await page.locator('.tree-row--file', { hasText: 'Index.md' }).click()
      await runCommand('view.toggleOutgoing')
      await expect(page.locator('.outgoing__row').first()).toBeVisible({ timeout: 15_000 })
    },
    close: async () => {
      await runCommand('view.toggleOutline')
      await expect(page.locator('.outline-filter__input')).toBeVisible()
    }
  },
  {
    // Before this branch the panel only ever listed wikilinks, so every row in
    // it was a note. `app.ts` importing `helper.ts` gives it a source file
    // instead, which is text and a row style neither was ever measured. The
    // second `Folder/helper.ts` gives `note.md`'s `[[helper]]` a choice to
    // make, so the ambiguous marker on that row is measured too, not just
    // asserted to exist.
    name: 'backlinks',
    root: '.rpanel',
    open: async () => {
      await page.locator('.tree-row--file', { hasText: 'helper.ts' }).click()
      await runCommand('view.toggleBacklinks')
      await expect(page.locator('.result-group__name', { hasText: 'app.ts' })).toBeVisible({
        timeout: 15_000
      })
      await expect(page.locator('.result-snippet__ambiguous')).toBeVisible()
    },
    close: async () => {
      // The tab goes too. Every open tab narrows the ones beside it, and the
      // next surface's close buttons are already at the size 2.5.8 asks for
      // with nothing to spare, the same reason the html reader closes its own
      // tab on the way out.
      await page.getByRole('button', { name: 'Close helper.ts' }).click()
      await expect(page.locator('.tab', { hasText: 'helper.ts' })).toHaveCount(0)
      await runCommand('view.toggleOutline')
      await expect(page.locator('.outline-filter__input')).toBeVisible()
    }
  },
  {
    name: 'bookmarks',
    root: '.rpanel',
    open: async () => {
      await page.locator('.tree-row--file', { hasText: 'Index.md' }).click()
      await runCommand('note.toggleBookmark')
      await runCommand('view.toggleBookmarks')
      await expect(page.locator('.bookmarks__row').first()).toBeVisible({ timeout: 15_000 })
    },
    close: async () => {
      await page.locator('.bookmarks__drop').first().click()
      await runCommand('view.toggleOutline')
      await expect(page.locator('.outline-filter__input')).toBeVisible()
    }
  },
  {
    // The panel, with a change staged and unstaged, so both groups and the
    // commit box carry text.
    name: 'source control',
    root: '.scm',
    open: async () => {
      await runCommand('view.toggleGit')
      await expect(page.locator('.scm-row__name', { hasText: 'lexer.ts' })).toBeVisible({
        timeout: 15_000
      })
      // Staged, so the commit box is live rather than the disabled placeholder
      // it shows with nothing to commit — both states have text, but only the
      // enabled one is what the panel looks like in use.
      await page.locator('[aria-label^="Stage "]').first().click()
      const message = page.locator('.scm__message')
      await expect(message).toBeEnabled({ timeout: 10_000 })
      await message.fill('a commit message')
    },
    close: async () => {
      await page.locator('.scm__message').fill('')
      await page.locator('[aria-label^="Unstage "]').first().click()
      await expect(page.locator('[aria-label^="Stage "]').first()).toBeVisible({ timeout: 10_000 })
      // Both views put back: source control leaves the sidebar off the file
      // tree, and the workspace surface every later theme opens first types
      // into that tree's filter.
      await showFiles()
      await showOutline()
    }
  },
  {
    // Both panes of the diff: line numbers, the change tints, and the hatched
    // filler that stands in for lines the other side does not have.
    name: 'diff editor',
    root: '.diff',
    open: async () => {
      await runCommand('view.toggleGit')
      await page.locator('.scm-row__name', { hasText: 'lexer.ts' }).first().click()
      await expect(page.locator('.diff__panes')).toBeVisible({ timeout: 15_000 })
      await expect(page.locator('.cm-or-diff-line--new').first()).toBeVisible()
    },
    close: async () => {
      await page.locator('.diff button[aria-label="Close"]').click()
      // Reached through source control, so this leaves the sidebar on it too.
      await showFiles()
      await showOutline()
    }
  },
  {
    // The panel's own chrome only. What a shell prints is coloured by the
    // shell, against a background this app chooses — auditing that would be
    // auditing someone else's palette and failing on it.
    name: 'terminal',
    root: '.term-panel__bar',
    open: async () => {
      await runCommand('view.toggleTerminal')
      await expect(page.locator('.term-panel')).toBeVisible({ timeout: 15_000 })
    },
    close: async () => {
      await page.locator('.term-panel button[aria-label="Close terminal"]').click()
      await expect(page.locator('.term-panel')).toBeHidden()
    }
  },
  {
    name: 'media viewer',
    root: '.media-viewer__frame',
    open: async () => {
      await openDiagramNote()
      await page.locator('.cm-or-mermaid .cm-or-expand').click()
      await expect(page.locator('.media-viewer__frame')).toBeVisible()
      await expect(page.locator('.media-viewer__content svg')).toBeVisible({ timeout: 20_000 })
    },
    close: async () => {
      await page.keyboard.press('Escape')
      await expect(page.locator('.media-viewer__frame')).toBeHidden()
      await closeDiagramNote()
    }
  }
]

/** Switch palette. Settings reach the renderer on reload, as openVault does. */
async function useTheme(
  id: string,
  appearance: 'light' | 'dark',
  highContrastCode = false
): Promise<void> {
  await page.evaluate(
    async ([themeId, mode, hc]) => {
      const current = await window.orrery.invoke('settings:get', undefined)
      await window.orrery.invoke('settings:set', {
        ...current,
        theme: mode,
        highContrastCode: hc === 'on',
        lightTheme: mode === 'light' ? themeId : current.lightTheme,
        darkTheme: mode === 'dark' ? themeId : current.darkTheme
      })
    },
    [id, appearance, highContrastCode ? 'on' : 'off']
  )
  await page.reload()
  await page.waitForSelector('.app', { timeout: 30_000 })
  await page.locator('.tree-row--file', { hasText: 'Index.md' }).click()
  await expect(page.locator('.tree-row--active')).toBeVisible({ timeout: 10_000 })
  await page.waitForTimeout(400)
  await expect
    .poll(() => page.evaluate(() => document.documentElement.getAttribute('data-theme')))
    .toBe(id)
}

for (const [id, appearance] of THEMES) {
  test(`UI text meets WCAG AA in ${id}`, async () => {
    await useTheme(id, appearance)

    const fails: Fail[] = []
    for (const surface of SURFACES) {
      await surface.open()
      const scan = await contrastFailures(surface.root)
      expect(scan.scanned, `${surface.name} has text to measure`).toBeGreaterThan(0)
      const found = [...scan.fails, ...(surface.hidden ? await surface.hidden() : [])]
      for (const fail of found) fails.push({ surface: surface.name, ...fail })
      await surface.close()
    }

    // Syntax highlighting is held out, and counted out loud rather than
    // quietly dropped. Those seven colours per theme are the upstream
    // palettes — Dracula's comment grey, Nord's cyan — and 26 of the 28 themes
    // ship at least one under AA, seven of them all seven. Repainting them to
    // clear 4.5:1 would mean these no longer look like the themes they are
    // named after, which is a product decision rather than a defect to fix
    // behind a test.
    const code = fails.filter((f) => f.code)
    const chrome = fails.filter((f) => !f.code)
    if (code.length) {
      console.log(
        `${id}: ${code.length} syntax-highlighting token(s) under AA, worst ` +
          `${Math.min(...code.map((c) => c.ratio))}:1 — held out by design`
      )
    }
    expect(chrome, JSON.stringify(chrome, null, 1)).toHaveLength(0)
  })
}

test('high-contrast code makes the worst palette readable', async () => {
  // Ayu Light is the sharpest case: as published, every one of its seven code
  // colours is under AA and its `function` colour sits at 1.78:1.
  await useTheme('ayu-light', 'light')
  const before = (await contrastFailures('.app')).fails.filter((f) => f.code)
  expect(before.length, 'the default keeps the palette as published').toBeGreaterThan(0)

  await useTheme('ayu-light', 'light', true)
  const after = (await contrastFailures('.app')).fails.filter((f) => f.code)
  expect(after, JSON.stringify(after, null, 1)).toHaveLength(0)

  // ...and it is the code that changed, not the rest of the UI.
  const chrome = (await contrastFailures('.app')).fails.filter((f) => !f.code)
  expect(chrome, JSON.stringify(chrome, null, 1)).toHaveLength(0)

  await useTheme('zinc-light', 'light')
})

test('every control is reachable and named', async () => {
  const unnamed: (Target & { surface: string })[] = []
  const tooSmall: (Target & { surface: string })[] = []
  let counted = 0

  for (const surface of SURFACES) {
    await surface.open()
    const found = await controls(surface.root)
    expect(found.length, `${surface.name} has controls to measure`).toBeGreaterThan(0)
    counted += found.length
    for (const target of found) {
      // Naming is asked of buttons and links only: a form control is named by
      // the label around it, and auditing those is a different criterion.
      if (target.namable && !target.named && !target.label) {
        unnamed.push({ surface: surface.name, ...target })
      }
      // 2.5.8 exempts a target whose size is set by the line-height of the text
      // around it: a task checkbox drawn into a line of prose is that case, and
      // growing it to 24px would push the line it belongs to apart.
      if (!target.reach && !target.inline) tooSmall.push({ surface: surface.name, ...target })
    }
    await surface.close()
  }

  expect(counted).toBeGreaterThan(8)
  // Soft, so one run reports every control it has something to say about
  // rather than stopping at the first kind of fault.
  expect.soft(unnamed, JSON.stringify(unnamed, null, 1)).toHaveLength(0)
  expect.soft(tooSmall, JSON.stringify(tooSmall, null, 1)).toHaveLength(0)
})
