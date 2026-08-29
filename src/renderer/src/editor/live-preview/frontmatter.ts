import { StateField, type EditorState, type Extension } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'
import {
  emptyFrontmatter,
  parseFrontmatter,
  removeProperty,
  renameProperty,
  replaceFrontmatter,
  setProperty,
  type Frontmatter
} from '@core/frontmatter'

/**
 * The properties card, editable in place.
 *
 * Values are inputs rather than text: a note's metadata is the part most often
 * changed and least often worth dropping into raw YAML to change. Writing back
 * goes through `replaceFrontmatter`, which keeps every property it was not
 * asked to touch exactly as it found it.
 */
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

  /** Write one property back into the document. */
  private commit(view: EditorView, change: (fm: Frontmatter) => Frontmatter): void {
    const text = view.state.doc.toString()
    const current = parseFrontmatter(text)
    if (!current) return
    const next = replaceFrontmatter(text, change(current))
    if (next === text) return
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: next } })
  }

  override toDOM(view: EditorView): HTMLElement {
    const frontmatter = parseFrontmatter(this.source) ?? emptyFrontmatter()
    const entries = frontmatter.properties
    const card = document.createElement('div')
    card.className = 'cm-or-properties-card'

    // Header bar
    const header = document.createElement('div')
    header.className = 'cm-or-properties-header'

    const titleWrap = document.createElement('div')
    titleWrap.className = 'cm-or-properties-title-wrap'

    const icon = document.createElement('span')
    icon.className = 'cm-or-properties-icon'
    icon.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 21v-7"/><path d="M4 10V3"/><path d="M12 21v-9"/><path d="M12 8V3"/><path d="M20 21v-5"/><path d="M20 12V3"/><path d="M1 14h6"/><path d="M9 8h6"/><path d="M17 16h6"/></svg>`

    const title = document.createElement('span')
    title.className = 'cm-or-properties-title'
    title.textContent = 'Properties'

    const count = document.createElement('span')
    count.className = 'cm-or-properties-count'
    count.textContent = String(entries.length)

    titleWrap.appendChild(icon)
    titleWrap.appendChild(title)
    titleWrap.appendChild(count)
    header.appendChild(titleWrap)
    card.appendChild(header)

    // Properties Grid
    const grid = document.createElement('div')
    grid.className = 'cm-or-properties-grid'

    for (const entry of entries) {
      const row = document.createElement('div')
      row.className = 'cm-or-property-row'

      const keyEl = document.createElement('input')
      keyEl.className = 'cm-or-property-key'
      keyEl.value = entry.key
      keyEl.setAttribute('aria-label', `Name of property ${entry.key}`)
      keyEl.readOnly = !this.interactive
      keyEl.addEventListener('change', () => {
        const renamed = keyEl.value.trim()
        if (renamed && renamed !== entry.key) {
          this.commit(view, (fm) => renameProperty(fm, entry.key, renamed))
        }
      })

      const valEl = document.createElement('input')
      valEl.className = 'cm-or-property-val'
      // A list is edited as the comma-separated line a person would write, and
      // written back as YAML block items.
      valEl.value = Array.isArray(entry.value) ? entry.value.join(', ') : entry.value
      valEl.placeholder = 'empty'
      valEl.setAttribute('aria-label', `Value of ${entry.key}`)
      valEl.readOnly = !this.interactive
      if (Array.isArray(entry.value)) valEl.dataset['list'] = 'true'
      valEl.addEventListener('change', () => {
        const raw = valEl.value
        const next: string | string[] = Array.isArray(entry.value)
          ? raw
              .split(',')
              .map((item) => item.trim())
              .filter(Boolean)
          : raw
        this.commit(view, (fm) => setProperty(fm, entry.key, next))
      })

      const drop = document.createElement('button')
      drop.className = 'cm-or-property-drop'
      drop.type = 'button'
      drop.textContent = '\u00d7'
      drop.title = `Remove ${entry.key}`
      drop.setAttribute('aria-label', `Remove property ${entry.key}`)
      drop.addEventListener('click', () => this.commit(view, (fm) => removeProperty(fm, entry.key)))

      row.append(keyEl, valEl)
      if (this.interactive) row.append(drop)
      grid.appendChild(row)
    }

    card.appendChild(grid)

    if (this.interactive) {
      const add = document.createElement('button')
      add.className = 'cm-or-property-add'
      add.type = 'button'
      add.textContent = '+ Add property'
      add.addEventListener('click', () => {
        // Named by position rather than prompting: the field is right there to
        // be typed over, and a dialog to name a property is a dialog too many.
        let name = 'property'
        let n = 2
        while (entries.some((e) => e.key === name)) name = `property ${n++}`
        this.commit(view, (fm) => setProperty(fm, name, ''))
      })
      card.appendChild(add)
    }

    return card
  }

  /**
   * Every event reaches the card.
   *
   * The read-only version swallowed everything but mousedown, which it used to
   * drop the cursor into the raw YAML. The inputs need keystrokes, focus and
   * clicks of their own.
   */
  override ignoreEvent(): boolean {
    return false
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

  // Deliberately not revealed by cursor position, unlike every other
  // live-preview block. This one begins at offset zero, which is where the
  // caret rests on any freshly opened document, so a position test meant every
  // note with properties opened as raw YAML and the card appeared only after
  // clicking elsewhere.
  //
  // The card is the editor for properties. Raw YAML is still one keystroke
  // away in source mode, where live preview does not run at all, and that is
  // the place to go when a block is malformed enough that the card cannot show
  // it.

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
      if (tr.docChanged) return buildFrontmatterDecorations(tr.state, reveal)
      return value.map(tr.changes)
    },
    provide: (f) => EditorView.decorations.from(f)
  })
}
