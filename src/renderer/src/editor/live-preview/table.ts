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
    const thead = table.createTHead()
    const headRow = thead.insertRow()
    parsed.header.forEach((cell, i) => {
      const th = document.createElement('th')
      if (parsed.align[i]) th.style.textAlign = parsed.align[i]!
      renderInline(th, cell)
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
