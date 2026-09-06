import { StateField, type EditorState, type Extension, type Range } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'
import type { EditorView as EditorViewType } from '@codemirror/view'
import { resolveAssetUrl } from '@core/asset'
import { resolveFile, resolveNote } from '@core/notes'
import { extractSection } from '@core/section'
import { findWikilinks } from '@core/wikilinks'
import { mountPreview } from '@/editor/preview-view'
import { activeFilePath } from '@/state/app-state'
import { appState } from '@/state/app-state-access'
import { invoke } from '@/services/client'
import { revealSource } from './reveal-source'

/** Longest embedded excerpt shown before it is cut off. */
const MAX_EMBED_CHARS = 1200

/** Loaded note bodies, so scrolling past an embed doesn't re-read the file. */
const cache = new Map<string, string>()
/** Nested preview editors by card, so they can be torn down with the card. */
const mounted = new WeakMap<HTMLElement, EditorViewType>()
/**
 * Cards whose widget was torn down while their note was still being read.
 *
 * An embed's body arrives from disk, so there is a gap between asking for it
 * and having it, and the card can be dropped inside that gap — moving the
 * cursor onto the embed's line is enough, because that reveals the source and
 * removes the decoration. `destroy` then has nothing to tear down: the editor
 * it would have destroyed has not been made yet.
 *
 * Without this the read goes on to finish, mounts a whole CodeMirror view into
 * an element no longer in the document, and files it under a card nothing will
 * ever ask about again. It is unreachable and it is never destroyed — not by
 * the next edit, not by closing the tab, not by `view.destroy()`. One per
 * embed, every time a cursor move beats a file read.
 */
const discarded = new WeakSet<HTMLElement>()

/**
 * A thin wrapper rather than an inlined call: `![[Store]]` and `[[Store]]`
 * must pick the same file out of two `Store.md`, and that only holds if both
 * go through `resolveNote` with the same `fromPath` instead of each keeping
 * its own lookup.
 */
function resolveNotePath(target: string): string | null {
  const state = appState()
  return resolveNote(state.noteIndex, target, activeFilePath(state))?.path ?? null
}

/**
 * The pictures an embed can show. SVG is here and not in the image surface's
 * own list: it is a file somebody may want to edit, but embedded in a note it
 * is only ever a picture.
 */
const EMBEDDABLE_IMAGE = /\.(png|jpe?g|gif|webp|bmp|avif|ico|svg)$/i

/**
 * Show a picture that lives somewhere in the vault.
 *
 * `![[diagram.png]]` is how a knowledge base writes an image, and it was being
 * answered with "doesn't exist yet". The embed only ever looked in the note
 * index — markdown files, matched by stem — so a picture was neither found nor,
 * had it been, drawn: it would have been read as text and rendered as markdown.
 *
 * Resolved by whole name across the vault rather than relative to the note,
 * which is the point of the double-bracket form: where the file actually sits
 * is not something you should have to remember when writing.
 */
function showImage(target: string, el: HTMLElement): boolean {
  if (!EMBEDDABLE_IMAGE.test(target.trim())) return false
  const state = appState()
  const found = resolveFile(state.fileIndex, target, activeFilePath(state))
  const url = found ? resolveAssetUrl(null, found.path) : null
  if (!url) {
    el.classList.add('cm-or-embed--missing')
    el.textContent = `“${target}” is not in this vault`
    return true
  }
  el.textContent = ''
  el.classList.add('cm-or-embed--image')
  const img = document.createElement('img')
  img.src = url
  img.alt = target
  img.loading = 'lazy'
  img.addEventListener('error', () => {
    el.classList.add('cm-or-embed--missing')
    el.textContent = `Could not read “${target}”`
  })
  el.appendChild(img)
  return true
}

async function loadEmbed(target: string, heading: string | null, el: HTMLElement): Promise<void> {
  // A picture is shown, not read: it has no sections and no markdown in it.
  if (showImage(target, el)) return
  const path = resolveNotePath(target)
  if (!path) {
    el.classList.add('cm-or-embed--missing')
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
        el.classList.add('cm-or-embed--missing')
        el.textContent = `“${target}” has no section “${heading}”`
        return
      }
      body = (section ?? whole).trim()
      cache.set(key, body)
    } catch {
      el.classList.add('cm-or-embed--missing')
      el.textContent = `Could not read “${target}”`
      return
    }
  }

  // The card may have gone while the file was being read. Checked after every
  // await rather than once at the top: before the await it is always alive.
  if (discarded.has(el)) return

  el.textContent = ''
  const title = document.createElement('div')
  title.className = 'cm-or-embed-title'
  title.textContent = heading ? `${target} › ${heading}` : target
  const content = document.createElement('div')
  content.className = 'cm-or-embed-body'
  el.append(title, content)

  // Rendered, not raw: an embed showing markdown source beside rendered text
  // reads as broken. Same renderer as the editor itself.
  const shown = body.length > MAX_EMBED_CHARS ? `${body.slice(0, MAX_EMBED_CHARS)}…` : body
  const preview = mountPreview(content, shown || '_(empty note)_', path)
  // The field rebuilds on every document change, so the view it replaces has
  // to go with it or each keystroke leaks an editor.
  mounted.set(el, preview)
}

class EmbedWidget extends WidgetType {
  constructor(
    readonly target: string,
    readonly heading: string | null,
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
    el.className = 'cm-or-embed'
    el.textContent = `Loading ${this.target}…`
    void loadEmbed(this.target, this.heading, el)

    if (this.interactive) {
      // Click the card to get at the source that produced it, like every other
      // rendered construct here.
      el.addEventListener('mousedown', (event) => {
        event.preventDefault()
        revealSource(view, el)
      })
    }
    return el
  }

  override destroy(dom: HTMLElement): void {
    discarded.add(dom)
    mounted.get(dom)?.destroy()
    mounted.delete(dom)
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
          widget: new EmbedWidget(link.target, link.heading, reveal),
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
