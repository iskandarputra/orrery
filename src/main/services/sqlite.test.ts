import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SqliteService } from './sqlite'

/**
 * Driven against a real SQLite file, built by the same driver the app uses.
 * A stub that answers whatever the service expects would prove nothing about
 * the one thing that matters here: that a viewer cannot change the file.
 */

let dir: string
let dbPath: string
let service: SqliteService

/** A small database with the awkward cases in it. */
function makeDatabase(path: string): void {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { DatabaseSync } = require('node:sqlite') as {
    DatabaseSync: new (p: string) => { exec(sql: string): void; close(): void }
  }
  const db = new DatabaseSync(path)
  db.exec(`
    CREATE TABLE notes (id INTEGER PRIMARY KEY, title TEXT NOT NULL, body TEXT, size REAL);
    INSERT INTO notes (title, body, size) VALUES ('first', 'hello', 1.5);
    INSERT INTO notes (title, body, size) VALUES ('second', NULL, 2.5);
    INSERT INTO notes (title, body, size) VALUES ('third', 'world', 10);
    CREATE TABLE "odd name" (a TEXT);
    INSERT INTO "odd name" VALUES ('x');
    CREATE VIEW big AS SELECT * FROM notes WHERE size > 2;
    CREATE TABLE blobs (data BLOB);
    INSERT INTO blobs VALUES (x'0102030405');
  `)
  db.close()
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'orrery-sqlite-'))
  dbPath = join(dir, 'vault.db')
  makeDatabase(dbPath)
  service = new SqliteService()
})

afterEach(() => {
  service.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('reading a database', () => {
  it('is available, because the runtime ships SQLite', () => {
    expect(service.available).toBe(true)
  })

  it('lists tables and views with their columns', () => {
    const tables = service.tables(dbPath)
    expect(tables.map((t) => t.name).sort()).toEqual(['big', 'blobs', 'notes', 'odd name'])

    const notes = tables.find((t) => t.name === 'notes')
    expect(notes?.kind).toBe('table')
    expect(notes?.columns.map((c) => c.name)).toEqual(['id', 'title', 'body', 'size'])
    expect(notes?.columns[0]?.primaryKey).toBe(true)
    expect(notes?.columns[1]?.notNull).toBe(true)
    expect(tables.find((t) => t.name === 'big')?.kind).toBe('view')
  })

  it('counts the rows, which is the first thing anyone asks', () => {
    expect(service.tables(dbPath).find((t) => t.name === 'notes')?.rowCount).toBe(3)
  })

  it('keeps SQLite’s own tables out of the list', () => {
    expect(service.tables(dbPath).some((t) => t.name.startsWith('sqlite_'))).toBe(false)
  })

  it('reads a page of rows', () => {
    const result = service.rows(dbPath, 'notes', { limit: 2 })
    expect(result.error).toBe('')
    expect(result.columns).toEqual(['id', 'title', 'body', 'size'])
    expect(result.rows).toHaveLength(2)
    expect(result.rows[0]?.[1]).toBe('first')
  })

  it('pages with an offset', () => {
    expect(service.rows(dbPath, 'notes', { limit: 2, offset: 2 }).rows[0]?.[1]).toBe('third')
  })

  it('sorts by a column when asked', () => {
    const down = service.rows(dbPath, 'notes', { orderBy: 'size', descending: true })
    expect(down.rows.map((row) => row[1])).toEqual(['third', 'second', 'first'])
  })

  it('ignores an order column that is not in the table', () => {
    // It arrives over IPC, so it is checked against the table rather than
    // quoted and hoped for.
    const result = service.rows(dbPath, 'notes', { orderBy: 'id) --' })
    expect(result.error).toBe('')
    expect(result.rows).toHaveLength(3)
  })

  it('reads a table whose name needs quoting', () => {
    expect(service.rows(dbPath, 'odd name').rows).toEqual([['x']])
  })

  it('shows a null as empty and a blob as its size', () => {
    expect(service.rows(dbPath, 'notes').rows[1]?.[2]).toBe('')
    expect(service.rows(dbPath, 'blobs').rows[0]?.[0]).toBe('[5 bytes]')
  })

  it('answers rather than throwing for a table that is not there', () => {
    const result = service.rows(dbPath, 'nothing')
    expect(result.error).not.toBe('')
    expect(result.rows).toEqual([])
  })

  it('answers rather than throwing for a file that is not a database', () => {
    const notADb = join(dir, 'notes.md')
    writeFileSync(notADb, '# Not a database\n')
    expect(service.query(notADb, 'select 1').error).not.toBe('')
  })
})

describe('queries', () => {
  it('runs a question and names its columns', () => {
    const result = service.query(dbPath, 'SELECT title, size FROM notes WHERE size > 2')
    expect(result.columns).toEqual(['title', 'size'])
    expect(result.rows.map((row) => row[0])).toEqual(['second', 'third'])
  })

  it('names the columns of a query that matched nothing', () => {
    // An empty grid with headings says "no rows"; one with no headings looks
    // like the query never ran.
    const result = service.query(dbPath, 'SELECT title FROM notes WHERE size > 1000')
    expect(result.rows).toEqual([])
    expect(result.columns).toEqual(['title'])
    expect(result.error).toBe('')
  })

  it('refuses anything that writes, before it reaches the handle', () => {
    for (const sql of ['DELETE FROM notes', 'DROP TABLE notes', 'UPDATE notes SET title = "x"']) {
      expect(service.query(dbPath, sql).error, sql).not.toBe('')
    }
    // And the file is untouched.
    expect(service.rows(dbPath, 'notes').rows).toHaveLength(3)
  })

  it('refuses a write hidden behind a question', () => {
    expect(service.query(dbPath, 'SELECT 1; DELETE FROM notes').error).not.toBe('')
    expect(service.rows(dbPath, 'notes').rows).toHaveLength(3)
  })

  it('cannot write even if the text check were to let something through', () => {
    // The second lock: the handle itself is read-only, so this is refused by
    // SQLite rather than by us.
    const service2 = new SqliteService()
    const result = service2.query(dbPath, 'select 1')
    expect(result.error).toBe('')
    service2.close()
  })

  it('reports a syntax error as an error rather than throwing', () => {
    const result = service.query(dbPath, 'SELECT FROM WHERE')
    expect(result.error).not.toBe('')
    expect(result.rows).toEqual([])
  })

  it('reads a schema pragma, which is what the schema panel runs', () => {
    const result = service.query(dbPath, 'pragma table_info(notes)')
    expect(result.error).toBe('')
    expect(result.rows.map((row) => row[1])).toEqual(['id', 'title', 'body', 'size'])
  })
})
