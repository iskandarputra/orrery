/** `## Heading` — level and text, ignoring anything inside a code fence. */
const HEADING = /^(#{1,6})\s+(.*)$/

const normalise = (text: string): string => text.trim().toLowerCase()

/**
 * The body under a heading: everything from the heading to the next one at the
 * same level or higher, so `## Alpha` carries its `###` subsections with it.
 *
 * Fenced code is skipped when looking for headings — `## Fake` inside a shell
 * snippet is a comment, not a section, and embedding the wrong half of a note
 * is the kind of error nobody notices until it matters.
 */
export function extractSection(markdown: string, heading: string): string | null {
  const lines = markdown.split('\n')
  const wanted = normalise(heading)
  let inFence = false
  let startLine = -1
  let startLevel = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue

    const match = HEADING.exec(line)
    if (!match) continue
    const level = match[1]!.length

    if (startLine === -1) {
      if (normalise(match[2]!) === wanted) {
        startLine = i
        startLevel = level
      }
      continue
    }
    if (level <= startLevel) {
      return lines
        .slice(startLine + 1, i)
        .join('\n')
        .trim()
    }
  }

  if (startLine === -1) return null
  return lines
    .slice(startLine + 1)
    .join('\n')
    .trim()
}
