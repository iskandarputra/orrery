import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The layering, enforced rather than described.
 *
 * An architecture that lives in a README is a suggestion. These are the rules
 * that make the codebase testable — `core` runs in a bare Node process, `main`
 * and `renderer` never reach into each other — and each one is easy to break by
 * accident with a single convenient import. Breaking one should fail here, in a
 * second, rather than in a packaging step or not at all.
 *
 * Type-only imports are ignored throughout. They are erased before anything
 * runs, so a type-only cycle is not a cycle and a type-only layer crossing is
 * not a dependency — treating them as real is what makes a graph nobody reads.
 */

const ROOT = resolve(__dirname)

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path))
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(path)
  }
  return out
}

const FILES = sourceFiles(ROOT)

/** Runtime imports only: `import type` and `import { type X }` are erased. */
function runtimeImports(source: string): string[] {
  const out: string[] = []
  const pattern = /import\s+(type\s+)?([\s\S]*?)\s*from\s*['"]([^'"]+)['"]/g
  for (const [, typeOnly, clause, spec] of source.matchAll(pattern)) {
    if (typeOnly) continue
    // `import { type A, type B } from 'x'` is also fully erased.
    const named = clause.trim()
    if (named.startsWith('{') && named.endsWith('}')) {
      const parts = named
        .slice(1, -1)
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean)
      if (parts.length > 0 && parts.every((p) => p.startsWith('type '))) continue
    }
    out.push(spec)
  }
  return out
}

const layerOf = (file: string): string => relative(ROOT, file).split('/')[0]!

describe('layering', () => {
  /**
   * Each layer, and what it is forbidden to reach for at runtime. `core` is the
   * strictest on purpose: it is the only code that runs in a plain Node process
   * with no Electron and no DOM, which is what makes it cheap to test.
   */
  const FORBIDDEN: Record<string, { spec: RegExp; why: string }[]> = {
    core: [
      { spec: /^electron$/, why: 'core must run without Electron' },
      { spec: /^react/, why: 'core must run without a DOM' },
      { spec: /^@codemirror\//, why: 'core is not the editor' },
      { spec: /^@\//, why: 'core cannot depend on the renderer' },
      { spec: /^@shared\//, why: 'shared describes the IPC boundary; core is below it' }
    ],
    shared: [
      { spec: /^electron$/, why: 'shared is the contract, not an implementation' },
      { spec: /^react/, why: 'shared is read by main as well as the renderer' },
      { spec: /^@\//, why: 'shared cannot depend on the renderer' }
    ],
    main: [
      { spec: /^@\//, why: 'main cannot import renderer code' },
      { spec: /^react/, why: 'main has no DOM' }
    ],
    renderer: [{ spec: /^electron$/, why: 'the renderer reaches Electron only through preload' }]
  }

  for (const [layer, rules] of Object.entries(FORBIDDEN)) {
    it(`${layer} imports nothing it should not`, () => {
      const broken: string[] = []
      for (const file of FILES.filter((f) => layerOf(f) === layer)) {
        for (const spec of runtimeImports(readFileSync(file, 'utf8'))) {
          const rule = rules.find((r) => r.spec.test(spec))
          if (rule) broken.push(`${relative(ROOT, file)} imports '${spec}' — ${rule.why}`)
        }
      }
      expect(broken, broken.join('\n')).toEqual([])
    })
  }

  it('has the layers it thinks it has, so the rules above are not vacuous', () => {
    // A rule over an empty set passes for the wrong reason.
    for (const layer of Object.keys(FORBIDDEN)) {
      expect(FILES.filter((f) => layerOf(f) === layer).length, layer).toBeGreaterThan(2)
    }
  })
})

describe('no runtime import cycles', () => {
  it('every module can be loaded without loading itself first', () => {
    const graph = new Map<string, string[]>()
    const aliases: [RegExp, string][] = [
      [/^@core\//, 'core/'],
      [/^@shared\//, 'shared/'],
      [/^@\//, 'renderer/src/']
    ]

    const resolveSpec = (from: string, spec: string): string | null => {
      let rel: string
      const alias = aliases.find(([pattern]) => pattern.test(spec))
      if (alias) rel = spec.replace(alias[0], alias[1])
      else if (spec.startsWith('.')) rel = relative(ROOT, resolve(from, '..', spec))
      else return null // a package, which cannot close a cycle in our own code

      for (const suffix of ['.ts', '.tsx', '/index.ts', '/index.tsx']) {
        const candidate = join(ROOT, rel + suffix)
        if (FILES.includes(candidate)) return candidate
      }
      return null
    }

    for (const file of FILES) {
      graph.set(
        file,
        runtimeImports(readFileSync(file, 'utf8'))
          .map((spec) => resolveSpec(file, spec))
          .filter((f): f is string => f !== null)
      )
    }

    // Depth-first, reporting the cycle itself rather than only its existence:
    // "there is a cycle" is not something anyone can act on.
    const cycles: string[] = []
    const state = new Map<string, 'visiting' | 'done'>()
    const walk = (file: string, trail: string[]): void => {
      if (state.get(file) === 'done') return
      if (state.get(file) === 'visiting') {
        const from = trail.indexOf(file)
        cycles.push([...trail.slice(from), file].map((f) => relative(ROOT, f)).join(' → '))
        return
      }
      state.set(file, 'visiting')
      for (const next of graph.get(file) ?? []) walk(next, [...trail, file])
      state.set(file, 'done')
    }
    for (const file of FILES) walk(file, [])

    expect(cycles, cycles.join('\n')).toEqual([])
  })
})
