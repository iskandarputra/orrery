/**
 * Tooltips that appear when you look at something, not a second later.
 *
 * The operating system's own tooltip waits about a second before it shows. On a
 * toolbar of icons that is a second of not knowing what anything is, every
 * time, and the delay is not configurable — a page cannot ask for it to be
 * shorter. So the app draws its own.
 *
 * One listener for the whole window rather than a component per control: there
 * are a hundred and sixty of these, they are added by every new panel, and a
 * tooltip that has to be remembered at each call site is one that will be
 * forgotten at half of them. Anything with a `title`, a `data-tip` or an
 * `aria-label` gets one, which means anything already labelled for a screen
 * reader is labelled for a pointer too.
 *
 * While an element is hovered its `title` is taken off, because otherwise the
 * native tooltip arrives a second later on top of this one. It is put straight
 * back on the way out, so the attribute is there for anything that reads the
 * document — assistive technology, and the tests.
 */

/** Short enough to read as instant; long enough not to flicker on the way past. */
const DELAY_MS = 90

/** Between the control and its tooltip. */
const GAP = 8

/** Past this a tooltip is a paragraph, and wraps. */
const MAX_WIDTH = 280

export function startTooltips(): () => void {
  let bubble: HTMLDivElement | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  /** The element being described, and the `title` borrowed from it. */
  let host: HTMLElement | null = null
  let borrowed: string | null = null
  /** True when a label was lent to the element in the title's place. */
  let lentLabel = false

  const text = (el: HTMLElement): string =>
    el.dataset['tip']?.trim() ||
    el.getAttribute('title')?.trim() ||
    el.getAttribute('aria-label')?.trim() ||
    ''

  const hide = (): void => {
    if (timer) clearTimeout(timer)
    timer = null
    if (host && borrowed !== null) {
      host.setAttribute('title', borrowed)
      if (lentLabel) host.removeAttribute('aria-label')
      borrowed = null
      lentLabel = false
    }
    host = null
    bubble?.remove()
    bubble = null
  }

  const show = (el: HTMLElement, label: string): void => {
    bubble?.remove()
    bubble = document.createElement('div')
    bubble.className = 'tip'
    bubble.setAttribute('role', 'presentation')
    bubble.textContent = label
    bubble.style.maxWidth = `${MAX_WIDTH}px`
    document.body.appendChild(bubble)

    // Below by preference, above when there is no room — and never off the
    // side, which is where a tooltip on the last button in a row would go.
    const target = el.getBoundingClientRect()
    const own = bubble.getBoundingClientRect()
    const below = target.bottom + GAP
    const top = below + own.height <= window.innerHeight ? below : target.top - own.height - GAP
    const left = Math.min(
      Math.max(4, target.left + target.width / 2 - own.width / 2),
      window.innerWidth - own.width - 4
    )
    bubble.style.top = `${Math.max(4, top)}px`
    bubble.style.left = `${left}px`
    bubble.dataset['shown'] = 'true'
  }

  const consider = (el: HTMLElement): void => {
    const label = text(el)
    if (!label) return
    hide()
    host = el
    // Taken off for as long as the pointer is here, so the operating system
    // does not put its own copy on top a second later.
    const own = el.getAttribute('title')
    if (own !== null) {
      borrowed = own
      // A control named only by its title would lose its name for as long as
      // the pointer sat on it, so the name is lent back as a label while the
      // title is away.
      if (!el.hasAttribute('aria-label')) {
        el.setAttribute('aria-label', own)
        lentLabel = true
      }
      el.removeAttribute('title')
    }
    timer = setTimeout(() => {
      if (host === el && el.isConnected) show(el, label)
    }, DELAY_MS)
  }

  /**
   * Controls, for the purpose of the `aria-label` fallback.
   *
   * A label is not always hover text: whole regions carry one — the diff view
   * is "Changes in such a file", the rail is "Workspace" — and pointing at
   * anything inside them would pop up a description of the room rather than of
   * the thing. An explicit `title` or `data-tip` is always hover text, because
   * somebody wrote it to be.
   */
  const CONTROLS =
    'button, a[href], input, select, textarea, summary, [role="button"], [role="tab"]'

  const onOver = (event: Event): void => {
    const target = event.target
    if (!(target instanceof Element)) return
    // Not inside the editor's content. CodeMirror owns that DOM and watches it
    // for changes, so borrowing a `title` from something in there is a mutation
    // under its observer — and it has hover tooltips of its own, which a second
    // bubble would fight with.
    if (target.closest('.cm-content')) {
      hide()
      return
    }
    const found = target.closest<HTMLElement>('[data-tip], [title], [aria-label]')
    if (
      !found ||
      (!found.dataset['tip'] && !found.hasAttribute('title') && !found.matches(CONTROLS))
    ) {
      hide()
      return
    }
    if (found === host) return
    consider(found)
  }

  const onOut = (event: Event): void => {
    const related = (event as MouseEvent).relatedTarget
    if (related instanceof Node && host?.contains(related)) return
    hide()
  }

  // A tooltip that outlives what it describes is worse than none: these are all
  // the ways an element stops being the thing under the pointer.
  const onLeaveWindow = (): void => hide()

  document.addEventListener('pointerover', onOver, true)
  document.addEventListener('pointerout', onOut, true)
  document.addEventListener('pointerdown', onLeaveWindow, true)
  document.addEventListener('keydown', onLeaveWindow, true)
  window.addEventListener('blur', onLeaveWindow)
  window.addEventListener('scroll', onLeaveWindow, true)

  return () => {
    hide()
    document.removeEventListener('pointerover', onOver, true)
    document.removeEventListener('pointerout', onOut, true)
    document.removeEventListener('pointerdown', onLeaveWindow, true)
    document.removeEventListener('keydown', onLeaveWindow, true)
    window.removeEventListener('blur', onLeaveWindow)
    window.removeEventListener('scroll', onLeaveWindow, true)
  }
}
