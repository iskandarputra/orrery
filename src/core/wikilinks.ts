/**
 * [[wikilink]] parsing shared by the editor plugin (decorations, completion),
 * the main-process backlink scanner, and tests. Supported forms:
 *   [[Note]]  [[Note#Heading]]  [[Note|Alias]]  [[Note#Heading|Alias]]
 */

export interface WikilinkMatch {
  /** Offset of the opening `[[`. */
  from: number
  /** Offset just past the closing `]]`. */
  to: number
  /** Link target (note name, without heading/alias). */
  target: string
  /** Optional heading anchor (text after #). */
  heading: string | null
  /** Display alias (text after |), or null. */
  alias: string | null
  /** Offsets of the visible label within [from, to]. */
  labelFrom: number
  labelTo: number
  /** True for `![[Note]]` — an embed, which renders the note rather than links it. */
  embed: boolean
}

const WIKILINK_RE = /\[\[([^\][#|\n]+)(#[^\][|\n]*)?(\|[^\][\n]*)?\]\]/g

/**
 * Character ranges that are code, and so are not links.
 *
 * A `[[Note]]` inside a fence is a piece of sample text, not a reference — a
 * mermaid diagram or a snippet showing the syntax would otherwise mint a note
 * that does not exist, put a ghost in the graph, and file a backlink from a
 * document that never linked to anything.
 *
 * Fenced blocks and inline spans only. Indented code is deliberately not
 * treated as code here: four-space indentation is far more often a wrapped list
 * item in a real note than a code block, and guessing wrong loses a real link.
 */
function codeRanges(text: string): [number, number][] {
  const ranges: [number, number][] = []

  // Fences, matched on their own opener so a ``` inside a ~~~ block does not
  // close it, and a longer fence is not closed by a shorter one.
  const fence = /^([ \t]*)(`{3,}|~{3,})[^\n]*$/gm
  let open: { at: number; marker: string } | null = null
  let m: RegExpExecArray | null
  while ((m = fence.exec(text)) !== null) {
    const marker = m[2]!
    if (!open) {
      open = { at: m.index, marker: marker[0]! }
    } else if (marker[0] === open.marker) {
      ranges.push([open.at, m.index + m[0].length])
      open = null
    }
  }
  // An unclosed fence runs to the end of the document, which is what a renderer
  // does with one too.
  if (open) ranges.push([open.at, text.length])

  const inline = /(`+)[^`\n]*?\1/g
  while ((m = inline.exec(text)) !== null) {
    if (!ranges.some(([from, to]) => m!.index >= from && m!.index < to)) {
      ranges.push([m.index, m.index + m[0].length])
    }
  }
  return ranges
}

export function findWikilinks(text: string, offset = 0): WikilinkMatch[] {
  const matches: WikilinkMatch[] = []
  const code = codeRanges(text)
  WIKILINK_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = WIKILINK_RE.exec(text)) !== null) {
    const [, rawTarget, rawHeading, rawAlias] = m
    const target = rawTarget?.trim() ?? ''
    if (!target) continue
    if (code.some(([from, to]) => m!.index >= from && m!.index < to)) continue
    // `![[Note]]` embeds the note; the bang is part of the match, but every
    // label offset below is measured from the `[[`.
    const embed = m.index > 0 && text[m.index - 1] === '!'
    const linkFrom = offset + m.index
    const from = embed ? linkFrom - 1 : linkFrom
    const to = linkFrom + m[0].length
    let labelFrom: number
    let labelTo: number
    if (rawAlias && rawAlias.length > 1) {
      // Label is the alias text (skip the pipe).
      labelFrom = linkFrom + 2 + (rawTarget?.length ?? 0) + (rawHeading?.length ?? 0) + 1
      labelTo = to - 2
    } else {
      // Label is the target (heading hidden when concealed).
      labelFrom = linkFrom + 2
      labelTo = labelFrom + (rawTarget?.length ?? 0)
    }
    matches.push({
      from,
      to,
      target,
      heading: rawHeading ? rawHeading.slice(1).trim() || null : null,
      alias: rawAlias ? rawAlias.slice(1).trim() || null : null,
      labelFrom,
      labelTo,
      embed
    })
  }
  return matches
}

/** Case-insensitive stem comparison used to resolve link targets to files. */
export function stemMatches(target: string, stem: string): boolean {
  return target.trim().toLowerCase() === stem.trim().toLowerCase()
}
