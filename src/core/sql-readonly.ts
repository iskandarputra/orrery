/**
 * Which SQL a viewer may run.
 *
 * The database viewer opens files a vault happens to contain, and the box it
 * offers for queries is a box anything can be typed into — including by an
 * assistant with a tool, once one is pointed at it. So the answer to "may this
 * run" is decided here, over the text, before anything reaches a database
 * handle: SQLite itself is opened read-only as well, but a check that exists in
 * only one place is a check that moves when the code does.
 *
 * The rule is an allow-list of leading keywords, applied to every statement in
 * the text rather than to the first one. `SELECT 1; DROP TABLE notes` is two
 * statements, and reading only the first is exactly how this goes wrong.
 */

/** Statements that only read. `PRAGMA` is included; the writing forms are not. */
const READING = ['select', 'with', 'explain', 'values', 'pragma', 'analyze']

/**
 * The pragmas a viewer needs, and no others.
 *
 * SQLite spells a question and an instruction the same way: `PRAGMA
 * table_info(notes)` asks, and `PRAGMA foreign_keys(off)` sets, and the syntax
 * cannot tell them apart. So the names are listed rather than the shapes, and
 * anything not on the list is refused whichever way it was written.
 */
const READ_PRAGMAS = new Set([
  'table_info',
  'table_xinfo',
  'table_list',
  'index_list',
  'index_info',
  'index_xinfo',
  'foreign_key_list',
  'database_list',
  'collation_list',
  'function_list',
  'module_list',
  'compile_options',
  'page_count',
  'page_size',
  'user_version',
  'schema_version',
  'freelist_count',
  'encoding',
  'integrity_check',
  'quick_check'
])

export interface SqlVerdict {
  ok: boolean
  /** Why not, in a sentence the person who typed it can act on. */
  reason: string
}

/**
 * Split SQL into statements, ignoring semicolons inside strings and comments.
 *
 * Naive splitting on `;` treats `SELECT ';'` as two statements and a trailing
 * `-- ;` as three, which would refuse perfectly ordinary queries.
 */
export function splitStatements(sql: string): string[] {
  const statements: string[] = []
  let current = ''
  let quote: "'" | '"' | '`' | null = null
  let lineComment = false
  let blockComment = false

  for (let i = 0; i < sql.length; i++) {
    const char = sql[i] as string
    const next = sql[i + 1]

    if (lineComment) {
      if (char === '\n') lineComment = false
      current += char
      continue
    }
    if (blockComment) {
      if (char === '*' && next === '/') {
        blockComment = false
        current += '*/'
        i++
        continue
      }
      current += char
      continue
    }
    if (quote) {
      current += char
      // Doubled quotes are an escaped quote, not the end of the string.
      if (char === quote && next === quote) {
        current += next
        i++
      } else if (char === quote) {
        quote = null
      }
      continue
    }

    if (char === '-' && next === '-') {
      lineComment = true
      current += '--'
      i++
      continue
    }
    if (char === '/' && next === '*') {
      blockComment = true
      current += '/*'
      i++
      continue
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char
      current += char
      continue
    }
    if (char === ';') {
      statements.push(current)
      current = ''
      continue
    }
    current += char
  }

  statements.push(current)
  return statements.map((statement) => statement.trim()).filter((statement) => statement !== '')
}

/** The statement with its comments and leading whitespace removed. */
function bare(statement: string): string {
  return statement
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .trim()
    .toLowerCase()
}

/**
 * May this text be run against a database that is only being looked at?
 *
 * Every statement in it must read, and nothing may attach another file: a query
 * that can attach can write to whatever it attached.
 */
export function isReadOnlySql(sql: string): SqlVerdict {
  const statements = splitStatements(sql)
  if (statements.length === 0) return { ok: false, reason: 'Nothing to run.' }

  for (const statement of statements) {
    const text = bare(statement)
    if (text === '') continue

    const keyword = /^[a-z]+/.exec(text)?.[0] ?? ''
    if (!READING.includes(keyword)) {
      return {
        ok: false,
        reason: `The viewer only reads: ${keyword.toUpperCase() || 'that'} is not allowed.`
      }
    }
    if (keyword === 'pragma') {
      const name = /^pragma\s+(?:[\w]+\.)?([\w]+)/.exec(text)?.[1] ?? ''
      // An `=` is always an instruction; a name that is not on the list may be
      // one, and the syntax will not say.
      if (text.includes('=') || !READ_PRAGMAS.has(name)) {
        return { ok: false, reason: `PRAGMA ${name || ''} is not one the viewer may run.`.trim() }
      }
    }
    // `ATTACH` can appear inside an otherwise innocent statement, and gives a
    // query a second file to write to.
    if (/\battach\b/.test(text)) {
      return { ok: false, reason: 'Attaching another database is not allowed here.' }
    }
  }

  return { ok: true, reason: '' }
}
