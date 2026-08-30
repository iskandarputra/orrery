/** Pure GFM table parsing — used by the table-rendering widget and tests. */

export type ColumnAlign = 'left' | 'center' | 'right' | null

export interface ParsedTable {
  header: string[]
  align: ColumnAlign[]
  rows: string[][]
}

/** Split a table line into cells, honoring escaped pipes (\|). */
export function splitRow(line: string): string[] {
  const cells: string[] = []
  let current = ''
  let escaped = false
  for (const ch of line.trim().replace(/^\||\|$/g, '')) {
    if (escaped) {
      current += ch === '|' ? '|' : `\\${ch}`
      escaped = false
    } else if (ch === '\\') {
      escaped = true
    } else if (ch === '|') {
      cells.push(current.trim())
      current = ''
    } else {
      current += ch
    }
  }
  cells.push(current.trim())
  return cells
}

function parseAlign(cell: string): ColumnAlign {
  const left = cell.startsWith(':')
  const right = cell.endsWith(':')
  if (left && right) return 'center'
  if (right) return 'right'
  if (left) return 'left'
  return null
}

/** Parse a GFM table's source text. Returns null if it isn't a valid table. */
export function parseTable(source: string): ParsedTable | null {
  const lines = source.split('\n').filter((l) => l.trim() !== '')
  if (lines.length < 2) return null
  const header = splitRow(lines[0]!)
  const delimiter = splitRow(lines[1]!)
  if (!delimiter.every((c) => /^:?-+:?$/.test(c))) return null
  const align = delimiter.map(parseAlign)
  const rows = lines.slice(2).map((line) => {
    const cells = splitRow(line)
    // Normalize row width to the header.
    return header.map((_, i) => cells[i] ?? '')
  })
  return { header, align, rows }
}

/**
 * How wide a cell is on screen, in monospace columns.
 *
 * A CJK character occupies two columns and an emoji usually does too, so
 * counting UTF-16 units would pad a Japanese table into a mess. Combining marks
 * take none. This is the same rule every terminal uses, cut down to the ranges
 * that matter for a table.
 */
export function displayWidth(text: string): number {
  let width = 0
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    // Combining marks and zero-width joiners sit on the previous character.
    if ((code >= 0x0300 && code <= 0x036f) || code === 0x200d || code === 0xfe0f) continue
    const wide =
      (code >= 0x1100 && code <= 0x115f) || // Hangul Jamo
      (code >= 0x2e80 && code <= 0xa4cf) || // CJK radicals through Yi
      (code >= 0xac00 && code <= 0xd7a3) || // Hangul syllables
      (code >= 0xf900 && code <= 0xfaff) || // CJK compatibility
      (code >= 0xfe30 && code <= 0xfe6f) || // CJK compatibility forms
      (code >= 0xff00 && code <= 0xff60) || // Fullwidth forms
      (code >= 0xffe0 && code <= 0xffe6) ||
      (code >= 0x1f300 && code <= 0x1faff) || // Emoji
      (code >= 0x20000 && code <= 0x3fffd) // CJK extension B and beyond
    width += wide ? 2 : 1
  }
  return width
}

/** A cell as it must be written: pipes escaped again, newlines flattened. */
function escapeCell(cell: string): string {
  return cell.replace(/\|/g, '\\|').replace(/\n/g, ' ')
}

const pad = (cell: string, width: number, align: ColumnAlign): string => {
  const gap = Math.max(0, width - displayWidth(cell))
  if (align === 'right') return ' '.repeat(gap) + cell
  if (align === 'center') {
    const left = Math.floor(gap / 2)
    return ' '.repeat(left) + cell + ' '.repeat(gap - left)
  }
  return cell + ' '.repeat(gap)
}

/** The delimiter cell for a column, keeping whatever alignment it declared. */
function delimiterCell(width: number, align: ColumnAlign): string {
  if (align === 'center') return `:${'-'.repeat(Math.max(1, width - 2))}:`
  if (align === 'right') return `${'-'.repeat(Math.max(1, width - 1))}:`
  if (align === 'left') return `:${'-'.repeat(Math.max(1, width - 1))}`
  return '-'.repeat(Math.max(3, width))
}

/**
 * A table's source, with its pipes lined up.
 *
 * Every column is padded to its widest cell, so the source reads as the table
 * it describes rather than as a ragged list of pipes. The alignment row keeps
 * what it declared: reformatting must not quietly re-align somebody's columns.
 *
 * Returns null when the text is not a table, and returns the text unchanged
 * when it is already aligned — the caller uses that to avoid writing a
 * transaction, and therefore an undo step, for nothing.
 */
export function formatTable(source: string): string | null {
  const parsed = parseTable(source)
  if (!parsed) return null

  const width = parsed.header.length
  const rows = parsed.rows.map((row) => Array.from({ length: width }, (_, i) => row[i] ?? ''))
  const cells = [parsed.header, ...rows].map((row) => row.map(escapeCell))

  const widths = Array.from({ length: width }, (_, column) =>
    Math.max(3, ...cells.map((row) => displayWidth(row[column] ?? '')))
  )

  const line = (row: string[]): string =>
    `| ${row.map((cell, i) => pad(cell, widths[i] ?? 3, parsed.align[i] ?? null)).join(' | ')} |`

  const out = [
    line(cells[0] ?? []),
    `| ${widths.map((w, i) => delimiterCell(w, parsed.align[i] ?? null)).join(' | ')} |`,
    ...cells.slice(1).map(line)
  ]

  // The trailing newline is the caller's business: it replaces a range that
  // ends at the last line's end.
  return out.join('\n')
}
