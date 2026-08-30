/**
 * KaTeX, fetched the first time a note actually has maths in it.
 *
 * Imported statically it is 484 KB of JavaScript and a stylesheet in the
 * startup bundle, parsed before the first window paints, for a feature most
 * notes never use. Almost every measurable part of "the app takes a moment to
 * open" is work like this, done before anyone has asked for it.
 *
 * Until it arrives an equation shows its own source, which is what it looked
 * like a moment earlier anyway and is never wrong. The module is remembered, so
 * the wait happens once per session and every equation after the first renders
 * synchronously.
 */

/** Just the call this app makes: the whole module type would be an import type. */
interface Katex {
  render(
    expr: string,
    el: HTMLElement,
    options: { displayMode: boolean; throwOnError: boolean }
  ): void
}

let loaded: Katex | null = null
let loading: Promise<Katex | null> | null = null

/** Kick the download off without waiting for it. */
export function preloadKatex(): void {
  void load()
}

function load(): Promise<Katex | null> {
  if (loaded) return Promise.resolve(loaded)
  loading ??= Promise.all([import('katex'), import('katex/dist/katex.min.css')])
    .then(([mod]) => {
      loaded = mod.default as unknown as Katex
      return loaded
    })
    .catch(() => null)
  return loading
}

/**
 * Render an expression into an element, now or as soon as KaTeX is here.
 *
 * The element is checked for being on screen before the late render: a widget
 * whose document has moved on has already been thrown away, and writing into it
 * would be work nobody sees.
 */
export function renderMath(el: HTMLElement, expr: string, display: boolean): void {
  const draw = (katex: Katex): void => {
    try {
      katex.render(expr, el, { displayMode: display, throwOnError: false })
    } catch {
      el.textContent = expr
    }
  }

  if (loaded) {
    draw(loaded)
    return
  }
  // The source, which is what the reader was looking at a moment ago.
  el.textContent = expr
  void load().then((katex) => {
    if (katex && el.isConnected) draw(katex)
  })
}
