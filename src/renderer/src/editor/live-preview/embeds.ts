import { StateField, type EditorState, type Extension, type Range } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'
import { extractSection } from '@core/section'
import { findWikilinks } from '@core/wikilinks'
import { invoke } from '@/services/client'
import { useStore } from '@/state/store'

/** Longest embedded excerpt shown before it is cut off. */
const MAX_EMBED_CHARS = 1200

/** Loaded note bodies, so scrolling past an embed doesn't re-read the file. */
const cache = new Map<string, string>()

function resolveNotePath(target: string): string | null {
  const { noteIndex } = useStore.getState()
  const wanted = target.trim().toLowerCase()
  return noteIndex.find((note) => note.stem.toLowerCase() === wanted)?.path ?? null
}

async function loadEmbed(target: string, heading: string | null, el: HTMLElement): Promise<void> {
  const path = resolveNotePath(target)
  if (!path) {
    el.classList.add('cm-zy-embed--missing')
    el.textContent = `“${target}” doesn't exist yet`
    return
  }

  const key = `${path}#${heading ?? ''}`
  let body = cache.get(key)
  if (body === undefined) {
    try {
      const file = await invoke('fs:readFile', { path })
      const whole = file.content
      const section = heading ? extractSection(whole, heading) : whole
      if (heading && section === null) {
        el.classList.add('cm-zy-embed--missing')
        el.textContent = `“${target}” has no section “${heading}”`
        return
      }
      body = (section ?? whole).trim()
      cache.set(key, body)
    } catch {
      el.classList.add('cm-zy-embed--missing')
      el.textContent = `Could not read “${target}”`
      return
    }
  }

  el.textContent = ''
  const title = document.createElement('div')
  title.className = 'cm-zy-embed-title'
  title.textContent = heading ? `${target} › ${heading}` : target
  const content = document.createElement('div')
  content.className = 'cm-zy-embed-body'
  content.textContent =
    body.length > MAX_EMBED_CHARS ? `${body.slice(0, MAX_EMBED_CHARS)}…` : body || '(empty note)'
  el.append(title, content)
}

class EmbedWidget extends WidgetType {
  constructor(
    readonly target: string,
    readonly heading: string | null,
    readonly from: number,
    readonly interactive: boolean
  ) {
    super()
  }

  override eq(other: EmbedWidget): boolean {
    return (
      other.target === this.target &&
      other.heading === this.heading &&
      other.interactive === this.interactive
    )
  }

  override toDOM(view: EditorView): HTMLElement {
    const el = document.createElement('div')
    el.className = 'cm-zy-embed'
    el.textContent = `Loading ${this.target}…`
    void loadEmbed(this.target, this.heading, el)

    if (this.interactive) {
      // Click the card to get at the source that produced it, like every other
      // rendered construct here.
      el.addEventListener('mousedown', (event) => {
        event.preventDefault()
        view.dispatch({ selection: { anchor: this.from }, scrollIntoView: true })
        view.focus()
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

  for (let n = 1; n <= state.doc.lines; n++) {
    const line = state.doc.line(n)
    for (const link of findWikilinks(line.text, line.from)) {
      if (!link.embed) continue
      if (touches(link.from, link.to)) continue
      // Only an embed that owns its whole line becomes a card; one sitting in
      // a sentence would tear the paragraph in half.
      if (link.from !== line.from || link.to !== line.to) continue
      decos.push(
        Decoration.replace({
          widget: new EmbedWidget(link.target, link.heading, link.from, reveal),
          block: true
        }).range(link.from, link.to)
      )
    }
  }
  return Decoration.set(decos, true)
}

/** Forget cached bodies for a note — its file changed underneath the embeds. */
export function invalidateEmbed(path: string): void {
  for (const key of [...cache.keys()]) {
    if (key.startsWith(`${path}#`)) cache.delete(key)
  }
}

/**
 * `![[Note]]` and `![[Note#Heading]]` render the referenced note inline — the
 * markdown-native answer to a synced block: one source of truth, shown in as
 * many places as you like.
 */
export function embedRendering(reveal = true): Extension {
  return StateField.define<DecorationSet>({
    create: (state) => build(state, reveal),
    update(value, tr) {
      if (tr.docChanged || (reveal && tr.selection)) return build(tr.state, reveal)
      return value.map(tr.changes)
    },
    provide: (f) => EditorView.decorations.from(f)
  })
}
