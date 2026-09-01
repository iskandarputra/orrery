import { describe, expect, it } from 'vitest'
import { BRAND_ICONS, fileIcon, folderIcon } from '@core/file-icons'
import { hasMark } from './FileIcon'

/**
 * The two halves of a file's icon have to agree.
 *
 * `core/file-icons.ts` names a mark; `assets/file-icons` holds it. Nothing
 * connects them but the string, so a mark renamed upstream — or a name added to
 * the list without running `scripts/sync-file-icons.mjs` — would be a blank
 * space in the tree and nothing else would say so.
 */
describe('every mark that can be named is one that exists', () => {
  it('has a vendored icon for every name in the list', () => {
    const missing = BRAND_ICONS.filter((name) => !hasMark(name))
    expect(missing).toEqual([])
    expect(BRAND_ICONS.length).toBeGreaterThan(60)
  })

  it('resolves the ones a real repository is full of', () => {
    for (const file of [
      'train.py',
      'main.c',
      'engine.cpp',
      'index.ts',
      'App.tsx',
      'deploy.sh',
      'build.log',
      'Dockerfile',
      'package.json',
      'notes.pdf',
      'photo.png'
    ]) {
      const brand = fileIcon(file).brand
      expect(brand, file).not.toBeNull()
      expect(hasMark(brand!), `${file} -> ${brand}`).toBe(true)
    }
  })

  it('resolves every folder, including the plain one', () => {
    for (const folder of ['src', 'node_modules', '.git', 'docs', 'e2e', 'anything else']) {
      expect(hasMark(folderIcon(folder)), folder).toBe(true)
    }
  })
})
