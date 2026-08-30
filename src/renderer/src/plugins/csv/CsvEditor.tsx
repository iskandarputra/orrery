import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { columnCount, formatCsv, padRow, parseCsv, type CsvTable } from '@core/csv'
import {
  columnWidths,
  deleteColumn,
  deleteRow,
  insertColumn,
  insertRow,
  moveColumn,
  moveRow,
  viewOrder,
  type SortDirection
} from '@core/table-ops'
import { viewForBuffer } from '@/editor/active-view'
import { useDocVersion } from '@/state/doc-version'
import { Icon } from '@/components/Icon'
import { EmptyState } from '@/components/PanelBits'

/**
 * A spreadsheet view of a CSV file.
 *
 * A CSV opened as text is a wall of commas: the columns are the whole point of
 * the format and the one thing a text editor cannot show. This lays it out as a
 * grid that can be sorted, filtered, resized and rearranged by dragging, and
 * edited in place.
 *
 * Two rules keep it honest. **Sorting and filtering never touch the file**:
 * they choose an order to draw in, and every edit is written back through that
 * order to the row it really came from, so glancing at a column cannot reorder
 * someone's data and typing into a sorted view cannot put the value in the
 * wrong row. **Dragging does touch the file**, because moving a column is a
 * change to the table rather than a way of looking at it.
 *
 * Edits go back through the buffer's document, the way the canvas and the
 * drawing surface do, so dirty state, Ctrl+S, autosave and undo are the app's
 * own rather than a second implementation of each.
 */

/** How long to wait after the last keystroke before writing back. */
const COMMIT_DELAY = 400
/** Narrower than this and a column is a sliver nobody can read or grab. */
const MIN_COLUMN = 56

type Drag =
  | { kind: 'column'; from: number; over: number }
  | { kind: 'row'; from: number; over: number }
  | null

export function CsvEditor({ bufferId }: { bufferId: string }): React.JSX.Element {
  const version = useDocVersion((v) => v[bufferId] ?? 0)
  const [failed, setFailed] = useState(false)
  const [table, setTable] = useState<{ key: string; value: CsvTable } | null>(null)
  const [sceneKey, setSceneKey] = useState(0)
  const [selected, setSelected] = useState<{ row: number; col: number } | null>(null)
  const [sort, setSort] = useState<{ column: number; direction: SortDirection } | null>(null)
  const [filter, setFilter] = useState('')
  const [widths, setWidths] = useState<number[]>([])
  const [drag, setDrag] = useState<Drag>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** The text this surface last read or wrote, to tell its own edits apart. */
  const committedRef = useRef<string | null>(null)
  /** Nothing is written back before a real document has been read. */
  const loadedRef = useRef(false)
  const gridRef = useRef<HTMLTableElement>(null)

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
      const parsed = parseCsv(text)
      setTable({ key, value: parsed })
      setWidths(columnWidths(parsed.rows))
      loadedRef.current = true
    }
    frame = requestAnimationFrame(() => attempt(0))
    return () => {
      live = false
      cancelAnimationFrame(frame)
    }
  }, [bufferId, key])

  /** The file changed underneath: on disk, or by undo. */
  useEffect(() => {
    if (!loadedRef.current) return
    const view = viewForBuffer(bufferId)
    if (!view) return
    const text = view.state.doc.toString()
    if (text === committedRef.current) return
    committedRef.current = text
    setSceneKey((n) => n + 1)
  }, [version, bufferId])

  const commit = useCallback(
    (next: CsvTable) => {
      setTable({ key, value: next })
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        timerRef.current = null
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

  const width = current ? Math.max(1, columnCount(current.rows)) : 1
  const view = useMemo(
    () =>
      current
        ? viewOrder(current.rows, {
            sortColumn: sort?.column ?? null,
            direction: sort?.direction ?? 'asc',
            filter
          })
        : { order: [], hidden: 0 },
    [current, sort, filter]
  )

  /** Drag a column's right edge; the widths are the view's, not the file's. */
  const startResize =
    (col: number) =>
    (event: React.MouseEvent): void => {
      event.preventDefault()
      event.stopPropagation()
      const startX = event.clientX
      const startWidth = widths[col] ?? 120
      const onMove = (move: MouseEvent): void => {
        setWidths((current) => {
          const next = [...current]
          next[col] = Math.max(MIN_COLUMN, startWidth + (move.clientX - startX))
          return next
        })
      }
      const onUp = (): void => {
        document.body.classList.remove('is-resizing')
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
      }
      document.body.classList.add('is-resizing')
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    }

  if (failed) return <EmptyState icon="alert-triangle">That file could not be read.</EmptyState>
  if (!current) return <EmptyState icon="table">Opening the table…</EmptyState>

  const header = padRow(current.rows[0] ?? [], width)

  const setCell = (row: number, col: number, value: string): void => {
    const rows = current.rows.map((r, i) => (i === row ? padRow(r, width) : [...r]))
    const target = rows[row]
    if (!target) return
    target[col] = value
    commit({ ...current, rows })
  }

  const dropColumn = (to: number): void => {
    if (drag?.kind !== 'column' || drag.from === to) return
    commit({ ...current, rows: moveColumn(current.rows, drag.from, to) })
    setWidths((current) => {
      const next = [...current]
      const [moved] = next.splice(drag.from, 1)
      next.splice(to, 0, moved ?? 120)
      return next
    })
  }

  const dropRow = (to: number): void => {
    if (drag?.kind !== 'row' || drag.from === to) return
    // Dragging is a change to the table; a sorted view is a way of looking at
    // one. Moving a row while sorted would mean nothing, so it is refused.
    if (sort) return
    commit({ ...current, rows: moveRow(current.rows, drag.from, to) })
  }

  /** Arrow keys, Tab and Enter walk the grid the way a spreadsheet does. */
  const onCellKey =
    (row: number, col: number) =>
    (event: React.KeyboardEvent<HTMLInputElement>): void => {
      const at = view.order.indexOf(row)
      const go = (nextRow: number, nextCol: number): void => {
        event.preventDefault()
        const input = gridRef.current?.querySelector<HTMLInputElement>(
          `[data-cell="${nextRow}:${nextCol}"]`
        )
        input?.focus()
        input?.select()
      }

      if (
        event.key === 'ArrowRight' &&
        event.currentTarget.selectionStart === event.currentTarget.value.length
      ) {
        if (col + 1 < width) go(row, col + 1)
      } else if (event.key === 'ArrowLeft' && event.currentTarget.selectionStart === 0) {
        if (col > 0) go(row, col - 1)
      } else if (event.key === 'ArrowDown' || event.key === 'Enter') {
        const next = row === 0 ? view.order[0] : view.order[at + 1]
        if (next !== undefined) go(next, col)
      } else if (event.key === 'ArrowUp') {
        const next = at <= 0 ? 0 : (view.order[at - 1] ?? 0)
        go(next, col)
      }
    }

  const sortBy = (col: number): void =>
    setSort((current) =>
      current?.column !== col
        ? { column: col, direction: 'asc' }
        : current.direction === 'asc'
          ? { column: col, direction: 'desc' }
          : null
    )

  return (
    <div className="csv">
      <div className="csv__bar">
        <span className="csv__shape">
          {/* The file's own shape, header included: the row numbers down the
              gutter are file lines, and a count that disagreed with them would
              be a second way of counting the same thing. */}
          {current.rows.length} row{current.rows.length === 1 ? '' : 's'} · {width} column
          {width === 1 ? '' : 's'}
          {view.hidden > 0 && <span className="csv__hidden"> · {view.hidden} hidden</span>}
        </span>
        {current.delimiter !== ',' && (
          <span className="csv__delimiter" title="Delimiter used by this file">
            {current.delimiter === '\t' ? 'tab' : current.delimiter} separated
          </span>
        )}

        <div className="csv__filter">
          <Icon name="search" size={12} className="csv__filter-icon" />
          <input
            className="csv__filter-input"
            placeholder="Filter rows…"
            aria-label="Filter rows"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          {filter && (
            <button
              className="csv__filter-clear"
              aria-label="Clear filter"
              onClick={() => setFilter('')}
            >
              <Icon name="x" size={11} />
            </button>
          )}
        </div>

        {sort && (
          <button className="csv__action" onClick={() => setSort(null)} title="Back to file order">
            <Icon name="sort" size={12} /> Unsort
          </button>
        )}
        <button
          className="csv__action"
          onClick={() =>
            commit({ ...current, rows: insertRow(current.rows, current.rows.length, width) })
          }
        >
          <Icon name="plus" size={12} /> Row
        </button>
        <button
          className="csv__action"
          onClick={() => {
            commit({ ...current, rows: insertColumn(current.rows, width, width) })
            setWidths((current) => [...current, 120])
          }}
        >
          <Icon name="plus" size={12} /> Column
        </button>
      </div>

      <div className="csv__scroll">
        <table className="csv__table" ref={gridRef}>
          <colgroup>
            <col style={{ width: 52 }} />
            {header.map((_, col) => (
              <col key={col} style={{ width: widths[col] ?? 120 }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th className="csv__gutter" />
              {header.map((value, col) => (
                <th
                  key={col}
                  className={`csv__head${drag?.kind === 'column' && drag.over === col ? ' csv__head--over' : ''}`}
                  draggable
                  onDragStart={() => setDrag({ kind: 'column', from: col, over: col })}
                  onDragOver={(e) => {
                    e.preventDefault()
                    setDrag((d) => (d?.kind === 'column' ? { ...d, over: col } : d))
                  }}
                  onDrop={() => {
                    dropColumn(col)
                    setDrag(null)
                  }}
                  onDragEnd={() => setDrag(null)}
                >
                  <button
                    className="csv__sort"
                    aria-label={`Sort by ${value || `column ${col + 1}`}`}
                    title="Sort by this column"
                    onClick={() => sortBy(col)}
                  >
                    <Icon
                      name={
                        sort?.column === col
                          ? sort.direction === 'asc'
                            ? 'chevron-up'
                            : 'chevron-down'
                          : 'sort'
                      }
                      size={11}
                    />
                  </button>
                  <input
                    className="csv__input csv__input--head"
                    value={value}
                    data-cell={`0:${col}`}
                    aria-label={`Column ${col + 1} name`}
                    onFocus={() => setSelected({ row: 0, col })}
                    onChange={(e) => setCell(0, col, e.target.value)}
                    onKeyDown={onCellKey(0, col)}
                  />
                  <button
                    className="csv__drop"
                    aria-label={`Delete column ${col + 1}`}
                    title="Delete column"
                    onClick={() => {
                      commit({ ...current, rows: deleteColumn(current.rows, col, width) })
                      setWidths((w) => w.filter((_, i) => i !== col))
                    }}
                  >
                    <Icon name="x" size={11} />
                  </button>
                  <span
                    className="csv__grip"
                    role="separator"
                    aria-orientation="vertical"
                    aria-label={`Resize column ${col + 1}`}
                    onMouseDown={startResize(col)}
                    onDragStart={(e) => e.preventDefault()}
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {view.order.map((rowIndex) => (
              <tr
                key={rowIndex}
                className={drag?.kind === 'row' && drag.over === rowIndex ? 'csv__row--over' : ''}
                onDragOver={(e) => {
                  e.preventDefault()
                  setDrag((d) => (d?.kind === 'row' ? { ...d, over: rowIndex } : d))
                }}
                onDrop={() => {
                  dropRow(rowIndex)
                  setDrag(null)
                }}
              >
                <th
                  className="csv__gutter"
                  draggable={!sort}
                  title={sort ? 'Unsort to rearrange rows' : 'Drag to move this row'}
                  onDragStart={() => setDrag({ kind: 'row', from: rowIndex, over: rowIndex })}
                  onDragEnd={() => setDrag(null)}
                >
                  <div className="csv__gutter-inner">
                    <span className="csv__number">{rowIndex + 1}</span>
                    <button
                      className="csv__drop"
                      aria-label={`Delete row ${rowIndex + 1}`}
                      title="Delete row"
                      onClick={() =>
                        commit({ ...current, rows: deleteRow(current.rows, rowIndex) })
                      }
                    >
                      <Icon name="x" size={11} />
                    </button>
                  </div>
                </th>
                {padRow(current.rows[rowIndex] ?? [], width).map((value, col) => (
                  <td
                    key={col}
                    className={`csv__cell${selected?.row === rowIndex && selected?.col === col ? ' csv__cell--active' : ''}`}
                  >
                    <input
                      className="csv__input"
                      value={value}
                      data-cell={`${rowIndex}:${col}`}
                      aria-label={`Row ${rowIndex + 1}, column ${col + 1}`}
                      onFocus={() => setSelected({ row: rowIndex, col })}
                      onChange={(e) => setCell(rowIndex, col, e.target.value)}
                      onKeyDown={onCellKey(rowIndex, col)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {view.order.length === 0 && current.rows.length > 1 && (
          <p className="csv__empty">Nothing matches “{filter}”.</p>
        )}
      </div>
    </div>
  )
}
