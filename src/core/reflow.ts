/** Lines that must never be merged with their neighbors. */
const BLOCK_START = /^(\s*)(#{1,6}\s|>|[-*+]\s|\d+[.)]\s|\||```|~~~|( {4}|\t))/

/**
 * Join hard-wrapped lines inside paragraphs (single newlines become spaces)
 * while leaving real structure alone: blank lines, headings, lists, quotes,
 * tables, fenced/indented code, and markdown two-space line breaks.
 */
export function unwrapParagraphs(text: string): string {
  const lines = text.split('\n')
  const out: string[] = []
  let inFence = false

  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence
    const prev = out[out.length - 1]
    const joinable =
      !inFence &&
      prev !== undefined &&
      prev.trim() !== '' &&
      line.trim() !== '' &&
      !BLOCK_START.test(line) &&
      !BLOCK_START.test(prev) &&
      !/^\s*(```|~~~)/.test(line) &&
      !prev.endsWith('  ') && // markdown hard break
      !prev.endsWith('\\')
    if (joinable) {
      out[out.length - 1] = `${prev.replace(/\s+$/, '')} ${line.trim()}`
    } else {
      out.push(line)
    }
  }
  return out.join('\n')
}
