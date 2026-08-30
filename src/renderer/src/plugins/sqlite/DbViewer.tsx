import { useEffect, useState } from 'react'
import type { DbQueryResult, DbTableInfo } from '@shared/types'
import { invoke } from '@/services/client'
import { useStore } from '@/state/store'
import { Icon } from '@/components/Icon'
import { EmptyState } from '@/components/PanelBits'

/**
 * A SQLite file, read.
 *
 * A `.db` in a vault is a document like any other — a table of things somebody
 * kept — and the one document an editor cannot open, because its bytes are a
 * B-tree rather than prose. This lists what is inside, shows a table a page at
 * a time, and takes a question in SQL.
 *
 * It only reads. The file is opened read-only and the SQL is checked before it
 * reaches the handle, so nothing typed here can change a database the app was
 * merely asked to look at. That is said on screen rather than left to be
 * discovered.
 */

const PAGE = 200

export function DbViewer({ bufferId }: { bufferId: string }): React.JSX.Element {
  const path = useStore((s) => s.buffers[bufferId]?.filePath ?? '')
  const [available, setAvailable] = useState<boolean | null>(null)
  const [tables, setTables] = useState<DbTableInfo[]>([])
  const [selected, setSelected] = useState<string>('')
  const [result, setResult] = useState<DbQueryResult | null>(null)
  const [offset, setOffset] = useState(0)
  const [order, setOrder] = useState<{ column: string; descending: boolean } | null>(null)
  const [sql, setSql] = useState('')
  const [showSql, setShowSql] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    void invoke('db:available', undefined)
      .then((ok) => live && setAvailable(ok))
      .catch(() => live && setAvailable(false))
    return () => {
      live = false
    }
  }, [])

  useEffect(() => {
    if (!path) return
    let live = true
    void invoke('db:tables', { path })
      .then((found) => {
        if (!live) return
        setTables(found)
        setSelected((current) => current || (found[0]?.name ?? ''))
      })
      .catch(() => live && setTables([]))
    return () => {
      live = false
    }
  }, [path])

  // The handle is held open while the tab is; letting go is what closes the
  // file, so a database is not locked by a tab nobody is looking at.
  useEffect(
    () => () => {
      if (path) void invoke('db:close', { path })
    },
    [path]
  )

  /**
   * Rows for whatever is selected, whenever that changes.
   *
   * The fetch lives in the effect rather than in a callback the effect calls:
   * `busy` is turned on by the click that caused the change, and off by the
   * answer arriving, so nothing sets state in the body of an effect.
   */
  useEffect(() => {
    if (!path || !selected) return
    let live = true
    invoke('db:rows', {
      path,
      table: selected,
      limit: PAGE,
      offset,
      orderBy: order?.column ?? '',
      descending: order?.descending ?? false
    })
      .then((rows) => {
        if (!live) return
        setResult(rows)
        setBusy(false)
      })
      .catch(() => live && setBusy(false))
    return () => {
      live = false
    }
  }, [path, selected, offset, order])

  const runSql = (): void => {
    if (!path || !sql.trim()) return
    setBusy(true)
    void invoke('db:query', { path, sql })
      .then(setResult)
      .finally(() => setBusy(false))
  }

  if (available === false) {
    return (
      <EmptyState icon="alert-triangle">
        This build has no SQLite, so database files cannot be opened.
      </EmptyState>
    )
  }
  if (available === null) return <EmptyState icon="table">Opening the database…</EmptyState>
  if (tables.length === 0) {
    return <EmptyState icon="table">No tables in this file, or it is not a database.</EmptyState>
  }

  const current = tables.find((table) => table.name === selected)
  const rows = result?.rows ?? []

  return (
    <div className="db">
      <aside className="db__tables">
        <h3 className="db__tables-title">Tables</h3>
        {tables.map((table) => (
          <button
            key={table.name}
            className={`db__table${table.name === selected ? ' db__table--active' : ''}`}
            title={table.sql || table.name}
            onClick={() => {
              setBusy(true)
              setSelected(table.name)
              setOffset(0)
              setOrder(null)
              setShowSql(false)
            }}
          >
            <Icon name={table.kind === 'view' ? 'eye' : 'table'} size={13} />
            <span className="db__table-name">{table.name}</span>
            <span className="db__table-rows">{table.rowCount < 0 ? '?' : table.rowCount}</span>
          </button>
        ))}
      </aside>

      <div className="db__main">
        <div className="db__bar">
          <span className="db__shape">
            {current ? (
              <>
                {current.columns.length} column{current.columns.length === 1 ? '' : 's'}
                {current.rowCount >= 0 && ` · ${current.rowCount} rows`}
              </>
            ) : (
              'Query'
            )}
          </span>
          <span className="db__readonly" title="The file is opened read-only">
            <Icon name="eye" size={11} /> read-only
          </span>

          <button
            className={`db__action${showSql ? ' db__action--active' : ''}`}
            onClick={() => setShowSql((open) => !open)}
          >
            <Icon name="terminal" size={12} /> SQL
          </button>
          <button
            className="db__action"
            disabled={offset === 0 || busy}
            onClick={() => {
              setBusy(true)
              setOffset(Math.max(0, offset - PAGE))
            }}
          >
            <Icon name="arrow-left" size={12} /> Back
          </button>
          <button
            className="db__action"
            disabled={rows.length < PAGE || busy}
            onClick={() => {
              setBusy(true)
              setOffset(offset + PAGE)
            }}
          >
            Next
          </button>
          <span className="db__page">
            {rows.length === 0 ? 'no rows' : `${offset + 1}–${offset + rows.length}`}
          </span>
        </div>

        {showSql && (
          <div className="db__sql">
            <textarea
              className="db__sql-input"
              rows={3}
              spellCheck={false}
              placeholder={`select * from ${selected || 'table'} limit 20`}
              aria-label="SQL query"
              value={sql}
              onChange={(e) => setSql(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault()
                  runSql()
                }
              }}
            />
            <div className="db__sql-actions">
              <span className="db__sql-hint">Questions only. Ctrl+Enter runs it.</span>
              <button className="btn btn--primary" disabled={busy} onClick={runSql}>
                Run
              </button>
            </div>
          </div>
        )}

        {result?.error ? (
          <p className="db__error">{result.error}</p>
        ) : (
          <div className="db__scroll">
            <table className="db__grid">
              <thead>
                <tr>
                  <th className="db__gutter" />
                  {(result?.columns ?? []).map((column) => {
                    const sortable = current?.columns.some((c) => c.name === column) ?? false
                    return (
                      <th key={column} className="db__head">
                        <button
                          className="db__sort"
                          disabled={!sortable}
                          title={sortable ? 'Sort by this column' : 'Sorting needs a table column'}
                          onClick={() => {
                            setBusy(true)
                            setOrder((currentOrder) =>
                              currentOrder?.column !== column
                                ? { column, descending: false }
                                : currentOrder.descending
                                  ? null
                                  : { column, descending: true }
                            )
                          }}
                        >
                          <span className="db__head-name">{column}</span>
                          {order?.column === column && (
                            <Icon
                              name={order.descending ? 'chevron-down' : 'chevron-up'}
                              size={11}
                            />
                          )}
                        </button>
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={index}>
                    <th className="db__gutter">
                      <span className="db__number">{offset + index + 1}</span>
                    </th>
                    {row.map((cell, col) => (
                      <td key={col} className="db__cell" title={cell}>
                        {cell === '' ? <span className="db__null">null</span> : cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length === 0 && !busy && <p className="db__empty">No rows.</p>}
            {result?.truncated && <p className="db__empty">Showing the first rows only.</p>}
          </div>
        )}
      </div>
    </div>
  )
}
