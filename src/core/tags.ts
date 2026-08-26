export interface TagMatch {
  /** The tag without its `#`. */
  tag: string
  from: number
  to: number
}

export interface TagEntry {
  tag: string
  /** How many times it appears across the vault. */
  count: number
  /** Notes carrying it, each listed once. */
  paths: string[]
}

/** `#work/2026`, `#a-b`, `#v2` — but never a bare number. */
const TAG_BODY = /[A-Za-z0-9_/-]+/y

/**
 * Every `#tag` in a note, with its position.
 *
 * The awkward cases are all exclusions: a markdown heading is not a tag, an
 * `#include` inside code is not a tag, and a URL fragment is not a tag. Each of
 * those would otherwise flood the index with noise on the first real vault.
 */
export function findTags(text: string): TagMatch[] {
  const found: TagMatch[] = []
  let inFence = false
  let atLineStart = true

  for (let i = 0; i < text.length; i++) {
    const char = text[i]!

    if (char === '\n') {
      atLineStart = true
      continue
    }

    // A ``` or ~~~ line toggles a code fence; nothing inside one is a tag.
    if (atLineStart && (text.startsWith('```', i) || text.startsWith('~~~', i))) {
      inFence = !inFence
      i = text.indexOf('\n', i)
      if (i === -1) break
      atLineStart = true
      continue
    }

    if (!inFence && char === '`') {
      // Skip an inline code span, so `#define` isn't collected.
      const close = text.indexOf('`', i + 1)
      i = close === -1 ? text.length : close
      atLineStart = false
      continue
    }

    if (char === '#' && !inFence) {
      const previous = i > 0 ? text[i - 1]! : '\n'
      const startsToken = i === 0 || /\s/.test(previous)
      // A heading is `#` at the line start followed by a space or another `#`.
      const heading = atLineStart && /[\s#]/.test(text[i + 1] ?? ' ')
      if (startsToken && !heading) {
        TAG_BODY.lastIndex = i + 1
        const body = TAG_BODY.exec(text)?.[0]
        // Digits alone are a heading anchor or an issue number, not a tag.
        if (body && /[A-Za-z_/-]/.test(body)) {
          found.push({ tag: body, from: i, to: i + 1 + body.length })
          i += body.length
        }
      }
    }

    if (!/\s/.test(char)) atLineStart = false
  }

  return found
}

/** The vault's tags, most used first, ties broken alphabetically. */
export function collectTags(notes: readonly { path: string; content: string }[]): TagEntry[] {
  const index = new Map<string, { count: number; paths: Set<string> }>()
  for (const note of notes) {
    for (const { tag } of findTags(note.content)) {
      const entry = index.get(tag) ?? { count: 0, paths: new Set<string>() }
      entry.count++
      entry.paths.add(note.path)
      index.set(tag, entry)
    }
  }
  return [...index.entries()]
    .map(([tag, entry]) => ({ tag, count: entry.count, paths: [...entry.paths].sort() }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
}
