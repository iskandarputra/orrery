import { syntaxTree } from '@codemirror/language'
import { StateField, type EditorState, type Extension, type Range } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'
import { expandButton } from './expand-button'
import { revealSource } from './reveal-source'

let seq = 0

export type Drawn = { svg: string } | { error: string }

/**
 * One diagram at a time.
 *
 * `mermaid.initialize` sets the library's *global* configuration and
 * `mermaid.render` reads it, with an await in between — so two renders in
 * flight at once are two writes to one setting, and the second one's theme
 * decides what the first one comes out looking like. That is not hypothetical:
 * the HTML reader always asks for `default`, because it is drawing onto
 * somebody else's white page, while a note asks for whatever the app is
 * wearing. A diagram in a note next to a page being read came out white.
 *
 * Serialising the pair is the whole fix. Diagrams are drawn a handful at a
 * time and the queue never gets long enough to be felt.
 */
let queue: Promise<unknown> = Promise.resolve()

function enqueue(task: () => Promise<Drawn>): Promise<Drawn> {
  const run = queue.then(task, task)
  // Whatever happened, the next one still gets its turn.
  queue = run.then(
    () => undefined,
    () => undefined
  )
  return run
}

/**
 * Diagrams already drawn, by the source and the theme that produced them.
 *
 * The HTML reader rebuilds its whole document on a debounce, so without this
 * every diagram in a page is redrawn from scratch on every keystroke next door
 * — mermaid parses, lays out and serialises each one, which is by far the most
 * expensive thing that happens in a rebuild.
 *
 * Failures are kept too. A diagram half-typed is a parse error, and re-parsing
 * the same broken source to be told so again is exactly as wasteful.
 */
const drawn = new Map<string, Drawn>()

/** Enough for the diagrams in a document, small enough to stay a cache. */
const CACHE_LIMIT = 64

function remember(key: string, result: Drawn): Drawn {
  drawn.set(key, result)
  // Insertion-ordered, so the first key is the oldest.
  if (drawn.size > CACHE_LIMIT) {
    const oldest = drawn.keys().next().value
    if (oldest !== undefined) drawn.delete(oldest)
  }
  return result
}

/**
 * A diagram as an SVG string, or why it could not be drawn.
 *
 * Separated from the element it usually goes into because the HTML reader needs
 * the string itself: what it renders into is a sandboxed frame this process
 * cannot reach, so the diagram has to be drawn out here and handed over as
 * markup.
 *
 * Lazy-loaded so the ~2MB mermaid bundle never blocks startup.
 */
export async function renderMermaidToString(
  code: string,
  themeOverride?: 'dark' | 'default'
): Promise<Drawn> {
  const dark = document.documentElement.dataset['theme']?.includes('light') !== true
  const theme = themeOverride ?? (dark ? 'dark' : 'default')
  // The theme is part of the key: the same diagram is a different picture in a
  // note and on the white page the reader draws onto.
  const key = `${theme}\u0000${code}`

  const hit = drawn.get(key)
  if (hit) return hit

  return enqueue(async () => {
    // Checked again inside the queue: several blocks of the same diagram are
    // drawn at once, and the first one through should settle it for the rest.
    const queued = drawn.get(key)
    if (queued) return queued
    try {
      const { default: mermaid } = await import('mermaid')
      mermaid.initialize({ startOnLoad: false, theme })
      const { svg } = await mermaid.render(`or-mermaid-${++seq}`, code)
      return remember(key, { svg })
    } catch (err) {
      const error = err instanceof Error ? (err.message.split('\n')[0] ?? 'failed') : String(err)
      return remember(key, { error })
    }
  })
}

export async function renderMermaid(code: string, el: HTMLElement): Promise<void> {
  const result = await renderMermaidToString(code)
  if ('svg' in result) {
    el.innerHTML = result.svg
    return
  }
  el.textContent = `Mermaid error: ${result.error}`
  el.classList.add('cm-or-mermaid--error')
}

class MermaidWidget extends WidgetType {
  constructor(
    readonly code: string,
    readonly interactive: boolean
  ) {
    super()
  }

  override eq(other: MermaidWidget): boolean {
    return other.code === this.code && other.interactive === this.interactive
  }

  override toDOM(view: EditorView): HTMLElement {
    const el = document.createElement('div')
    el.className = 'cm-or-mermaid'
    el.textContent = 'Rendering diagram…'
    void renderMermaid(this.code, el).then(() => {
      // Appended after the render, which replaces the element's children — and
      // not onto a failed one, where there is nothing to enlarge but the error.
      if (!el.classList.contains('cm-or-mermaid--error')) {
        el.appendChild(expandButton({ kind: 'mermaid', code: this.code }))
      }
    })
    if (this.interactive) {
      el.addEventListener('mousedown', (event) => {
        event.preventDefault()
        revealSource(view, el)
      })
    }
    return el
  }

  override ignoreEvent(event: Event): boolean {
    return !this.interactive || event.type !== 'mousedown'
  }
}

function build(state: EditorState, reveal: boolean): DecorationSet {
  const decos: Range<Decoration>[] = []
  const touches = (a: number, b: number): boolean =>
    reveal && state.selection.ranges.some((r) => r.from <= b && r.to >= a)

  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name !== 'FencedCode') return
      const info = node.node.getChild('CodeInfo')
      if (!info || state.doc.sliceString(info.from, info.to).trim() !== 'mermaid') return false
      const from = node.from
      const to = Math.min(node.to, state.doc.lineAt(node.to).to)
      const wholeLines = state.doc.lineAt(from).from === from && state.doc.lineAt(to).to === to
      if (touches(from, to) || !wholeLines) return false
      const body = node.node.getChild('CodeText')
      const code = body ? state.doc.sliceString(body.from, body.to) : ''
      if (code.trim()) {
        decos.push(
          Decoration.replace({ widget: new MermaidWidget(code, reveal), block: true }).range(
            from,
            to
          )
        )
      }
      return false
    }
  })
  return Decoration.set(decos, true)
}

/** ```mermaid fences render as diagrams; click or arrow in to edit source. */
export function mermaidRendering(reveal = true): Extension {
  return StateField.define<DecorationSet>({
    create: (state) => build(state, reveal),
    update(value, tr) {
      // Rebuild as parsing completes so the fenced-code node is picked up on a
      // freshly opened document (otherwise the diagram renders only after a
      // tab switch forces a rebuild).
      if (
        tr.docChanged ||
        (reveal && tr.selection) ||
        syntaxTree(tr.startState) !== syntaxTree(tr.state)
      )
        return build(tr.state, reveal)
      return value.map(tr.changes)
    },
    provide: (f) => EditorView.decorations.from(f)
  })
}
