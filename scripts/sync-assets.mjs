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
import { cp, mkdir, readdir, rm, writeFile } from 'node:fs/promises'
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
// The OFL requires its text and the copyright notices to travel with the font,
// so the shipped application carries them rather than only the repository.
await cp(join(root, 'licenses'), join(to, 'licenses'), { recursive: true })
await writeFile(
  join(to, 'LICENSES.md'),
  [
    '# Fonts bundled with Orrery drawings',
    '',
    'Excalifont — SIL OFL 1.1 — Copyright (c) 2024 Excalidraw. Excalifont is a trademark of Excalidraw.',
    'Virgil — SIL OFL 1.1 — Copyright (c) Excalidraw.',
    'Comic Shanns — MIT — Copyright (c) 2018 Shannon Miwa; 2023 Jesus Gonzalez; 2023 Rodrigo Batista de Moraes; 2024 Fini Jastrow; 2024 Kyle Beechly.',
    'Nunito, Assistant, Lilita One, Liberation — SIL OFL 1.1.',
    'Cascadia Code — SIL OFL 1.1 — Copyright (c) Microsoft Corporation.',
    '',
    'Full licence texts are in ./licenses. See THIRD-PARTY-NOTICES.md in the source repository.',
    ''
  ].join('\n')
)

console.log('sync-assets: Excalidraw fonts and their licences copied')
