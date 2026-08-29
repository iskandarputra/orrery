import { isMarkdownFile } from './paths'

/**
 * The symbols of a document, for jumping around inside one.
 *
 * Sublime's Goto Anything is the model: one box, where a prefix decides what is
 * being searched. `@` wants the things a file is made of — headings in a note,
 * declarations in code.
 *
 * Deliberately regex-based rather than parsed. A language server gives better
 * answers but only for languages that have one installed, and a jump list that
 * works for some files and silently not for others is worse than one that is
 * approximate everywhere.
 */

export interface DocSymbol {
  name: string
  /** 1-based. */
  line: number
  /** Nesting depth, for indenting the list. Headings use their level. */
  depth: number
  kind: 'heading' | 'declaration'
}

const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/
const FENCE = /^\s*(```|~~~)/

/** Headings, skipping anything inside a code fence. */
function markdownSymbols(text: string): DocSymbol[] {
  const out: DocSymbol[] = []
  let inFence = false
  text.split('\n').forEach((line, i) => {
    if (FENCE.test(line)) inFence = !inFence
    if (inFence) return
    const m = line.match(HEADING)
    if (m) out.push({ name: m[2]!, line: i + 1, depth: m[1]!.length - 1, kind: 'heading' })
  })
  return out
}

/**
 * Declarations, across the C-like and script languages the editor opens.
 *
 * One pattern per shape rather than per language: `function foo`, `class Foo`,
 * `const foo =`, `def foo`, `fn foo`, `type Foo`, and a bare `foo() {` for
 * methods. Overlapping matches are fine — the first to match a line wins, and a
 * line matching none is not a declaration.
 */
const DECLARATIONS: RegExp[] = [
  /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/,
  /^\s*(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/,
  /^\s*(?:export\s+)?(?:interface|type|enum|struct|trait|impl)\s+([A-Za-z_$][\w$]*)/,
  /^\s*(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_$][\w$]*)/,
  /^\s*def\s+([A-Za-z_$][\w$]*)/,
  /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/,
  /^\s*(?:public|private|protected|static|\s)*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{\s*$/
]

/** Words that look like declarations to the last pattern but are control flow. */
const NOT_A_NAME = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'else', 'do'])

/**
 * Lines that are prose, not code.
 *
 * Comments and docstrings have to be skipped or the patterns below read them.
 * A docstring containing the words "function with a flag" was reported as a
 * declaration named `with`, because that is exactly what the JavaScript pattern
 * matches. Anything written in a comment is written in prose, and prose
 * eventually contains every keyword there is.
 */
function isProse(line: string, state: { block: boolean; doc: string | null }): boolean {
  const trimmed = line.trim()

  // Python and friends: a docstring opened on one line and closed on another.
  if (state.doc) {
    if (trimmed.includes(state.doc)) state.doc = null
    return true
  }
  for (const quote of ['"""', "'''"]) {
    if (trimmed.startsWith(quote)) {
      // Either closed on this line, or left open for the lines that follow.
      if (!trimmed.slice(quote.length).includes(quote)) state.doc = quote
      return true
    }
  }

  // C-style block comments, including the JSDoc that documents the very
  // declarations this is looking for.
  if (state.block) {
    if (trimmed.includes('*/')) state.block = false
    return true
  }
  if (trimmed.startsWith('/*')) {
    if (!trimmed.includes('*/')) state.block = true
    return true
  }

  // Single-line comments across the languages the editor opens. `#` is a
  // preprocessor directive in C rather than a comment, and neither of those is
  // a declaration, so skipping the line is right either way.
  return (
    trimmed.startsWith('//') ||
    trimmed.startsWith('#') ||
    trimmed.startsWith('*') ||
    trimmed.startsWith('--') ||
    trimmed.startsWith(';')
  )
}

function codeSymbols(text: string): DocSymbol[] {
  const out: DocSymbol[] = []
  const state = { block: false, doc: null as string | null }
  text.split('\n').forEach((line, i) => {
    if (isProse(line, state)) return
    for (const pattern of DECLARATIONS) {
      const m = line.match(pattern)
      if (!m?.[1] || NOT_A_NAME.has(m[1])) continue
      // Indentation stands in for nesting: a method inside a class is indented
      // past it, which is all the list needs to show the shape of the file.
      const indent = line.length - line.trimStart().length
      out.push({
        name: m[1],
        line: i + 1,
        depth: Math.min(3, Math.floor(indent / 2)),
        kind: 'declaration'
      })
      break
    }
  })
  return out
}

export function documentSymbols(text: string, fileName: string): DocSymbol[] {
  return isMarkdownFile(fileName) ? markdownSymbols(text) : codeSymbols(text)
}

/**
 * A line number typed as a jump target.
 *
 * Clamped to the document rather than refused: `:9999` in a short file means
 * "the end", which is what a person typing a number too large is asking for.
 */
export function parseLineTarget(query: string, totalLines: number): number | null {
  const m = query.match(/^(\d+)/)
  if (!m) return null
  const line = Number(m[1])
  if (line < 1) return null
  return Math.min(line, Math.max(1, totalLines))
}
