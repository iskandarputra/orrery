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

export function findWikilinks(text: string, offset = 0): WikilinkMatch[] {
  const matches: WikilinkMatch[] = []
  WIKILINK_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = WIKILINK_RE.exec(text)) !== null) {
    const [, rawTarget, rawHeading, rawAlias] = m
    const target = rawTarget?.trim() ?? ''
    if (!target) continue
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

/** Lines of `content` containing a wikilink to `targetStem` (for backlinks). */
export function findLinkLines(
  content: string,
  targetStem: string
): { line: number; snippet: string }[] {
  const hits: { line: number; snippet: string }[] = []
  const lines = content.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (!line.includes('[[')) continue
    if (findWikilinks(line).some((l) => stemMatches(l.target, targetStem))) {
      hits.push({ line: i + 1, snippet: line.trim().slice(0, 200) })
    }
  }
  return hits
}
