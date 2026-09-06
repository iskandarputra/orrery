/**
 * Draw `build/icon.png` from the mark the application itself shows.
 *
 * The window icon and the mark in the interface used to be two drawings of the
 * same idea, kept in step by hand, and they had already drifted: the icon was a
 * letter from a name the app no longer has. So there is one drawing now,
 * `components/Logo.tsx`, and this turns it into the PNG electron-builder wants.
 *
 * Rendered by Electron because Electron is what the project already installs,
 * and because the icon should be drawn by the same engine that draws the mark
 * in the app. There is no separate rasteriser to keep working.
 *
 * It writes two files. `build/icon.png` is what electron-builder packages, and
 * `docs/logo.png` is what the README shows, so the mark in the readme cannot
 * drift from the mark in the app either.
 *
 *   node scripts/make-icon.mjs            # build/icon.png and docs/logo.png
 *   node scripts/make-icon.mjs --sheet    # also a contact sheet, for looking
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * The mark, lifted out of the component that renders it.
 *
 * JSX and SVG differ in three ways that matter here and in no others: JSX
 * comments, camel-cased attribute names, and the `{size}` expressions on the
 * root element. Anything else appearing in `Logo.tsx` is a reason to look at
 * this again rather than to widen the rules.
 */
function markFromComponent() {
  const source = readFileSync(join(root, 'src/renderer/src/components/Logo.tsx'), 'utf-8')
  const start = source.indexOf('    <svg')
  const end = source.indexOf('    </svg>')
  if (start === -1 || end === -1) throw new Error('Logo.tsx no longer contains a plain <svg> block')

  return source
    .slice(start, end + '    </svg>'.length)
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\bwidth=\{size\}/, 'width="512"')
    .replace(/\bheight=\{size\}/, 'height="512"')
    .replace(/\bstopColor=/g, 'stop-color=')
    .replace(/\bstrokeOpacity=/g, 'stroke-opacity=')
    .replace(/\bstrokeWidth=/g, 'stroke-width=')
    .replace(/\bstrokeLinecap=/g, 'stroke-linecap=')
    .replace(/\bstrokeLinejoin=/g, 'stroke-linejoin=')
    .replace(/\bfillOpacity=/g, 'fill-opacity=')
    .trim()
}

const svg = markFromComponent()
if (/\{|\}/.test(svg)) throw new Error(`the mark still holds a JSX expression:\n${svg}`)

const sheet = process.argv.includes('--sheet')
const work = mkdtempSync(join(tmpdir(), 'orrery-icon-'))

// `overflow:hidden` and a block-level svg are not tidiness: without them the
// page scrolls, and a capture of a scrolling page bakes the scrollbars into the
// icon. The first run of this produced a 512px PNG with grey furniture down two
// edges of it.
const page = `<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;padding:0;background:transparent;overflow:hidden}
svg{display:block}</style>
${svg}`
writeFileSync(join(work, 'icon.html'), page)

const contact = `<!doctype html><meta charset="utf-8">
<style>
 html,body{overflow:hidden}
 body{margin:0;background:#e9eaee;display:flex;gap:26px;align-items:flex-end;padding:22px;
      font:11px system-ui,sans-serif;color:#555}
 svg{display:block}
 figure{margin:0;text-align:center} figcaption{margin-top:8px}
 .dark{background:#16181d;padding:16px;border-radius:10px;color:#aaa}
</style>
${[160, 96, 64, 48, 32, 16]
  .map(
    (s) =>
      `<figure>${svg.replace('width="512"', `width="${s}"`).replace('height="512"', `height="${s}"`)}<figcaption>${s}px</figcaption></figure>`
  )
  .join('')}
<figure class="dark">${svg.replace('width="512"', 'width="64"').replace('height="512"', 'height="64"')}<figcaption>on dark</figcaption></figure>`
writeFileSync(join(work, 'sheet.html'), contact)

/** A one-off Electron process that opens a page, captures it, and quits. */
const capture = `
const { app, BrowserWindow } = require('electron')
const { writeFileSync } = require('node:fs')
const [page, out, w, h] = process.argv.slice(2)
app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: Number(w), height: Number(h), show: false, frame: false,
    transparent: true, backgroundColor: '#00000000',
    webPreferences: { offscreen: true }
  })
  await win.loadFile(page)
  // A frame has to be produced before there is anything to capture.
  await new Promise((r) => setTimeout(r, 400))
  writeFileSync(out, (await win.webContents.capturePage()).toPNG())
  app.exit(0)
})
`
writeFileSync(join(work, 'capture.cjs'), capture)

const electron = join(root, 'node_modules/electron/dist/electron')

function shoot(pageFile, out, w, h) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      electron,
      [join(work, 'capture.cjs'), join(work, pageFile), out, String(w), String(h)],
      { stdio: 'inherit', env: { ...process.env, ELECTRON_DISABLE_SANDBOX: '1' } }
    )
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`electron exited ${code}`))
    )
  })
}

await shoot('icon.html', join(root, 'build/icon.png'), 512, 512)
console.log('wrote build/icon.png (512x512)')

// The readme's copy, drawn at the size it is shown at rather than scaled down
// by the browser: a 512px mark displayed at 128 is four times the bytes and
// softer than one drawn at 256 for a retina screen.
const readme = `<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;padding:0;background:transparent;overflow:hidden}
svg{display:block}</style>
${svg.replace('width="512"', 'width="256"').replace('height="512"', 'height="256"')}`
writeFileSync(join(work, 'readme.html'), readme)
await shoot('readme.html', join(root, 'docs/logo.png'), 256, 256)
console.log('wrote docs/logo.png (256x256)')
if (sheet) {
  const out = join(work, 'sheet.png')
  await shoot('sheet.html', out, 760, 230)
  console.log(`wrote ${out}`)
}
