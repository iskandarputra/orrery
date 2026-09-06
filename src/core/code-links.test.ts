import { describe, expect, it } from 'vitest'
import { findImports, importsFamily, indexImports, resolveImport } from './code-links'

const specs = (content: string, file: string): string[] =>
  findImports(content, file).map((entry) => entry.spec)

describe('findImports', () => {
  it('reads every shape a JavaScript import takes', () => {
    const source = [
      "import { a } from './a'",
      "import b from '../b'",
      "import 'side-effect'",
      "export { c } from './c'",
      "const d = require('./d')",
      "const e = await import('./e')"
    ].join('\n')
    expect(specs(source, '/v/app.ts')).toEqual(['./a', '../b', 'side-effect', './c', './d', './e'])
  })

  it('reads Python, both spellings', () => {
    const source = 'import os\nfrom .store import Store\nfrom ..lib.util import x\n'
    // In the order the file states them, which is the order they are read in.
    expect(specs(source, '/v/app.py')).toEqual(['os', '.store', '..lib.util'])
  })

  it('reads Rust modules and uses', () => {
    expect(specs('mod pane;\npub mod tabs;\nuse crate::editor::view;\n', '/v/main.rs')).toEqual([
      'pane',
      'tabs',
      'crate::editor::view'
    ])
  })

  it('reads a Go import block, where the lines have no keyword', () => {
    const source = 'package main\n\nimport (\n\t"fmt"\n\t"myapp/store"\n)\n\nfunc main() {}\n'
    expect(specs(source, '/v/main.go')).toEqual(['fmt', 'myapp/store'])
  })

  it('does not read every quoted string in a Go file as an import', () => {
    const source = 'package main\n\nfunc main() {\n\tprintln("not an import")\n}\n'
    expect(specs(source, '/v/main.go')).toEqual([])
  })

  it('reads a quoted C include but not a system one', () => {
    // Angle brackets are the toolchain's business, not the vault's.
    expect(specs('#include "buffer.h"\n#include <stdio.h>\n', '/v/main.c')).toEqual(['buffer.h'])
  })

  it('reads Ruby, the JVM languages, PHP and stylesheets', () => {
    expect(specs("require_relative 'store'\n", '/v/app.rb')).toEqual(['store'])
    expect(specs('import com.acme.Widget;\n', '/v/App.java')).toEqual(['com.acme.Widget'])
    expect(specs("require_once 'db.php';\n", '/v/app.php')).toEqual(['db.php'])
    expect(specs("@import 'tokens';\n", '/v/main.scss')).toEqual(['tokens'])
  })

  it('ignores an import that has been commented out', () => {
    // The outline scanner learned this one the hard way.
    const source = "// import { old } from './old'\nimport { new1 } from './new'\n"
    expect(specs(source, '/v/app.ts')).toEqual(['./new'])
  })

  it('ignores imports written inside a block comment or a docstring', () => {
    const js = "/*\nimport { a } from './a'\n*/\nimport { b } from './b'\n"
    expect(specs(js, '/v/app.ts')).toEqual(['./b'])

    const py = '"""\nfrom .ghost import x\n"""\nfrom .real import y\n'
    expect(specs(py, '/v/app.py')).toEqual(['.real'])
  })

  it('lists a target once however often it is imported', () => {
    const source = "import { a } from './x'\nimport { b } from './x'\n"
    expect(specs(source, '/v/app.ts')).toEqual(['./x'])
  })

  it('has nothing to say about a file it cannot read', () => {
    expect(findImports('# Notes\n\nSome prose.\n', '/v/note.md')).toEqual([])
    expect(importsFamily('/v/note.md')).toBe(false)
    expect(importsFamily('/v/app.tsx')).toBe(true)
  })

  it('reports the line, so a graph can send someone to it', () => {
    const source = "// header\n\nimport { a } from './a'\n"
    expect(findImports(source, '/v/app.ts')).toEqual([{ spec: './a', line: 3 }])
  })
})

describe('resolveImport', () => {
  const files = [
    '/v/src/app.ts',
    '/v/src/editor/pane.ts',
    '/v/src/editor/index.ts',
    '/v/src/store.tsx',
    '/v/src/style.css',
    '/v/lib/util.py',
    '/v/lib/store/__init__.py',
    '/v/main.rs',
    '/v/pane.rs'
  ]

  it('follows a relative import and adds the extension it left off', () => {
    expect(resolveImport('/v/src/app.ts', './editor/pane', indexImports(files))).toEqual({
      status: 'resolved',
      to: '/v/src/editor/pane.ts',
      ambiguous: false
    })
    expect(resolveImport('/v/src/app.ts', './store', indexImports(files))).toEqual({
      status: 'resolved',
      to: '/v/src/store.tsx',
      ambiguous: false
    })
  })

  it('follows one that climbs out of its folder', () => {
    expect(resolveImport('/v/src/editor/pane.ts', '../app', indexImports(files))).toEqual({
      status: 'resolved',
      to: '/v/src/app.ts',
      ambiguous: false
    })
  })

  it('falls back to the folder’s index file', () => {
    expect(resolveImport('/v/src/app.ts', './editor', indexImports(files))).toEqual({
      status: 'resolved',
      to: '/v/src/editor/index.ts',
      ambiguous: false
    })
  })

  it('reads Python’s dots as directories', () => {
    expect(resolveImport('/v/lib/util.py', '.store', indexImports(files))).toEqual({
      status: 'resolved',
      to: '/v/lib/store/__init__.py',
      ambiguous: false
    })
  })

  it('matches a package path by its last segment when only one file could be it', () => {
    // `pane.ts` shares the name and is not a candidate: a Rust crate path
    // cannot mean a TypeScript file.
    expect(resolveImport('/v/main.rs', 'crate::pane', indexImports(files))).toEqual({
      status: 'resolved',
      to: '/v/pane.rs',
      ambiguous: false
    })
  })

  it('refuses to guess between two files with the same name', () => {
    // A wrong edge in a map is worse than a missing one.
    const ambiguous = [...files, '/v/other/pane.rs']
    expect(resolveImport('/v/main.rs', 'crate::pane', indexImports(ambiguous))).toEqual({
      status: 'ambiguous',
      candidates: ['/v/pane.rs', '/v/other/pane.rs']
    })
  })

  it('tells a package apart from a relative import that resolves nowhere', () => {
    expect(resolveImport('/v/src/app.ts', 'react', indexImports(files))).toEqual({
      status: 'external'
    })
    expect(resolveImport('/v/src/app.ts', './nowhere', indexImports(files))).toEqual({
      status: 'missing',
      at: '/v/src/nowhere'
    })
  })

  it('does not mistake a relative path for a package name', () => {
    expect(resolveImport('/v/src/app.ts', './style.css', indexImports(files))).toEqual({
      status: 'resolved',
      to: '/v/src/style.css',
      ambiguous: false
    })
  })
})

describe('what kind of unresolved', () => {
  const files = ['/v/src/app.ts', '/v/src/store.tsx']

  it('calls a package external, not missing', () => {
    expect(resolveImport('/v/src/app.ts', 'react', indexImports(files))).toEqual({
      status: 'external'
    })
  })

  it('calls a relative path that resolves nowhere missing, and says where', () => {
    // Renaming a file breaks every relative import naming it. That used to
    // share a `continue` with `react`, so the app could not tell a broken
    // import from a dependency it was never going to draw.
    expect(resolveImport('/v/src/app.ts', './editorr', indexImports(files))).toEqual({
      status: 'missing',
      at: '/v/src/editorr'
    })
  })

  it('still refuses to choose between two files of the same name', () => {
    const ambiguous = ['/v/a/pane.rs', '/v/b/pane.rs', '/v/main.rs']
    expect(resolveImport('/v/main.rs', 'crate::pane', indexImports(ambiguous))).toEqual({
      status: 'ambiguous',
      candidates: ['/v/a/pane.rs', '/v/b/pane.rs']
    })
  })
})
