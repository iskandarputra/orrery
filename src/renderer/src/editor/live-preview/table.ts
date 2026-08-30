import { syntaxTree } from '@codemirror/language'
import { StateField, type EditorState, type Extension, type Range } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'
import { parseTable } from '@core/markdown-table'

/** Containers that can hold a Table node — everything else is pruned. */
const TABLE_PARENTS = new Set(['Document', 'Blockquote', 'ListItem', 'BulletList', 'OrderedList'])

/** Minimal safe inline renderer for cell text: `code`, **bold**, *italic*. */
function renderInline(target: HTMLElement, text: string): void {
  const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(\[\[([^\][|]+)(?:\|([^\]]+))?\]\])/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = pattern.exec(text)) !== null) {
    if (m.index > last) target.appendChild(document.createTextNode(text.slice(last, m.index)))
    if (m[1]) {
      const code = document.createElement('code')
      code.textContent = m[1].slice(1, -1)
      target.appendChild(code)
    } else if (m[2]) {
      const strong = document.createElement('strong')
      strong.textContent = m[2].slice(2, -2)
      target.appendChild(strong)
    } else if (m[3]) {
      const em = document.createElement('em')
      em.textContent = m[3].slice(1, -1)
      target.appendChild(em)
    } else if (m[4]) {
      const link = document.createElement('span')
      link.className = 'cm-or-wikilink'
      link.textContent = m[6] ?? m[5] ?? ''
      target.appendChild(link)
    }
    last = m.index + m[0].length
  }
  if (last < text.length) target.appendChild(document.createTextNode(text.slice(last)))
}

/**
 * Column widths for the tables in one editor.
 *
 * Markdown has nowhere to put a column width — the format is the text — so a
 * width is a way of looking at the file rather than part of it, and it lives
 * beside the view for as long as the view does. Keyed by the table's header
 * row, so editing the body keeps the widths and two tables with the same
 * headings share them, which is a fair guess at what someone meant.
 */
const widthsByView = new WeakMap<EditorView, Map<string, number[]>>()

/** Narrower than this and a column is a sliver nobody can read or grab. */
const MIN_COLUMN = 48

function widthsFor(view: EditorView, key: string): number[] | null {
  return widthsByView.get(view)?.get(key) ?? null
}

function rememberWidths(view: EditorView, key: string, widths: number[]): void {
  const forView = widthsByView.get(view) ?? new Map<string, number[]>()
  forView.set(key, widths)
  widthsByView.set(view, forView)
}

class TableWidget extends WidgetType {
  constructor(
    readonly source: string,
    readonly from: number,
    readonly interactive: boolean
  ) {
    super()
  }

  override eq(other: TableWidget): boolean {
    return other.source === this.source && other.interactive === this.interactive
  }

  override toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('div')
    wrap.className = 'cm-or-table'
    const parsed = parseTable(this.source)
    if (!parsed) {
      wrap.textContent = this.source
      return wrap
    }
    const table = document.createElement('table')
    // The table's identity for remembered widths: its own headings.
    const key = parsed.header.join('\u0000')
    const widths = widthsFor(view, key)
    if (widths) {
      table.style.tableLayout = 'fixed'
      const group = document.createElement('colgroup')
      widths.forEach((width) => {
        const col = document.createElement('col')
        col.style.width = `${width}px`
        group.appendChild(col)
      })
      table.appendChild(group)
    }

    const thead = table.createTHead()
    const headRow = thead.insertRow()
    parsed.header.forEach((cell, i) => {
      const th = document.createElement('th')
      if (parsed.align[i]) th.style.textAlign = parsed.align[i]!
      renderInline(th, cell)
      // A grip on the column's edge. Dragging it is a change to the view, not
      // to the file, so nothing is written and the tab stays clean.
      if (this.interactive && i < parsed.header.length - 1) {
        const grip = document.createElement('span')
        grip.className = 'cm-or-table-grip'
        grip.title = 'Drag to resize. Double-click for automatic widths.'
        grip.addEventListener('mousedown', (event) => {
          event.preventDefault()
          event.stopPropagation()
          const cells = [...headRow.children] as HTMLElement[]
          const start = cells.map((element) => element.getBoundingClientRect().width)
          const startX = event.clientX

          const onMove = (move: MouseEvent): void => {
            const next = [...start]
            const left = start[i] ?? 0
            const right = start[i + 1] ?? 0
            // Clamped to what the pair can give. Letting one column take more
            // than its neighbour has makes the table wider than its box, and
            // the browser then scales every column back down — which reads as
            // a drag that only half worked.
            const room = Math.min(move.clientX - startX, right - MIN_COLUMN)
            const moved = Math.max(room, MIN_COLUMN - left)
            next[i] = left + moved
            next[i + 1] = right - moved
            rememberWidths(view, key, next)
            table.style.tableLayout = 'fixed'
            let group = table.querySelector('colgroup')
            if (!group) {
              group = document.createElement('colgroup')
              table.insertBefore(group, table.firstChild)
            }
            group.replaceChildren(
              ...next.map((width) => {
                const col = document.createElement('col')
                col.style.width = `${width}px`
                return col
              })
            )
          }
          const onUp = (): void => {
            document.body.classList.remove('is-resizing')
            window.removeEventListener('mousemove', onMove)
            window.removeEventListener('mouseup', onUp)
          }
          document.body.classList.add('is-resizing')
          window.addEventListener('mousemove', onMove)
          window.addEventListener('mouseup', onUp)
        })
        grip.addEventListener('dblclick', (event) => {
          event.preventDefault()
          event.stopPropagation()
          widthsByView.get(view)?.delete(key)
          table.style.tableLayout = ''
          table.querySelector('colgroup')?.remove()
        })
        th.appendChild(grip)
      }
      headRow.appendChild(th)
    })
    const tbody = table.createTBody()
    for (const row of parsed.rows) {
      const tr = tbody.insertRow()
      row.forEach((cell, i) => {
        const td = tr.insertCell()
        if (parsed.align[i]) td.style.textAlign = parsed.align[i]!
        renderInline(td, cell)
      })
    }
    wrap.appendChild(table)
    // Click to edit: reveal the source with the cursor inside the table. Not in
    // reading mode — there the table is a static rendered block.
    if (this.interactive) {
      wrap.addEventListener('mousedown', (event) => {
        // A grip handles its own drag; clicking it must not also open the
        // source underneath.
        if ((event.target as HTMLElement).classList.contains('cm-or-table-grip')) return
        event.preventDefault()
        view.dispatch({ selection: { anchor: this.from }, scrollIntoView: true })
        view.focus()
      })
    }
    return wrap
  }

  override ignoreEvent(event: Event): boolean {
    return !this.interactive || event.type !== 'mousedown'
  }
}

const tableSrcLine = Decoration.line({ class: 'cm-or-table-src' })

function buildTableDecorations(state: EditorState, reveal: boolean): DecorationSet {
  const decorations: Range<Decoration>[] = []
  const touches = (from: number, to: number): boolean =>
    reveal && state.selection.ranges.some((r) => r.from <= to && r.to >= from)

  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name === 'Table') {
        // Trailing newline is outside the node; trim to full lines.
        const from = node.from
        const to = Math.min(node.to, state.doc.lineAt(node.to).to)
        // Block widgets must span whole lines — tables nested in blockquotes
        // (prefixed lines) stay as styled source.
        const wholeLines = state.doc.lineAt(from).from === from && state.doc.lineAt(to).to === to
        if (touches(from, to) || !wholeLines) {
          // Editing: keep source but align it with monospace rows.
          const first = state.doc.lineAt(from)
          const last = state.doc.lineAt(to)
          for (let n = first.number; n <= last.number; n++) {
            decorations.push(tableSrcLine.range(state.doc.line(n).from))
          }
        } else {
          decorations.push(
            Decoration.replace({
              widget: new TableWidget(state.doc.sliceString(from, to), from, reveal),
              block: true
            }).range(from, to)
          )
        }
        return false
      }
      return TABLE_PARENTS.has(node.name)
    }
  })
  return Decoration.set(decorations, true)
}

/**
 * GitHub-style table rendering: a real <table> replaces the block until the
 * cursor enters it (click or arrow keys), then the source reappears in
 * monospace. Block widgets change vertical geometry, so this must be a
 * StateField, not a ViewPlugin.
 */
export function tableRendering(reveal = true): Extension {
  const field = StateField.define<DecorationSet>({
    create: (state) => buildTableDecorations(state, reveal),
    update(value, tr) {
      // Rebuild on edits, selection moves (only when reveal is on), AND when
      // background parsing advances (a freshly opened doc isn't fully parsed, so
      // the Table node may be absent on the first build — the "table didn't
      // render until I switched tabs" race).
      if (
        tr.docChanged ||
        (reveal && tr.selection) ||
        syntaxTree(tr.startState) !== syntaxTree(tr.state)
      )
        return buildTableDecorations(tr.state, reveal)
      return value.map(tr.changes)
    },
    provide: (f) => EditorView.decorations.from(f)
  })
  return field
}
