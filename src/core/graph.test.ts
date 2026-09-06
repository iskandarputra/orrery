import { describe, expect, it } from 'vitest'
import { buildGraph, type GraphFile } from './graph'
import { resolveNote } from './notes'

const files = [
  { path: '/v/A.md', stem: 'A', content: 'links [[B]] and [[Ghost]] and [[B]] again' },
  { path: '/v/B.md', stem: 'B', content: 'back to [[a]]' },
  { path: '/v/C.md', stem: 'C', content: 'lonely' }
]

describe('buildGraph', () => {
  it('creates nodes for all notes plus ghosts, deduplicates edges', () => {
    const g = buildGraph(files)
    expect(g.nodes.map((n) => n.label).sort()).toEqual(['A', 'B', 'C', 'Ghost'])
    expect(g.edges).toHaveLength(3) // A→B (once), A→Ghost, B→A (case-insensitive)
    expect(g.nodes.find((n) => n.label === 'Ghost')?.exists).toBe(false)
  })

  it('computes degrees and ignores self-links', () => {
    const g = buildGraph([{ path: '/v/S.md', stem: 'S', content: '[[S]] [[T]]' }])
    expect(g.edges).toHaveLength(1)
    expect(g.nodes.find((n) => n.label === 'S')?.degree).toBe(1)
  })
})

describe('per-note facts', () => {
  it('counts words and records the folder relative to the vault root', () => {
    const g = buildGraph(
      [
        { path: '/v/notes/A.md', stem: 'A', content: 'three little words', mtimeMs: 42 },
        { path: '/v/B.md', stem: 'B', content: '' }
      ],
      '/v'
    )
    const a = g.nodes.find((n) => n.label === 'A')!
    expect(a).toMatchObject({ words: 3, folder: 'notes', mtimeMs: 42 })
    expect(g.nodes.find((n) => n.label === 'B')).toMatchObject({ folder: '', words: 0, mtimeMs: 0 })
  })

  it('leaves ghosts without note facts', () => {
    const g = buildGraph([{ path: '/v/A.md', stem: 'A', content: 'see [[Nowhere]]' }], '/v')
    expect(g.nodes.find((n) => n.label === 'Nowhere')).toMatchObject({
      exists: false,
      words: 0,
      mtimeMs: 0
    })
  })
})

describe('tags', () => {
  it("records each note's tags once", () => {
    const g = buildGraph(
      [{ path: '/v/A.md', stem: 'A', content: '#project notes about #rust and #rust again' }],
      '/v'
    )
    expect(g.nodes[0]!.tags).toEqual(['project', 'rust'])
  })

  it('leaves ghosts with no tags', () => {
    const g = buildGraph([{ path: '/v/A.md', stem: 'A', content: '[[Missing]] #real' }], '/v')
    expect(g.nodes.find((n) => !n.exists)!.tags).toEqual([])
  })
})

describe('code in the graph', () => {
  const mixed = [
    { path: '/v/notes/Editor.md', stem: 'Editor', content: 'About [[pane]] and [[Ghost]].' },
    {
      path: '/v/src/app.ts',
      stem: 'app',
      content: "import { view } from './pane'\nimport 'react'\n"
    },
    // The extension is written out, as it has to be for a stylesheet.
    { path: '/v/src/pane.ts', stem: 'pane', content: "import './style.css'\n" },
    { path: '/v/src/style.css', stem: 'style', content: 'body { color: red }' }
  ]

  it('draws an import as an edge between the two files', () => {
    const graph = buildGraph(mixed, '/v')
    const imports = graph.edges.filter((edge) => edge.kind === 'import')
    expect(imports).toEqual([
      { from: '/v/src/app.ts', to: '/v/src/pane.ts', kind: 'import', ambiguous: false },
      { from: '/v/src/pane.ts', to: '/v/src/style.css', kind: 'import', ambiguous: false }
    ])
  })

  it('leaves out a dependency that is not in the vault', () => {
    // `react` is real and is not part of this folder; drawing every package
    // would bury the map it is meant to be.
    const graph = buildGraph(mixed, '/v')
    expect(graph.nodes.map((node) => node.id)).not.toContain('react')
  })

  it('says which nodes are code and which are notes', () => {
    const graph = buildGraph(mixed, '/v')
    const kind = (id: string): string => graph.nodes.find((node) => node.id === id)?.kind ?? ''
    expect(kind('/v/notes/Editor.md')).toBe('note')
    expect(kind('/v/src/app.ts')).toBe('code')
    // A note that was linked to but never written is a note.
    expect(graph.nodes.find((node) => !node.exists)?.kind).toBe('note')
  })

  it('joins the two halves when a note links to a source file by name', () => {
    // This is the point of one map rather than two: `[[pane]]` in a note
    // reaches `pane.ts`, so the writing and the code are connected.
    const graph = buildGraph(mixed, '/v')
    expect(graph.edges).toContainEqual({
      from: '/v/notes/Editor.md',
      to: '/v/src/pane.ts',
      kind: 'link',
      ambiguous: false
    })
  })

  it('counts both kinds of edge in a node’s degree', () => {
    const graph = buildGraph(mixed, '/v')
    // `pane.ts` is imported by app.ts, imports style.css, and is linked from a
    // note: three.
    expect(graph.nodes.find((node) => node.id === '/v/src/pane.ts')?.degree).toBe(3)
  })

  it('has no import edges in a vault of pure prose', () => {
    const graph = buildGraph(files, '/v')
    expect(graph.edges.every((edge) => edge.kind === 'link')).toBe(true)
  })
})

describe('a repository-sized vault', () => {
  it('resolves imports without rescanning the vault for each one', () => {
    // The start-up hang, as a unit test. `resolveImport` took a plain array and
    // opened with `new Set(files)`, then scanned every file again for a bare
    // module name. Per import. On a real 3,700-file repository with tens of
    // thousands of imports that was 15.2 seconds inside `buildGraph`, and the
    // window was frozen for all of it because the scan runs in the main
    // process.
    //
    // The numbers below are deliberately smaller than that repository and the
    // ceiling deliberately far above what this actually takes (~0.3s), so a
    // busy core cannot fail it. Quadratic behaviour does not squeeze into it:
    // with the array version this same case takes over a minute.
    const files: GraphFile[] = []
    for (let i = 0; i < 4000; i++) {
      const imports = [
        `import { a } from './mod${(i + 1) % 4000}'`,
        `import { b } from './mod${(i + 7) % 4000}'`,
        "import React from 'react'",
        "import { join } from 'node:path'",
        `import { c } from 'some-package-${i % 40}'`
      ].join('\n')
      files.push({ path: `/v/src/mod${i}.ts`, stem: `mod${i}`, content: imports })
    }

    const started = performance.now()
    const g = buildGraph(files, '/v')
    const elapsed = performance.now() - started

    expect(g.nodes).toHaveLength(4000)
    // The two relative imports each resolve; the bare specifiers do not.
    expect(g.edges.filter((e) => e.kind === 'import')).toHaveLength(8000)
    expect(elapsed).toBeLessThan(10_000)
    console.log(`  buildGraph: 4000 files / ${g.edges.length} edges in ${Math.round(elapsed)}ms`)
  })
})

describe('two files with the same name', () => {
  // The archive copy comes second on purpose. The old index was a Map filled in
  // walk order, so last-wins landed on whichever came last, and with projects
  // last it agreed with the right answer by accident and the test below could
  // not fail. Ordered this way, last-wins picks archive and nearest picks
  // projects, which is the difference the test is there to see.
  const duplicates: GraphFile[] = [
    { path: '/v/projects/Store.md', stem: 'Store', content: '' },
    { path: '/v/archive/Store.md', stem: 'Store', content: '' },
    { path: '/v/projects/Plan.md', stem: 'Plan', content: 'see [[Store]]' }
  ]

  it('draws the edge to the file a click would open', () => {
    // The bug in one assertion. buildGraph kept the last stem match and
    // resolveNote took the first, so this link opened /v/archive/Store.md
    // while the map drew an edge to /v/projects/Store.md.
    const graph = buildGraph(duplicates, '/v')
    const drawn = graph.edges.find((e) => e.from === '/v/projects/Plan.md')!.to
    const opened = resolveNote(
      duplicates.map((f) => ({ path: f.path, stem: f.stem })),
      'Store',
      '/v/projects/Plan.md'
    )!.path
    expect(drawn).toBe(opened)
    expect(drawn).toBe('/v/projects/Store.md')
  })

  it('gives the same edge whichever order the walk found the files', () => {
    const forwards = buildGraph(duplicates, '/v').edges.find((e) => e.kind === 'link')!.to
    const backwards = buildGraph([...duplicates].reverse(), '/v').edges.find(
      (e) => e.kind === 'link'
    )!.to
    expect(backwards).toBe(forwards)
  })

  it('marks the edge as a choice between candidates', () => {
    const edge = buildGraph(duplicates, '/v').edges.find((e) => e.kind === 'link')!
    expect(edge.ambiguous).toBe(true)
  })

  it('leaves an unambiguous edge unmarked', () => {
    const graph = buildGraph(
      [
        { path: '/v/A.md', stem: 'A', content: '[[B]]' },
        { path: '/v/B.md', stem: 'B', content: '' }
      ],
      '/v'
    )
    expect(graph.edges[0]!.ambiguous).toBe(false)
  })
})
