/**
 * The YAML block at the top of a note, read and written back.
 *
 * A deliberately small subset of YAML: scalars, list items, and inline lists.
 * That is what note frontmatter contains, and a full YAML implementation would
 * bring a parser that reformats everything it touches.
 *
 * The hard requirement is round-trip fidelity. Editing one property must leave
 * every other byte alone, so each property remembers the exact lines it came
 * from and is written back verbatim unless it was the one that changed. Without
 * that, opening a note and changing a tag rewrites quoting, spacing and key
 * order throughout, and every note in the vault churns the first time it is
 * looked at.
 */

export interface Property {
  key: string
  /** A scalar, or the items of a list. */
  value: string | string[]
  /**
   * The lines this was read from. Present until the property is changed, and
   * written back in place of anything generated while it is.
   */
  source: string[] | null
}

export interface Frontmatter {
  properties: Property[]
  /** Offset just past the closing `---` and its newline. */
  end: number
  eol: '\n' | '\r\n'
}

const FENCE = /^---[ \t]*$/

/** Everything before the first `:` that is not inside quotes. */
function splitKey(line: string): { key: string; rest: string } | null {
  const colon = line.indexOf(':')
  if (colon <= 0) return null
  return { key: line.slice(0, colon).trim(), rest: line.slice(colon + 1).trim() }
}

/** `[a, b, c]` written on one line. */
function inlineList(value: string): string[] | null {
  if (!value.startsWith('[') || !value.endsWith(']')) return null
  const body = value.slice(1, -1).trim()
  if (body === '') return []
  return body.split(',').map((item) => unquote(item.trim()))
}

/** Strip one layer of matching quotes, which YAML treats as delimiters. */
export function unquote(value: string): string {
  if (value.length >= 2 && (value[0] === '"' || value[0] === "'") && value.at(-1) === value[0]) {
    return value.slice(1, -1)
  }
  return value
}

/**
 * Read the block, or null when the document does not open with one.
 *
 * `---` has to be the very first line: a horizontal rule further down a note is
 * not frontmatter, and treating it as such would swallow the prose above it.
 */
export function parseFrontmatter(text: string): Frontmatter | null {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const lines = text.split(/\r?\n/)
  if (lines.length === 0 || !FENCE.test(lines[0] ?? '')) return null

  const closing = lines.findIndex((line, i) => i > 0 && FENCE.test(line))
  if (closing === -1) return null // never closed, so it is not a block

  const properties: Property[] = []
  for (let i = 1; i < closing; i++) {
    const line = lines[i]!
    if (line.trim() === '') continue
    const split = splitKey(line)
    if (!split || !split.key) continue

    const source = [line]
    // A list is the indented `- item` lines that follow an empty value.
    if (split.rest === '') {
      const items: string[] = []
      while (i + 1 < closing && /^\s+-\s?/.test(lines[i + 1] ?? '')) {
        const item = lines[++i]!
        source.push(item)
        items.push(unquote(item.replace(/^\s*-\s?/, '').trim()))
      }
      properties.push({ key: split.key, value: items, source })
      continue
    }

    const inline = inlineList(split.rest)
    properties.push({
      key: split.key,
      value: inline ?? unquote(split.rest),
      source
    })
  }

  // Past the closing fence and the newline that ends it.
  const consumed = lines.slice(0, closing + 1).join(eol)
  const end = Math.min(text.length, consumed.length + eol.length)
  return { properties, end, eol }
}

/** A value that YAML would otherwise read as something else. */
function quoteIfNeeded(value: string): string {
  if (value === '') return '""'
  if (/^[\s]|[\s]$|^[[{>|*&!%@`#-]|: |:$/.test(value)) return JSON.stringify(value)
  return value
}

/** One property as the lines it occupies. */
function propertyLines(property: Property): string[] {
  // Untouched: written back exactly as it was read.
  if (property.source) return property.source
  if (Array.isArray(property.value)) {
    if (property.value.length === 0) return [`${property.key}: []`]
    return [`${property.key}:`, ...property.value.map((item) => `  - ${quoteIfNeeded(item)}`)]
  }
  return [`${property.key}: ${quoteIfNeeded(property.value)}`]
}

/** The whole block, fences included, ending with a newline. */
export function serializeFrontmatter(frontmatter: Frontmatter): string {
  const { eol } = frontmatter
  const body = frontmatter.properties.flatMap(propertyLines)
  return ['---', ...body, '---', ''].join(eol)
}

/** Replace the block at the top of a document, leaving the rest untouched. */
export function replaceFrontmatter(text: string, frontmatter: Frontmatter): string {
  const existing = parseFrontmatter(text)
  const rest = existing ? text.slice(existing.end) : text
  return serializeFrontmatter(frontmatter) + rest
}

/** Set a property, adding it when it is not there. Drops its verbatim source. */
export function setProperty(
  frontmatter: Frontmatter,
  key: string,
  value: string | string[]
): Frontmatter {
  const existing = frontmatter.properties.some((p) => p.key === key)
  const properties = existing
    ? frontmatter.properties.map((p) => (p.key === key ? { key, value, source: null } : p))
    : [...frontmatter.properties, { key, value, source: null }]
  return { ...frontmatter, properties }
}

export function removeProperty(frontmatter: Frontmatter, key: string): Frontmatter {
  return { ...frontmatter, properties: frontmatter.properties.filter((p) => p.key !== key) }
}

/** Rename a key, keeping its position and its value. */
export function renameProperty(frontmatter: Frontmatter, from: string, to: string): Frontmatter {
  return {
    ...frontmatter,
    properties: frontmatter.properties.map((p) =>
      p.key === from ? { key: to, value: p.value, source: null } : p
    )
  }
}

/** An empty block, for a note that has none yet. */
export function emptyFrontmatter(eol: '\n' | '\r\n' = '\n'): Frontmatter {
  return { properties: [], end: 0, eol }
}
