/**
 * Copy the runtime data files third-party viewers fetch for themselves.
 *
 * Excalidraw's handwriting fonts and pdf.js's character maps, standard fonts
 * and wasm decoders are all loaded by URL at runtime rather than imported, so a
 * bundler never sees them. Both libraries fall back to a CDN or to failing
 * silently, which for an offline desktop app means blank pages.
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

/**
 * pdf.js's runtime data, beside index.html as `pdfjs/`.
 *
 * `cmaps` are the predefined character maps CJK documents encode their text
 * with; `standard_fonts` are the fourteen faces a PDF may name without
 * embedding, which pdf.js otherwise substitutes with whatever the system has;
 * `wasm` holds the JBIG2, JPEG 2000 and colour-management decoders that scans
 * are full of. Each degrades quietly when it is missing — a substituted font,
 * an undecodable image, text that does not appear — so they are bundled rather
 * than fetched or hoped for.
 */
const pdfjs = join(root, 'node_modules/pdfjs-dist')
const pdfjsTo = join(root, 'src/renderer/public/pdfjs')
if (!existsSync(pdfjs)) {
  console.log('sync-assets: no pdfjs-dist found; skipping')
} else {
  await rm(pdfjsTo, { recursive: true, force: true })
  await mkdir(pdfjsTo, { recursive: true })
  for (const dir of ['cmaps', 'standard_fonts', 'wasm']) {
    const source = join(pdfjs, dir)
    if (existsSync(source)) await cp(source, join(pdfjsTo, dir), { recursive: true })
  }
  await cp(join(pdfjs, 'LICENSE'), join(pdfjsTo, 'LICENSE'))
  console.log('sync-assets: pdf.js cmaps, standard fonts and wasm copied')
}

/**
 * Tesseract's engine and its English training data, as `tesseract/`.
 *
 * All three parts of an OCR run are fetched from a CDN by default — the worker
 * script, the wasm engine and the language data — which for an app that has to
 * work on a train is three ways to fail. Bundled instead: about seven
 * megabytes, none of it loaded until somebody asks to recognise a page.
 *
 * The `_best_int` training data rather than the standard one: a third of the
 * size for the same alphabet, and the difference in accuracy on a page of
 * printed text does not justify eight more megabytes in the installer.
 */
const tessTo = join(root, 'src/renderer/public/tesseract')
const tessParts = [
  ['node_modules/tesseract.js/dist/worker.min.js', 'worker.min.js'],
  // One engine, named exactly, rather than the six the library would pick
  // between at runtime. SIMD has been in every Chromium since 2021 and this app
  // ships its own; the relaxed-SIMD build is a little faster and another four
  // megabytes, which is not a trade worth making for a feature most vaults
  // never use. The `.wasm.js` build carries its own wasm, so it is one file.
  [
    'node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js',
    'tesseract-core-simd-lstm.wasm.js'
  ],
  ['node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', 'eng.traineddata.gz']
]
if (!existsSync(join(root, tessParts[0][0]))) {
  console.log('sync-assets: no tesseract.js found; skipping')
} else {
  await rm(tessTo, { recursive: true, force: true })
  await mkdir(tessTo, { recursive: true })
  for (const [from, name] of tessParts) {
    const source = join(root, from)
    if (existsSync(source)) await cp(source, join(tessTo, name))
  }
  console.log('sync-assets: tesseract worker, engine and English data copied')
}
