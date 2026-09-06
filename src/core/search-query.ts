/**
 * Turning what someone typed into the box into a matcher.
 *
 * Shared so that the TypeScript search and the Rust sidecar build the same
 * pattern from the same input: the escaping, the word boundaries and the
 * case flag are all places where two implementations could quietly disagree
 * and return different results for the same search.
 */

export interface SearchOptions {
  /** Treat the query as a regular expression rather than literal text. */
  regex: boolean
  caseSensitive: boolean
  /** Match only where the query is bounded by non-word characters. */
  wholeWord: boolean
}

/** Escape every regex metacharacter, so a literal query means itself. */
export function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * The pattern source for a query, before it becomes a RegExp.
 *
 * Word boundaries wrap the whole pattern rather than each alternative, which
 * matches what a person means by "whole word" for a plain query. For a regex
 * query it is the caller's pattern that gets bounded, which is the same rule
 * VS Code applies and is at least predictable.
 */
export function searchPattern(query: string, options: SearchOptions): string {
  const source = options.regex ? query : escapeRegex(query)
  return options.wholeWord ? `\\b(?:${source})\\b` : source
}

/**
 * The matcher, or null when the query cannot compile.
 *
 * An invalid regex is a half-typed one — `[` on the way to `[a-z]` — so it
 * reports no matches rather than an error. Nobody wants a dialog every third
 * keystroke.
 */
export function buildSearchMatcher(query: string, options: SearchOptions): RegExp | null {
  if (query === '') return null
  try {
    return new RegExp(searchPattern(query, options), options.caseSensitive ? 'g' : 'gi')
  } catch {
    return null
  }
}
