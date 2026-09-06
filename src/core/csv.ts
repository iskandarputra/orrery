/**
 * Reading and writing CSV, to RFC 4180.
 *
 * Splitting on commas is wrong for most real files. A field may be quoted, and
 * a quoted field may contain commas, newlines and quotes of its own, so the
 * only way to know where a row ends is to read it character by character and
 * keep track of whether you are inside quotes.
 *
 * Kept pure and separate from the editor so that every one of those cases can
 * be tested without a table on screen.
 */

/** What separates fields. Comma unless the file says otherwise. */
export type Delimiter = ',' | ';' | '\t' | '|'

const DELIMITERS: Delimiter[] = [',', ';', '\t', '|']

export interface CsvTable {
  rows: string[][]
  delimiter: Delimiter
  /** The line ending the file used, so writing it back does not change it. */
  eol: '\n' | '\r\n'
}

/**
 * Guess the delimiter from the first line.
 *
 * Whichever candidate appears most often outside quotes. A semicolon-separated
 * export from a European spreadsheet is common enough that assuming a comma
 * would render one column of joined-up text.
 */
export function detectDelimiter(text: string): Delimiter {
  const line = text.slice(0, text.search(/\r?\n/) === -1 ? text.length : text.search(/\r?\n/))
  let best: Delimiter = ','
  let bestCount = 0
  for (const candidate of DELIMITERS) {
    let count = 0
    let quoted = false
    for (let i = 0; i < line.length; i++) {
      const char = line[i]
      if (char === '"') quoted = !quoted
      else if (char === candidate && !quoted) count++
    }
    if (count > bestCount) {
      best = candidate
      bestCount = count
    }
  }
  return best
}

/**
 * Parse a whole file into rows of fields.
 *
 * A trailing newline ends the last row rather than starting an empty one, which
 * is what every writer produces and what a reader that appends a blank row on
 * every save would slowly corrupt.
 */
export function parseCsv(text: string, delimiter?: Delimiter): CsvTable {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const sep = delimiter ?? detectDelimiter(text)
  if (text === '') return { rows: [], delimiter: sep, eol }

  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false

  for (let i = 0; i < text.length; i++) {
    const char = text[i]!

    if (quoted) {
      if (char === '"') {
        // A doubled quote inside a quoted field is one literal quote.
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          quoted = false
        }
      } else {
        field += char
      }
      continue
    }

    if (char === '"' && field === '') {
      quoted = true
    } else if (char === sep) {
      row.push(field)
      field = ''
    } else if (char === '\n' || char === '\r') {
      // \r\n counts once.
      if (char === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else {
      field += char
    }
  }

  // Whatever is left is a final row, unless the file ended on a newline.
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return { rows, delimiter: sep, eol }
}

/** Whether a field has to be quoted to survive a round trip. */
function needsQuoting(field: string, delimiter: string): boolean {
  return (
    field.includes(delimiter) ||
    field.includes('"') ||
    field.includes('\n') ||
    field.includes('\r') ||
    field !== field.trim()
  )
}

/** One field, quoted only where quoting is required. */
export function formatField(field: string, delimiter: Delimiter = ','): string {
  return needsQuoting(field, delimiter) ? `"${field.replace(/"/g, '""')}"` : field
}

/**
 * Write a table back out.
 *
 * Quotes only what needs quoting, so a file that was readable stays readable
 * and a diff shows the cell that changed rather than every line.
 */
export function formatCsv(table: CsvTable): string {
  if (table.rows.length === 0) return ''
  const body = table.rows
    .map((row) => row.map((field) => formatField(field, table.delimiter)).join(table.delimiter))
    .join(table.eol)
  return body + table.eol
}

/** The widest row, so the table can render a rectangle. */
export function columnCount(rows: readonly string[][]): number {
  return rows.reduce((widest, row) => Math.max(widest, row.length), 0)
}

/** A row padded out to `width`, for rendering a ragged file as a grid. */
export function padRow(row: readonly string[], width: number): string[] {
  return width <= row.length ? [...row] : [...row, ...Array(width - row.length).fill('')]
}
