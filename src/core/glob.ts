/**
 * The glob subset used by search's include and exclude filters.
 *
 * Deliberately small, and hand-written rather than delegated to a library,
 * because there are two implementations of search — TypeScript and Rust — and
 * they have to agree exactly. Pairing picomatch against globset would mean
 * their edge cases deciding what the app does, differently, on each path.
 *
 * What is supported, matching VS Code closely enough to be unsurprising:
 *
 *   `*.ts`          any `.ts` file, at any depth
 *   `src/**`        everything under `src/`
 *   `**\/*.test.ts` any test file, at any depth
 *   `docs/*.md`     markdown directly inside `docs/`
 *   `?`             exactly one character, never a separator
 *   `a,b`           a list — any pattern matching is a match
 *
 * A pattern containing no `/` is matched against the file name alone, which is
 * what makes `*.ts` mean "any TypeScript file" rather than "one in the root".
 */

/** Split a comma-separated list of patterns, dropping blanks. */
export function parsePatternList(input: string): string[] {
  return input
    .split(',')
    .map((pattern) => pattern.trim())
    .filter((pattern) => pattern.length > 0)
}

/**
 * A glob as a regular expression, anchored at both ends.
 *
 * `**` is handled before `*` so that the greedy form is not eaten by the
 * segment-local one, and `**\/` collapses to "any number of directories,
 * including none" — otherwise `**\/*.ts` would fail to match a file in the root.
 */
export function globToRegExp(pattern: string): RegExp {
  let out = ''
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i]!
    if (char === '*') {
      if (pattern[i + 1] === '*') {
        // `**/` — any depth, including none.
        if (pattern[i + 2] === '/') {
          out += '(?:.*/)?'
          i += 2
        } else {
          out += '.*'
          i += 1
        }
      } else {
        out += '[^/]*'
      }
    } else if (char === '?') {
      out += '[^/]'
    } else if ('\\^$.|+()[]{}'.includes(char)) {
      out += `\\${char}`
    } else {
      out += char
    }
  }
  return new RegExp(`^${out}$`)
}

/**
 * Does this repo-relative path match any of the patterns?
 *
 * An empty list matches nothing, so callers decide what "no filter" means:
 * include treats it as "everything", exclude as "nothing".
 */
export function matchesAnyGlob(relativePath: string, patterns: readonly string[]): boolean {
  const name = relativePath.slice(relativePath.lastIndexOf('/') + 1)
  return patterns.some((pattern) => {
    const matcher = globToRegExp(pattern)
    // A pattern naming no directory is about the file, wherever it lives.
    return matcher.test(pattern.includes('/') ? relativePath : name)
  })
}
