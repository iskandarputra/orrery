import { escapeRegex } from './search-query'

/**
 * Obsidian-style operators in the search box.
 *
 * `path:src`, `file:*.ts`, `tag:draft`, and any of them negated with a leading
 * minus. Everything else is what you are looking for.
 *
 * They are translated here into the fields the search already takes — a query,
 * an include glob and an exclude glob — rather than taught to the search
 * itself. That matters because there are two implementations of search, one in
 * TypeScript and one in Rust, held to each other by a differential test.
 * Translating in front of both means neither has to learn anything, and they
 * cannot drift apart over a feature only one of them knows about.
 */

export interface ParsedSearch {
  /** The query to send. Already a regex when `regex` is true. */
  query: string
  /** Whether `query` must be read as a regular expression. */
  regex: boolean
  /** Comma-separated globs, in the form `include` already expects. */
  include: string
  exclude: string
  /** What the operators were understood to mean, for showing back to the user. */
  terms: string[]
}

/** `path:x`, `-file:y`, `tag:z` — the name, its argument, and whether negated. */
const OPERATOR = /^(-?)(path|file|tag):(.*)$/

/**
 * Split on spaces, keeping quoted runs together.
 *
 * `"exact phrase"` is one term. Without this, a phrase becomes several terms
 * that must each appear on the line, which is a different question.
 */
export function tokenize(input: string): string[] {
  const tokens: string[] = []
  let current = ''
  let quoted = false
  for (const char of input) {
    if (char === '"') {
      quoted = !quoted
    } else if (char === ' ' && !quoted) {
      if (current) tokens.push(current)
      current = ''
    } else {
      current += char
    }
  }
  if (current) tokens.push(current)
  return tokens
}

/**
 * A `path:` or `file:` argument as a glob.
 *
 * `path:` names a directory, so a bare word becomes everything under it.
 * `file:` names a file, so a bare word matches anywhere in the name — which is
 * what someone typing `file:test` is asking for. An argument that already
 * contains glob syntax is passed through, because they have said what they mean.
 */
export function operatorGlob(kind: 'path' | 'file', argument: string): string {
  const hasGlob = /[*?]/.test(argument)
  if (hasGlob) return argument
  if (kind === 'path') return `${argument.replace(/\/+$/, '')}/**`
  return `*${argument}*`
}

export function parseSearchQuery(input: string, useRegex = false): ParsedSearch {
  const include: string[] = []
  const exclude: string[] = []
  const terms: string[] = []

  for (const token of tokenize(input)) {
    const match = OPERATOR.exec(token)
    if (!match || !match[3]) {
      if (token) terms.push(token)
      continue
    }
    const [, negated, kind, argument] = match
    if (kind === 'tag') {
      // A tag is text in the file, so it becomes a term. Negating one would
      // mean "a line without it", which is not what the search can express.
      if (!negated) terms.push(argument.startsWith('#') ? argument : `#${argument}`)
      continue
    }
    const glob = operatorGlob(kind as 'path' | 'file', argument)
    ;(negated ? exclude : include).push(glob)
  }

  return {
    ...combine(terms, useRegex),
    include: include.join(', '),
    exclude: exclude.join(', '),
    terms
  }
}

/**
 * Several terms mean a line containing all of them, in any order.
 *
 * Expressed as lookaheads, because the search matches one pattern per line and
 * "a and b" is not something a plain pattern says. A single term is left alone
 * so the common case stays a literal search and the user's own regex toggle
 * keeps meaning what it says.
 */
function combine(terms: string[], useRegex: boolean): { query: string; regex: boolean } {
  if (terms.length <= 1) return { query: terms[0] ?? '', regex: useRegex }
  const parts = terms.map((term) => `(?=.*${useRegex ? term : escapeRegex(term)})`)
  return { query: `${parts.join('')}.*`, regex: true }
}
