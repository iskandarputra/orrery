import { StateField, type EditorState, type Extension } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'

interface PropertyEntry {
  key: string
  value: string
}

function parseFrontmatter(raw: string): PropertyEntry[] {
  const lines = raw.split('\n')
  const entries: PropertyEntry[] = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed === '---') continue
    const colonIdx = line.indexOf(':')
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim()
      const value = line.slice(colonIdx + 1).trim()
      if (key) {
        entries.push({ key, value })
      }
    }
  }
  return entries
}

class FrontmatterWidget extends WidgetType {
  constructor(
    readonly source: string,
    readonly to: number,
    readonly interactive: boolean
  ) {
    super()
  }

  override eq(other: FrontmatterWidget): boolean {
    return other.source === this.source && other.interactive === this.interactive
  }

  override toDOM(view: EditorView): HTMLElement {
    const entries = parseFrontmatter(this.source)
    const card = document.createElement('div')
    card.className = 'cm-zy-properties-card'

    // Header bar
    const header = document.createElement('div')
    header.className = 'cm-zy-properties-header'

    const titleWrap = document.createElement('div')
    titleWrap.className = 'cm-zy-properties-title-wrap'

    const icon = document.createElement('span')
    icon.className = 'cm-zy-properties-icon'
    icon.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 21v-7"/><path d="M4 10V3"/><path d="M12 21v-9"/><path d="M12 8V3"/><path d="M20 21v-5"/><path d="M20 12V3"/><path d="M1 14h6"/><path d="M9 8h6"/><path d="M17 16h6"/></svg>`

    const title = document.createElement('span')
    title.className = 'cm-zy-properties-title'
    title.textContent = 'Properties'

    const count = document.createElement('span')
    count.className = 'cm-zy-properties-count'
    count.textContent = String(entries.length)

    titleWrap.appendChild(icon)
    titleWrap.appendChild(title)
    titleWrap.appendChild(count)
    header.appendChild(titleWrap)
    card.appendChild(header)

    // Properties Grid
    const grid = document.createElement('div')
    grid.className = 'cm-zy-properties-grid'

    for (const entry of entries) {
      const row = document.createElement('div')
      row.className = 'cm-zy-property-row'

      const keyEl = document.createElement('span')
      keyEl.className = 'cm-zy-property-key'
      keyEl.textContent = entry.key

      const valEl = document.createElement('span')
      valEl.className = 'cm-zy-property-val'

      // Check if value is a short status/category pill
      const isPill =
        entry.value.length < 24 &&
        /^[a-zA-Z0-9_-]+$/.test(entry.value.trim()) &&
        !/^\d+$/.test(entry.value.trim())

      if (isPill) {
        valEl.className += ' cm-zy-property-val--pill'
      }

      valEl.textContent = entry.value || '—'

      row.appendChild(keyEl)
      row.appendChild(valEl)
      grid.appendChild(row)
    }

    card.appendChild(grid)

    if (this.interactive) {
      card.addEventListener('mousedown', (e) => {
        e.preventDefault()
        view.dispatch({ selection: { anchor: 0 }, scrollIntoView: true })
        view.focus()
      })
    }

    return card
  }

  override ignoreEvent(event: Event): boolean {
    return !this.interactive || event.type !== 'mousedown'
  }
}

const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/

function buildFrontmatterDecorations(state: EditorState, reveal: boolean): DecorationSet {
  const docText = state.doc.sliceString(0, Math.min(state.doc.length, 4000))
  const match = docText.match(FRONTMATTER_REGEX)
  if (!match) return Decoration.none

  const from = 0
  const matchLength = match[0].length
  const to = Math.min(matchLength, state.doc.length)

  // If cursor is inside frontmatter range, reveal raw YAML in edit mode
  const isCursorInside = reveal && state.selection.ranges.some((r) => r.from <= to && r.to >= from)

  if (isCursorInside) {
    return Decoration.none
  }

  return Decoration.set([
    Decoration.replace({
      widget: new FrontmatterWidget(match[0], to, reveal),
      block: true
    }).range(from, to)
  ])
}

/**
 * Live-preview rendering for YAML frontmatter metadata.
 * Displays as a sleek Obsidian/Notion-style Properties Card Box with key-value pills,
 * revealing raw YAML when clicking into it.
 */
export function frontmatterRendering(reveal = true): Extension {
  return StateField.define<DecorationSet>({
    create: (state) => buildFrontmatterDecorations(state, reveal),
    update(value, tr) {
      if (tr.docChanged || (reveal && tr.selection)) {
        return buildFrontmatterDecorations(tr.state, reveal)
      }
      return value.map(tr.changes)
    },
    provide: (f) => EditorView.decorations.from(f)
  })
}
