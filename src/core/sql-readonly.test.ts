import { describe, expect, it } from 'vitest'
import { isReadOnlySql, splitStatements } from './sql-readonly'

const allowed = (sql: string): boolean => isReadOnlySql(sql).ok

describe('splitStatements', () => {
  it('splits on semicolons', () => {
    expect(splitStatements('select 1; select 2')).toEqual(['select 1', 'select 2'])
  })

  it('ignores a semicolon inside a string', () => {
    // Naive splitting would make this two statements and refuse the second.
    expect(splitStatements("select ';' as x")).toEqual(["select ';' as x"])
  })

  it('handles a doubled quote inside a string', () => {
    expect(splitStatements("select 'it''s; fine'")).toHaveLength(1)
  })

  it('ignores a semicolon in a comment', () => {
    expect(splitStatements('select 1 -- ;\nfrom t')).toHaveLength(1)
    expect(splitStatements('select /* ; */ 1')).toHaveLength(1)
  })

  it('drops empty statements from trailing semicolons', () => {
    expect(splitStatements('select 1;;  ;')).toEqual(['select 1'])
    expect(splitStatements('   ')).toEqual([])
  })

  it('keeps quoted identifiers whole', () => {
    expect(splitStatements('select "a;b" from t')).toHaveLength(1)
  })
})

describe('isReadOnlySql', () => {
  it('allows the statements a viewer is for', () => {
    expect(allowed('SELECT * FROM notes')).toBe(true)
    expect(allowed('with recent as (select 1) select * from recent')).toBe(true)
    expect(allowed('EXPLAIN QUERY PLAN SELECT 1')).toBe(true)
    expect(allowed('values (1), (2)')).toBe(true)
    expect(allowed('pragma table_info(notes)')).toBe(true)
  })

  it('refuses everything that writes', () => {
    for (const sql of [
      'DELETE FROM notes',
      'drop table notes',
      'insert into notes values (1)',
      'update notes set body = ""',
      'create table x (a int)',
      'alter table notes add column x',
      'vacuum',
      'replace into notes values (1)',
      'begin; delete from notes; commit'
    ]) {
      expect(allowed(sql), sql).toBe(false)
    }
  })

  it('checks every statement, not only the first', () => {
    // The whole reason this reads the text rather than the leading word.
    expect(allowed('SELECT 1; DROP TABLE notes')).toBe(false)
    expect(allowed('select 1;\nupdate notes set a = 1')).toBe(false)
  })

  it('is not fooled by comments or whitespace before the verb', () => {
    expect(allowed('  -- a note\n  DROP TABLE notes')).toBe(false)
    expect(allowed('/* hidden */ delete from notes')).toBe(false)
    expect(allowed('  /* fine */ select 1')).toBe(true)
  })

  it('allows only the pragmas that ask a question', () => {
    // SQLite spells a question and an instruction the same way, so the names
    // are listed rather than the shapes.
    expect(allowed('pragma table_info(notes)')).toBe(true)
    expect(allowed('PRAGMA foreign_key_list(notes)')).toBe(true)

    expect(allowed('pragma journal_mode = wal')).toBe(false)
    expect(allowed('PRAGMA foreign_keys=off')).toBe(false)
    // Written as a call, which is the form that looks like a question.
    expect(allowed('pragma foreign_keys(off)')).toBe(false)
    expect(allowed('pragma writable_schema(on)')).toBe(false)
  })

  it('refuses attaching another database', () => {
    // A query that can attach has a second file to write to.
    expect(allowed("attach database '/tmp/x.db' as x")).toBe(false)
    expect(allowed("select 1 from t where x = (attach database '/tmp/x.db' as y)")).toBe(false)
  })

  it('says why, in words the person who typed it can act on', () => {
    expect(isReadOnlySql('DROP TABLE notes').reason).toContain('DROP')
    expect(isReadOnlySql('').reason).toContain('Nothing to run')
  })
})
