/**
 * Copy Excalidraw's fonts into the renderer's public directory.
 *
 * Excalidraw fetches its handwriting fonts at runtime and falls back to a CDN
 * when it cannot find them locally — which for an offline desktop app means a
 * request that simply fails. Copying them next to index.html and pointing
 * EXCALIDRAW_ASSET_PATH there keeps the drawing surface working with no network.
 *
 * Derived from node_modules, so the output is generated rather than committed,
 * and regenerated before every dev run and build.
 */
import { cp, mkdir, readdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const from = join(root, 'node_modules/@excalidraw/excalidraw/dist/prod/fonts')
const to = join(root, 'src/renderer/public/fonts')

/**
 * 13 MB of the 14 MB is one CJK handwriting face. Excalidraw loads fonts by
 * family on demand, so leaving it out costs nothing until someone types CJK in
 * a drawing — and then it renders in a system font rather than the handwriting
 * one, instead of adding a tenth to the installer for everyone.
 */
const SKIP = new Set(['Xiaolai'])

if (!existsSync(from)) {
  console.log('sync-assets: no Excalidraw fonts found; skipping')
  process.exit(0)
}

await rm(to, { recursive: true, force: true })
await mkdir(to, { recursive: true })
for (const entry of await readdir(from, { withFileTypes: true })) {
  if (!entry.isDirectory() || SKIP.has(entry.name)) continue
  await cp(join(from, entry.name), join(to, entry.name), { recursive: true })
}
console.log('sync-assets: Excalidraw fonts copied')
