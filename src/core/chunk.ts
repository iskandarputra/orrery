export interface Chunk {
  text: string
  /** 1-based line where the chunk starts. */
  line: number
}

/**
 * Split markdown into embedding-sized chunks on blank-line (paragraph)
 * boundaries, accumulating until `maxChars`. Pure so it is unit-testable and
 * shared by the indexer and any future preview.
 */
export function chunkMarkdown(content: string, maxChars = 800): Chunk[] {
  const lines = content.split('\n')
  const chunks: Chunk[] = []
  let buf: string[] = []
  let startLine = 1

  const flush = (): void => {
    const text = buf.join('\n').trim()
    if (text) chunks.push({ text, line: startLine })
    buf = []
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (buf.length === 0) startLine = i + 1
    buf.push(line)
    const joined = buf.join('\n')
    const paragraphBreak = line.trim() === '' && buf.some((l) => l.trim() !== '')
    if (joined.length >= maxChars || paragraphBreak) {
      flush()
      startLine = i + 2 // next chunk begins after this line
    }
  }
  flush()
  return chunks
}
