import { describe, expect, it } from 'vitest'
import { fileIcon, folderIcon } from './file-icons'

describe('by extension', () => {
  it('gives a language its own colour', () => {
    expect(fileIcon('main.ts')).toEqual({
      shape: 'braces',
      colour: '#3178c6',
      brand: 'typescript'
    })
    expect(fileIcon('main.rs').colour).toBe('#dea584')
    expect(fileIcon('main.go').colour).toBe('#00add8')
  })

  it('groups by the kind of thing a file is', () => {
    expect(fileIcon('a.html').shape).toBe('angle')
    expect(fileIcon('a.json').shape).toBe('brackets')
    expect(fileIcon('a.sh').shape).toBe('terminal')
    expect(fileIcon('a.png').shape).toBe('image')
    expect(fileIcon('a.zip').shape).toBe('binary')
  })

  it('leaves prose uncoloured, so the coloured ones stand out', () => {
    expect(fileIcon('Note.md')).toEqual({
      shape: 'file-text',
      colour: null,
      brand: 'markdown'
    })
  })

  it('ignores case', () => {
    expect(fileIcon('MAIN.TS').colour).toBe('#3178c6')
  })

  it('reads the last extension, so a.test.ts is TypeScript', () => {
    expect(fileIcon('parser.test.ts').shape).toBe('braces')
    expect(fileIcon('bundle.tar.gz').shape).toBe('binary')
  })
})

describe('by whole name', () => {
  it('recognises files whose name says more than their extension', () => {
    // "package.json" says more about a project than "some JSON" does.
    expect(fileIcon('package.json').colour).toBe('#8bc500')
    expect(fileIcon('tsconfig.json').colour).toBe('#3178c6')
    expect(fileIcon('a.json').colour).toBe('#cbcb41')
  })

  it('recognises files that have no extension at all', () => {
    expect(fileIcon('Dockerfile').shape).toBe('terminal')
    expect(fileIcon('Makefile').shape).toBe('terminal')
    expect(fileIcon('LICENSE').shape).toBe('file-text')
  })

  it('recognises a dotfile as its whole name', () => {
    // `.gitignore` has no extension: the leading dot is not a separator.
    expect(fileIcon('.gitignore').colour).toBe('#f14e32')
  })
})

describe('anything else', () => {
  it('falls back to a plain file', () => {
    expect(fileIcon('mystery.qqq')).toEqual({ shape: 'file', colour: null, brand: null })
    expect(fileIcon('noextension')).toEqual({ shape: 'file', colour: null, brand: null })
    expect(fileIcon('')).toEqual({ shape: 'file', colour: null, brand: null })
  })

  it('does not read a leading dot as an extension', () => {
    expect(fileIcon('.hidden')).toEqual({ shape: 'file', colour: null, brand: null })
  })
})

describe('the language’s own mark', () => {
  it('tells apart the languages the house glyphs could not', () => {
    // The complaint this answers: all five of these were `braces` in a
    // different shade, which in a tree of siblings is a list of identical files.
    expect(fileIcon('train.py').brand).toBe('python')
    expect(fileIcon('main.c').brand).toBe('c')
    expect(fileIcon('engine.cpp').brand).toBe('cpp')
    expect(fileIcon('index.ts').brand).toBe('typescript')
    expect(fileIcon('lib.rs').brand).toBe('rust')
    expect(
      new Set([fileIcon('train.py'), fileIcon('main.c'), fileIcon('index.ts')].map((i) => i.shape))
        .size
    ).toBe(1)
  })

  it('covers the things a repository is actually full of', () => {
    expect(fileIcon('deploy.sh').brand).toBe('console')
    expect(fileIcon('build.log').brand).toBe('log')
    expect(fileIcon('Dockerfile').brand).toBe('docker')
    expect(fileIcon('docker-compose.yml').brand).toBe('docker')
    expect(fileIcon('.gitignore').brand).toBe('git')
    expect(fileIcon('Makefile').brand).toBe('makefile')
    expect(fileIcon('notes.pdf').brand).toBe('pdf')
    expect(fileIcon('board.excalidraw').brand).toBe('excalidraw')
  })

  it('reads a whole name ahead of its extension', () => {
    // Both are JSON; only one of them is what npm reads.
    expect(fileIcon('package.json').brand).toBe('npm')
    expect(fileIcon('tsconfig.json').brand).toBe('tsconfig')
    expect(fileIcon('data.json').brand).toBe('json')
  })

  it('leaves a file it does not know without one', () => {
    expect(fileIcon('mystery.qqq').brand).toBeNull()
    expect(fileIcon('noextension').brand).toBeNull()
  })

  it('keeps the house glyph underneath, for anywhere a mark cannot go', () => {
    // The stroke set is still what is drawn when the mark is missing, so every
    // file has an answer even if the vendored icons were not there at all.
    expect(fileIcon('train.py').shape).toBe('braces')
    expect(fileIcon('deploy.sh').shape).toBe('terminal')
  })
})

describe('folders', () => {
  it('gives the ones worth telling apart their own mark', () => {
    expect(folderIcon('src')).toBe('folder-src')
    expect(folderIcon('node_modules')).toBe('folder-node')
    expect(folderIcon('.git')).toBe('folder-git')
    expect(folderIcon('docs')).toBe('folder-docs')
    expect(folderIcon('e2e')).toBe('folder-test')
    expect(folderIcon('dist')).toBe('folder-dist')
    expect(folderIcon('scripts')).toBe('folder-scripts')
  })

  it('leaves the rest plain, because a mark on every row is a mark on none', () => {
    expect(folderIcon('my notes')).toBe('folder-base')
    expect(folderIcon('Recipes')).toBe('folder-base')
  })

  it('ignores case', () => {
    expect(folderIcon('SRC')).toBe('folder-src')
  })
})
