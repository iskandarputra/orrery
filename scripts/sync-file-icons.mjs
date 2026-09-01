/**
 * Fetch the file-type icons the tree draws.
 *
 * Orrery used to draw its own: nine stroke glyphs and a colour per language,
 * which meant Python, C, C++ and TypeScript were the same picture in four
 * shades. At the size a file tree renders, that is a list of identical files.
 *
 * These come from the Material Icon Theme, which is MIT-licensed and — unlike
 * a logo set drawn for documentation — designed for exactly this: sixteen
 * pixels, flat colour, legible in a row of forty siblings.
 *
 * Only the icons actually named in `ICONS` are vendored, and they are committed
 * to the repository. So a build never reaches the network, an offline clone
 * works, and the whole set is about sixty kilobytes rather than the nine
 * hundred icons upstream carries. Run this by hand when the list changes:
 *
 *     node scripts/sync-file-icons.mjs
 *
 * Pinned to a release rather than a branch, so running it twice gives the same
 * icons twice.
 */
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const VERSION = 'v5.38.1'
const REPO = 'PKief/vscode-material-icon-theme'
const OUT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'src',
  'renderer',
  'src',
  'assets',
  'file-icons'
)

/**
 * Every icon the tree can draw, by its upstream name.
 *
 * Which file gets which is `src/core/file-icons.ts`; this list only has to be a
 * superset of what that names, and the check at the end says so when it is not.
 */
const ICONS = [
  // Languages
  'python',
  'typescript',
  'javascript',
  'react',
  'react_ts',
  'c',
  'cpp',
  'csharp',
  'rust',
  'go',
  'java',
  'kotlin',
  'swift',
  'ruby',
  'php',
  'lua',
  'r',
  'dart',
  'elixir',
  'haskell',
  'scala',
  'zig',
  'vim',
  // Shells and things you run
  'console',
  'powershell',
  'makefile',
  'docker',
  'exe',
  // Markup, styles and the web
  'html',
  'css',
  'sass',
  'less',
  'vue',
  'svelte',
  'svg',
  'xml',
  'nodejs',
  // Data and configuration
  'json',
  'yaml',
  'toml',
  'database',
  'table',
  'settings',
  'lock',
  'key',
  'tsconfig',
  'npm',
  'git',
  'prettier',
  'eslint',
  // Documents
  'markdown',
  'document',
  'readme',
  'license',
  'todo',
  'log',
  'pdf',
  // Opaque things
  'image',
  'video',
  'audio',
  'font',
  'zip',
  // Orrery's own
  'excalidraw',
  // Folders
  'folder-base',
  'folder-src',
  'folder-node',
  'folder-git',
  'folder-docs',
  'folder-test',
  'folder-dist',
  'folder-images',
  'folder-config',
  'folder-scripts',
  'folder-public',
  'folder-github',
  'folder-vscode'
]

const raw = (path) => `https://raw.githubusercontent.com/${REPO}/${VERSION}/${path}`

async function fetchText(url) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`)
  return response.text()
}

/**
 * Strip what a build does not need.
 *
 * Upstream ships each icon with an XML namespace and, on some, an empty
 * transparent square that exists to pad the icon in a menu. Both are dead
 * weight in a bundle that inlines seventy of these.
 */
function tidy(svg) {
  return svg
    .replace(/\s*xmlns(:xlink)?="[^"]*"/g, '')
    .replace(/\s*xml:space="[^"]*"/g, '')
    .replace(/<path d="M0 0h24v24H0z"\s*\/>/g, '')
    .replace(/>\s+</g, '><')
    .trim()
}

await rm(OUT, { recursive: true, force: true })
await mkdir(OUT, { recursive: true })

let bytes = 0
for (const name of ICONS) {
  const svg = tidy(await fetchText(raw(`icons/${name}.svg`)))
  if (!svg.startsWith('<svg')) throw new Error(`${name} did not come back as an SVG`)
  await writeFile(join(OUT, `${name}.svg`), `${svg}\n`, 'utf-8')
  bytes += svg.length
}

// Kept beside the icons, because that is where somebody looks for it.
await writeFile(join(OUT, 'LICENSE'), await fetchText(raw('LICENSE')), 'utf-8')

const written = (await readdir(OUT)).filter((f) => f.endsWith('.svg'))
if (written.length !== ICONS.length) throw new Error('not every icon was written')
console.log(
  `${written.length} icons from Material Icon Theme ${VERSION}, ${(bytes / 1024).toFixed(1)} kB`
)
