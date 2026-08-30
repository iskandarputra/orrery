/**
 * Rearranging a table: moving, sorting, filtering.
 *
 * A spreadsheet's verbs are all index arithmetic, and index arithmetic is where
 * an off-by-one turns into somebody's data in the wrong column. So they live
 * here as pure functions over rows, tested, rather than inside the component
 * that draws the grid.
 *
 * The important idea is that **sorting and filtering do not touch the file**.
 * They produce an order to draw in, and every edit is written back through that
 * order to the row it really came from. A view that sorts by silently rewriting
 * the document would reorder someone's file the moment they glanced at a
 * column, and a view that sorts without mapping edits back would write the
 * value into whichever row happened to be under the cursor.
 */

export type SortDirection = 'asc' | 'desc'

export interface ViewOrder {
  /** Body row indexes into the underlying rows, in the order to draw them. */
  order: number[]
  /** How many body rows the filter removed. */
  hidden: number
}

/** Header row plus body, as `parseCsv` gives them. */
type Rows = readonly (readonly string[])[]

/**
 * Compare two cells the way a person reading the column would.
 *
 * Numbers sort as numbers — `10` after `9`, not before it — and everything else
 * sorts as text, case-insensitively, with numbers inside names handled by the
 * locale comparator (`file2` before `file10`). Empty cells sort last whichever
 * direction is chosen, because "no value" is not a value that belongs at the
 * top.
 */
export function compareCells(a: string, b: string): number {
  const left = a.trim()
  const right = b.trim()
  if (left === '' && right === '') return 0
  if (left === '') return 1
  if (right === '') return -1

  const asNumber = (value: string): number | null => {
    // A plain number, allowing thousands separators and a leading currency-less
    // sign. Anything else is text, including `1,2` from a European decimal.
    if (!/^[+-]?\d{1,3}(,\d{3})*(\.\d+)?$|^[+-]?\d*\.?\d+([eE][+-]?\d+)?$/.test(value)) return null
    const parsed = Number(value.replace(/,/g, ''))
    return Number.isFinite(parsed) ? parsed : null
  }

  const numberLeft = asNumber(left)
  const numberRight = asNumber(right)
  if (numberLeft !== null && numberRight !== null) return numberLeft - numberRight

  return left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' })
}

/**
 * The order to draw the body in.
 *
 * Row 0 is the header and never moves. A sort is stable, so rows that compare
 * equal keep the order they have in the file, and turning a sort off returns
 * exactly the file's own order.
 */
export function viewOrder(
  rows: Rows,
  options: { sortColumn?: number | null; direction?: SortDirection; filter?: string } = {}
): ViewOrder {
  const { sortColumn = null, direction = 'asc', filter = '' } = options
  const body = rows.slice(1).map((_, index) => index + 1)

  const needle = filter.trim().toLowerCase()
  const kept = needle
    ? body.filter((index) =>
        (rows[index] ?? []).some((cell) => cell.toLowerCase().includes(needle))
      )
    : body

  if (sortColumn === null) return { order: kept, hidden: body.length - kept.length }

  const sorted = [...kept].sort((a, b) => {
    const result = compareCells(rows[a]?.[sortColumn] ?? '', rows[b]?.[sortColumn] ?? '')
    return direction === 'asc' ? result : -result
  })
  return { order: sorted, hidden: body.length - kept.length }
}

/** Move one column, header and every row with it. */
export function moveColumn(rows: Rows, from: number, to: number): string[][] {
  const width = Math.max(0, ...rows.map((row) => row.length))
  if (from === to || from < 0 || to < 0 || from >= width || to >= width) {
    return rows.map((row) => [...row])
  }
  return rows.map((row) => {
    const next = [...row]
    while (next.length < width) next.push('')
    const [cell] = next.splice(from, 1)
    next.splice(to, 0, cell ?? '')
    return next
  })
}

/**
 * Move one body row.
 *
 * Indexes are into the whole table, so row 0 is the header: it can be neither
 * the row moved nor the place it lands.
 */
export function moveRow(rows: Rows, from: number, to: number): string[][] {
  const copy = rows.map((row) => [...row])
  if (from === to || from < 1 || to < 1 || from >= rows.length || to >= rows.length) return copy
  const [row] = copy.splice(from, 1)
  if (row) copy.splice(to, 0, row)
  return copy
}

/** A new empty row, `at` being where it lands (never above the header). */
export function insertRow(rows: Rows, at: number, width: number): string[][] {
  const copy = rows.map((row) => [...row])
  const index = Math.min(Math.max(at, 1), copy.length)
  copy.splice(
    index,
    0,
    Array.from({ length: Math.max(1, width) }, () => '')
  )
  return copy
}

/** A new empty column at `at`, in the header and every row. */
export function insertColumn(rows: Rows, at: number, width: number): string[][] {
  const index = Math.min(Math.max(at, 0), Math.max(width, 0))
  return rows.map((row) => {
    const next = [...row]
    while (next.length < width) next.push('')
    next.splice(index, 0, '')
    return next
  })
}

export function deleteRow(rows: Rows, at: number): string[][] {
  if (at < 1 || at >= rows.length) return rows.map((row) => [...row])
  return rows.filter((_, index) => index !== at).map((row) => [...row])
}

export function deleteColumn(rows: Rows, at: number, width: number): string[][] {
  if (at < 0 || at >= width) return rows.map((row) => [...row])
  return rows.map((row) => {
    const next = [...row]
    while (next.length < width) next.push('')
    next.splice(at, 1)
    return next
  })
}

/**
 * A starting width for each column, from what is in it.
 *
 * Measured in characters and clamped: a column of paragraphs would otherwise
 * push everything else off the screen, and a column of empty strings would
 * collapse to nothing.
 */
export function columnWidths(
  rows: Rows,
  { min = 80, max = 340, perChar = 8, sample = 200 } = {}
): number[] {
  const width = Math.max(0, ...rows.map((row) => row.length))
  return Array.from({ length: width }, (_, col) => {
    let longest = 0
    for (const row of rows.slice(0, sample)) {
      longest = Math.max(longest, (row[col] ?? '').length)
    }
    return Math.min(max, Math.max(min, longest * perChar + 24))
  })
}
