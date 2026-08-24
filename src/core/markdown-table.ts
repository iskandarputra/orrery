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
