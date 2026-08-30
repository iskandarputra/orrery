import { isReadOnlySql } from '@core/sql-readonly'
import type { DbQueryResult, DbTableInfo } from '@shared/types'

/**
 * Reading SQLite files.
 *
 * A `.db` in a vault is a document like any other: a table of things somebody
 * kept. It cannot be read as text — that is a page header and a B-tree, not
 * prose — so it gets a viewer of its own.
 *
 * No new dependency. Node ships SQLite as `node:sqlite`, and Electron carries
 * that Node, so the driver is already on the machine. It is loaded lazily and
 * a failure is reported rather than thrown, exactly as the terminal treats
 * node-pty: an Orrery built against a runtime without it opens everything else
 * as before.
 *
 * Read-only, twice over. The handle is opened read-only so the file cannot be
 * changed whatever is asked of it, and `core/sql-readonly` refuses anything but
 * a question before the text reaches the handle. Two checks because the query
 * box is a box anything can be typed into, an assistant with a tool included.
 */

interface Statement {
  all(...params: unknown[]): Record<string, unknown>[]
  columns(): { name: string }[]
}

interface Database {
  prepare(sql: string): Statement
  close(): void
}

interface SqliteModule {
  DatabaseSync: new (path: string, options?: { readOnly?: boolean }) => Database
}

/** Rows past this and an answer is a wall nobody scrolls. */
const MAX_ROWS = 5000

export class SqliteService {
  private module: SqliteModule | null = null
  private loadFailed = false
  /** One handle per file, kept open while its tab is. */
  private readonly open = new Map<string, Database>()

  /**
   * Load `node:sqlite` on first use.
   *
   * A failure is remembered rather than retried: the runtime either has it or
   * does not, and retrying per keystroke would turn one absence into a stream
   * of identical errors.
   */
  private load(): SqliteModule | null {
    if (this.module || this.loadFailed) return this.module
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      this.module = require('node:sqlite') as SqliteModule
    } catch (err) {
      this.loadFailed = true
      console.error('node:sqlite unavailable; the database viewer is disabled:', err)
    }
    return this.module
  }

  get available(): boolean {
    return this.load() !== null
  }

  private handle(path: string): Database | null {
    const existing = this.open.get(path)
    if (existing) return existing
    const sqlite = this.load()
    if (!sqlite) return null
    try {
      // Read-only at the handle, so nothing that gets past the text check can
      // change the file either.
      const db = new sqlite.DatabaseSync(path, { readOnly: true })
      this.open.set(path, db)
      return db
    } catch (err) {
      console.error(`Could not open ${path}:`, err)
      return null
    }
  }

  /**
   * What is in this database.
   *
   * Tables and views together, each with its columns and how many rows it
   * holds, because "how big is this" is the first question anyone asks of a
   * table they have never seen.
   */
  tables(path: string): DbTableInfo[] {
    const db = this.handle(path)
    if (!db) return []
    try {
      const rows = db
        .prepare(
          `SELECT name, type, sql FROM sqlite_master
           WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%'
           ORDER BY type, name`
        )
        .all() as { name: string; type: string; sql: string | null }[]

      return rows.map((row) => {
        const columns = db
          .prepare(`PRAGMA table_info(${quoteName(row.name)})`)
          .all()
          .map((column) => ({
            name: String(column['name'] ?? ''),
            type: String(column['type'] ?? ''),
            primaryKey: Number(column['pk'] ?? 0) > 0,
            notNull: Number(column['notnull'] ?? 0) > 0
          }))

        let rowCount = -1
        try {
          const counted = db.prepare(`SELECT COUNT(*) AS n FROM ${quoteName(row.name)}`).all()
          rowCount = Number(counted[0]?.['n'] ?? -1)
        } catch {
          // A view over a missing table counts as unknown rather than as zero.
        }

        return {
          name: row.name,
          kind: row.type === 'view' ? ('view' as const) : ('table' as const),
          sql: row.sql ?? '',
          columns,
          rowCount
        }
      })
    } catch (err) {
      console.error(`Could not read the schema of ${path}:`, err)
      return []
    }
  }

  /** One page of a table, in the database's own order unless one is asked for. */
  rows(
    path: string,
    table: string,
    { limit = 200, offset = 0, orderBy = '', descending = false } = {}
  ): DbQueryResult {
    const columns = this.tables(path).find((info) => info.name === table)?.columns ?? []
    // The order column is checked against the table's own columns rather than
    // quoted and hoped for: it arrives from a click, but it arrives over IPC.
    const order = columns.some((column) => column.name === orderBy)
      ? ` ORDER BY ${quoteName(orderBy)} ${descending ? 'DESC' : 'ASC'}`
      : ''
    const size = Math.min(Math.max(1, Math.trunc(limit)), MAX_ROWS)
    const from = Math.max(0, Math.trunc(offset))

    return this.query(
      path,
      `SELECT * FROM ${quoteName(table)}${order} LIMIT ${size} OFFSET ${from}`
    )
  }

  /** Run a question. Anything that is not one comes back as an error. */
  query(path: string, sql: string): DbQueryResult {
    const verdict = isReadOnlySql(sql)
    if (!verdict.ok) return { columns: [], rows: [], error: verdict.reason, truncated: false }

    const db = this.handle(path)
    if (!db) {
      return {
        columns: [],
        rows: [],
        error: this.available ? 'That database could not be opened.' : 'SQLite is not available.',
        truncated: false
      }
    }

    try {
      const statement = db.prepare(sql)
      const rows = statement.all()
      const columns =
        rows.length > 0
          ? Object.keys(rows[0] ?? {})
          : statement.columns().map((column) => column.name)

      return {
        columns,
        rows: rows.slice(0, MAX_ROWS).map((row) => columns.map((name) => cellText(row[name]))),
        error: '',
        truncated: rows.length > MAX_ROWS
      }
    } catch (err) {
      return {
        columns: [],
        rows: [],
        error: err instanceof Error ? err.message : 'That query failed.',
        truncated: false
      }
    }
  }

  /** Let go of one file, or of all of them on quit. */
  close(path?: string): void {
    for (const [key, db] of [...this.open.entries()]) {
      if (path && key !== path) continue
      try {
        db.close()
      } catch {
        // Already gone.
      }
      this.open.delete(key)
    }
  }
}

/** An identifier, quoted so a table called `select` or `a"b` still works. */
function quoteName(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}

/**
 * A cell as text.
 *
 * Everything reaches the renderer as a string, because a grid draws strings and
 * because JSON cannot carry a `BigInt` or a `Buffer` across the boundary. A
 * blob says how big it is rather than arriving as mojibake.
 */
function cellText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'bigint') return value.toString()
  // `ArrayBuffer.isView` rather than `instanceof Uint8Array`: the driver's
  // buffers can come from another realm, where the instance check quietly
  // fails and the blob is stringified into `{"0":1,"1":2,…}`.
  if (value instanceof ArrayBuffer) return `[${value.byteLength} bytes]`
  if (ArrayBuffer.isView(value)) return `[${value.byteLength} bytes]`
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}
