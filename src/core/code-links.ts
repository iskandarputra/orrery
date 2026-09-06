/**
 * What one source file depends on, read from the file itself.
 *
 * The vault graph has always been a graph of notes, joined by `[[wikilinks]]`.
 * A vault that holds code is a graph with half of itself missing: the files
 * that actually depend on each other are drawn as unconnected dots. This finds
 * the other half of the edges — imports, requires, includes, uses — so the map
 * covers everything in the folder rather than the markdown in it.
 *
 * Deliberately not a parser. CodeGraph, which does this properly, compiles
 * tree-sitter grammars for twenty languages into a Rust kernel and keeps the
 * result in SQLite; that is the right shape for a tool whose whole job is the
 * graph, and the wrong one for an editor that wants a map of a folder. What is
 * here is a line scanner over import syntax, which is the one construct every
 * language keeps at the top of the file, on its own line, in a form that does
 * not need types resolved to read. It gets file-to-file edges right and knows
 * nothing about call graphs, which is the honest limit of the approach.
 *
 * The lesson from the outline scanner applies: text inside comments and
 * docstrings is prose, and prose that looks like an import is not one.
 */

import { extname } from './paths'

export interface CodeImport {
  /** Exactly what the file asked for: './editor', 'crate::pane', 'os.path'. */
  spec: string
  /** 1-based, for a graph that can send someone to the line. */
  line: number
}

type Family = 'js' | 'python' | 'rust' | 'go' | 'c' | 'ruby' | 'jvm' | 'php' | 'css'

const FAMILY: Record<string, Family> = {
  '.ts': 'js',
  '.tsx': 'js',
  '.mts': 'js',
  '.cts': 'js',
  '.js': 'js',
  '.jsx': 'js',
  '.mjs': 'js',
  '.cjs': 'js',
  '.svelte': 'js',
  '.vue': 'js',
  '.py': 'python',
  '.pyi': 'python',
  '.rs': 'rust',
  '.go': 'go',
  '.c': 'c',
  '.h': 'c',
  '.cc': 'c',
  '.cpp': 'c',
  '.cxx': 'c',
  '.hpp': 'c',
  '.hh': 'c',
  '.m': 'c',
  '.rb': 'ruby',
  '.java': 'jvm',
  '.kt': 'jvm',
  '.kts': 'jvm',
  '.scala': 'jvm',
  '.php': 'php',
  '.css': 'css',
  '.scss': 'css',
  '.sass': 'css',
  '.less': 'css'
}

/** Which extensions this can read at all. */
export function importsFamily(filePath: string): boolean {
  return extname(filePath).toLowerCase() in FAMILY
}

const PATTERNS: Record<Family, RegExp[]> = {
  js: [
    // `import x from 'y'`, `import 'y'`, `export * from 'y'`, all quote styles.
    /\b(?:import|export)\s[^;'"`]*?from\s*['"]([^'"]+)['"]/g,
    /\bimport\s*['"]([^'"]+)['"]/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g
  ],
  python: [/^\s*from\s+([.\w]+)\s+import\b/g, /^\s*import\s+([.\w]+)/g],
  // `mod x;` is a file in Rust; `use` reaches into one.
  rust: [/^\s*(?:pub\s+)?mod\s+(\w+)\s*;/g, /^\s*use\s+([\w:]+)/g],
  go: [/^\s*(?:import\s+)?(?:[\w.]+\s+)?["]([^"]+)["]/g],
  c: [/^\s*#\s*include\s*"([^"]+)"/g],
  ruby: [/\brequire(?:_relative)?\s*\(?\s*['"]([^'"]+)['"]/g],
  jvm: [/^\s*import\s+(?:static\s+)?([\w.]+)/g],
  php: [/\b(?:require|include)(?:_once)?\s*\(?\s*['"]([^'"]+)['"]/g, /^\s*use\s+([\w\\]+)/g],
  css: [/@(?:import|use)\s+['"]([^'"]+)['"]/g]
}

interface ScanState {
  block: boolean
  doc: string | null
  /** Go's grouped `import ( ... )`, where the lines have no keyword of their own. */
  goBlock: boolean
}

/**
 * Is this line prose rather than code?
 *
 * The same rule the outline scanner learned: a docstring describing a function
 * is not a function, and a commented-out import is not an import.
 */
function isProse(line: string, state: ScanState): boolean {
  const trimmed = line.trim()

  if (state.doc) {
    if (trimmed.includes(state.doc)) state.doc = null
    return true
  }
  for (const quote of ['"""', "'''"]) {
    if (trimmed.startsWith(quote)) {
      if (!trimmed.slice(quote.length).includes(quote)) state.doc = quote
      return true
    }
  }

  if (state.block) {
    if (trimmed.includes('*/')) state.block = false
    return true
  }
  if (trimmed.startsWith('/*')) {
    if (!trimmed.includes('*/')) state.block = true
    return true
  }

  // `#include` is a C directive rather than a comment, so `#` alone cannot
  // decide; every other single-line comment leader can.
  if (trimmed.startsWith('#') && !/^#\s*include\b/.test(trimmed)) return true
  return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('--')
}

/** Everything this file says it depends on. */
export function findImports(content: string, filePath: string): CodeImport[] {
  const family = FAMILY[extname(filePath).toLowerCase()]
  if (!family) return []

  const patterns = PATTERNS[family]
  const found: CodeImport[] = []
  const state: ScanState = { block: false, doc: null, goBlock: false }

  content.split('\n').forEach((line, index) => {
    if (isProse(line, state)) return

    // Go writes its imports in a block whose lines are bare strings, which is
    // the only place a quoted word on its own line means an import.
    if (family === 'go') {
      if (/^\s*import\s*\(/.test(line)) {
        state.goBlock = true
        return
      }
      if (state.goBlock && /^\s*\)/.test(line)) {
        state.goBlock = false
        return
      }
      if (!state.goBlock && !/^\s*import\b/.test(line)) return
    }

    for (const pattern of patterns) {
      pattern.lastIndex = 0
      let match = pattern.exec(line)
      while (match) {
        const spec = match[1]?.trim()
        if (spec) found.push({ spec, line: index + 1 })
        match = pattern.exec(line)
      }
    }
  })

  // One edge per target, keeping the first line it appeared on.
  const seen = new Set<string>()
  return found.filter((entry) => {
    if (seen.has(entry.spec)) return false
    seen.add(entry.spec)
    return true
  })
}

/** Extensions tried when an import leaves one off, in the order a resolver would. */
const CANDIDATES: Record<string, string[]> = {
  '.ts': ['.ts', '.tsx', '.d.ts', '.js', '.mts', '.cts'],
  '.tsx': ['.tsx', '.ts', '.d.ts', '.js'],
  '.js': ['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx'],
  '.jsx': ['.jsx', '.js', '.tsx', '.ts'],
  '.mjs': ['.mjs', '.js', '.mts', '.ts'],
  '.cjs': ['.cjs', '.js', '.cts', '.ts'],
  '.py': ['.py', '.pyi'],
  '.rb': ['.rb'],
  '.php': ['.php'],
  '.css': ['.css', '.scss', '.sass', '.less'],
  '.scss': ['.scss', '.css', '.sass'],
  '.rs': ['.rs'],
  '.go': ['.go'],
  '.c': ['.c', '.h'],
  '.h': ['.h', '.c'],
  '.cpp': ['.cpp', '.hpp', '.h', '.cc'],
  '.hpp': ['.hpp', '.h', '.cpp']
}

const normalise = (path: string): string => {
  const parts: string[] = []
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return `/${parts.join('/')}`
}

const dirOf = (path: string): string => path.slice(0, path.lastIndexOf('/'))
const stemOf = (path: string): string =>
  path.slice(path.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '')

/**
 * Which file in the vault an import means, or null.
 *
 * Two ways in. A relative specifier is a path, so it is joined and tried with
 * the extensions its language leaves off, `index` files included. Anything else
 * — a package, a crate, a Java package name — is matched by its last segment
 * against the files there are, and **only when exactly one matches**: guessing
 * between two files called `store` would draw an edge that is wrong half the
 * time, and a wrong edge in a map is worse than a missing one.
 */
/**
 * What `resolveImport` needs in order to answer without walking the vault.
 *
 * Built once for a whole graph, because it used to be built once per *import*.
 * `resolveImport` opened with `new Set(files)` and, for anything that was not a
 * relative path, ran `files.filter(...)` over every file in the vault. On a
 * repository with 3,721 files and tens of thousands of imports that is hundreds
 * of millions of string operations, and it was 15.2 of the 17.4 seconds a graph
 * scan took: the whole of "Orrery is not responding" at start-up.
 */
export interface ImportIndex {
  /** Every file, for asking whether a resolved path exists. */
  readonly paths: ReadonlySet<string>
  /** Lower-cased stem to the files carrying it, for a bare module name. */
  readonly byStem: ReadonlyMap<string, readonly string[]>
}

/** Index a vault's files once, for every `resolveImport` that follows. */
export function indexImports(files: readonly string[]): ImportIndex {
  const paths = new Set(files)
  const byStem = new Map<string, string[]>()
  for (const file of files) {
    const key = stemOf(file).toLowerCase()
    const bucket = byStem.get(key)
    if (bucket) bucket.push(file)
    else byStem.set(key, [file])
  }
  return { paths, byStem }
}

export function resolveImport(fromPath: string, spec: string, index: ImportIndex): string | null {
  const known = index.paths
  const own = extname(fromPath).toLowerCase()
  const tries = CANDIDATES[own] ?? [own]

  // Two spellings of "relative": a path, and Python's leading dots.
  const asPath = spec.startsWith('./') || spec.startsWith('../')
  const asDots = /^\.+(?:\w|$)/.test(spec)

  if (asPath || asDots) {
    let base = dirOf(fromPath)
    let rest = spec
    if (asDots) {
      // One dot is "this folder", each extra dot is one level up.
      const dots = /^\.+/.exec(spec)?.[0].length ?? 0
      for (let up = 1; up < dots; up++) base = dirOf(base)
      rest = spec.slice(dots).replace(/\./g, '/')
    }

    const target = normalise(`${base}/${rest}`)
    for (const ext of tries) {
      if (known.has(`${target}${ext}`)) return `${target}${ext}`
    }
    for (const ext of tries) {
      if (known.has(`${target}/index${ext}`)) return `${target}/index${ext}`
      if (known.has(`${target}/mod${ext}`)) return `${target}/mod${ext}`
      if (known.has(`${target}/__init__${ext}`)) return `${target}/__init__${ext}`
    }
    if (known.has(target)) return target
    return null
  }

  // A package path, a crate path, a module name. Its last meaningful segment is
  // the only part that can name a file.
  const segments = spec.split(/[/:.\\]+/).filter(Boolean)
  const last = segments[segments.length - 1]
  if (!last) return null

  // Only files of the same language: `crate::pane` in Rust cannot mean a
  // TypeScript file that happens to share the name.
  const family = FAMILY[own]
  const sharing = index.byStem.get(last.toLowerCase()) ?? []
  const matches = sharing.filter((file) => FAMILY[extname(file).toLowerCase()] === family)
  return matches.length === 1 ? (matches[0] ?? null) : null
}
