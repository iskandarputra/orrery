import { useCallback, useEffect, useRef, useState } from 'react'
import { columnCount, formatCsv, padRow, parseCsv, type CsvTable } from '@core/csv'
import { viewForBuffer } from '@/editor/active-view'
import { useDocVersion } from '@/state/doc-version'
import { Icon } from '@/components/Icon'
import { EmptyState } from '@/components/PanelBits'

/**
 * A spreadsheet view of a CSV file.
 *
 * A CSV opened as text is a wall of commas: the columns are the whole point of
 * the format and the one thing a text editor cannot show. This lays it out as a
 * grid, keeps the first row as a header, and lets a cell be edited in place.
 *
 * Edits go back through the buffer's document, the way the canvas and the
 * drawing surface do, so dirty state, Ctrl+S, autosave and undo are the app's
 * own rather than a second implementation of each.
 */

/** How long to wait after the last keystroke before writing back. */
const COMMIT_DELAY = 400

export function CsvEditor({ bufferId }: { bufferId: string }): React.JSX.Element {
  const version = useDocVersion((v) => v[bufferId] ?? 0)
  const [failed, setFailed] = useState(false)
  const [table, setTable] = useState<{ key: string; value: CsvTable } | null>(null)
  const [sceneKey, setSceneKey] = useState(0)
  const [selected, setSelected] = useState<{ row: number; col: number } | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** The text this surface last read or wrote, to tell its own edits apart. */
  const committedRef = useRef<string | null>(null)
  /** Nothing is written back before a real document has been read. */
  const loadedRef = useRef(false)

  const key = `${bufferId}:${sceneKey}`
  const current = table?.key === key ? table.value : null

  /**
   * Read the file once the pane has an editor to read it from.
   *
   * The pane registers its view in an effect and a child's effects run first,
   * so reading during render would find no document, show an empty grid, and
   * write that emptiness back over the file.
   */
  useEffect(() => {
    loadedRef.current = false
    let live = true
    let frame = 0

    const attempt = (tries: number): void => {
      if (!live) return
      const view = viewForBuffer(bufferId)
      if (!view) {
        if (tries > 120) {
          setFailed(true)
          return
        }
        frame = requestAnimationFrame(() => attempt(tries + 1))
        return
      }
      const text = view.state.doc.toString()
      committedRef.current = text
      setTable({ key, value: parseCsv(text) })
      loadedRef.current = true
    }
    frame = requestAnimationFrame(() => attempt(0))
    return () => {
      live = false
      cancelAnimationFrame(frame)
    }
  }, [bufferId, sceneKey, key])

  /** Rebuild when the document changed underneath, but not for our own writes. */
  useEffect(() => {
    const text = viewForBuffer(bufferId)?.state.doc.toString() ?? ''
    if (committedRef.current !== null && text !== committedRef.current) {
      committedRef.current = text
      setSceneKey((k) => k + 1)
    }
  }, [version, bufferId])

  const commit = useCallback(
    (next: CsvTable) => {
      setTable({ key, value: next })
      if (!loadedRef.current) return
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        const view = viewForBuffer(bufferId)
        if (!view || !loadedRef.current) return
        const text = formatCsv(next)
        if (text === view.state.doc.toString()) return
        committedRef.current = text
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } })
      }, COMMIT_DELAY)
    },
    [bufferId, key]
  )

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    },
    []
  )

  if (failed) return <EmptyState icon="alert-triangle">That file could not be read.</EmptyState>
  if (!current) return <EmptyState icon="table">Opening the table…</EmptyState>

  const width = Math.max(1, columnCount(current.rows))
  const [header = [], ...body] = current.rows

  const setCell = (row: number, col: number, value: string): void => {
    const rows = current.rows.map((r, i) => (i === row ? padRow(r, width) : r))
    const target = rows[row]
    if (!target) return
    target[col] = value
    commit({ ...current, rows })
  }

  const addRow = (): void => commit({ ...current, rows: [...current.rows, Array(width).fill('')] })

  const addColumn = (): void =>
    commit({ ...current, rows: current.rows.map((r) => [...padRow(r, width), '']) })

  const deleteRow = (row: number): void =>
    commit({ ...current, rows: current.rows.filter((_, i) => i !== row) })

  const deleteColumn = (col: number): void =>
    commit({
      ...current,
      rows: current.rows.map((r) => padRow(r, width).filter((_, i) => i !== col))
    })

  const cell = (row: number, col: number, value: string, isHeader: boolean): React.JSX.Element => {
    const Tag = isHeader ? 'th' : 'td'
    const active = selected?.row === row && selected?.col === col
    return (
      <Tag key={col} className={`csv__cell${active ? ' csv__cell--active' : ''}`}>
        <input
          className="csv__input"
          value={value}
          aria-label={`Row ${row + 1}, column ${col + 1}`}
          onFocus={() => setSelected({ row, col })}
          onChange={(e) => setCell(row, col, e.target.value)}
        />
      </Tag>
    )
  }

  return (
    <div className="csv">
      <div className="csv__bar">
        <span className="csv__shape">
          {current.rows.length} row{current.rows.length === 1 ? '' : 's'} · {width} column
          {width === 1 ? '' : 's'}
        </span>
        {current.delimiter !== ',' && (
          <span className="csv__delimiter" title="Delimiter used by this file">
            {current.delimiter === '\t' ? 'tab' : current.delimiter} separated
          </span>
        )}
        <button className="csv__action" onClick={addRow}>
          <Icon name="plus" size={12} /> Row
        </button>
        <button className="csv__action" onClick={addColumn}>
          <Icon name="plus" size={12} /> Column
        </button>
      </div>

      <div className="csv__scroll">
        <table className="csv__table">
          <thead>
            <tr>
              <th className="csv__gutter" />
              {padRow(header, width).map((value, col) => (
                <th key={col} className="csv__head">
                  <input
                    className="csv__input csv__input--head"
                    value={value}
                    aria-label={`Column ${col + 1} name`}
                    onFocus={() => setSelected({ row: 0, col })}
                    onChange={(e) => setCell(0, col, e.target.value)}
                  />
                  <button
                    className="csv__drop"
                    aria-label={`Delete column ${col + 1}`}
                    title="Delete column"
                    onClick={() => deleteColumn(col)}
                  >
                    <Icon name="x" size={11} />
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {body.map((row, index) => (
              <tr key={index}>
                <th className="csv__gutter">
                  <span className="csv__number">{index + 2}</span>
                  <button
                    className="csv__drop"
                    aria-label={`Delete row ${index + 2}`}
                    title="Delete row"
                    onClick={() => deleteRow(index + 1)}
                  >
                    <Icon name="x" size={11} />
                  </button>
                </th>
                {padRow(row, width).map((value, col) => cell(index + 1, col, value, false))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
