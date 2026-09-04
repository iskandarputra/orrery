/**
 * Which zoom a keystroke asked for.
 *
 * There are two of them and they are easy to confuse. Without Shift the whole
 * window scales — the sidebar, the tabs, the status bar — which is the right
 * answer for a screen that is too small or too far away. With Shift only the
 * document does, which is the right answer for "this text is a little tight".
 *
 * Shift has to be read from the modifier rather than from the character,
 * because the character cannot tell them apart: `Ctrl +` on a US keyboard *is*
 * `Ctrl Shift =`, and `+` and `_` are simply what those chords produce. A menu
 * accelerator matches one spelling out of the three a keyboard offers, so the
 * decision is made here instead and every spelling lands in the same place.
 *
 * Pure, and separate from the window it acts on, because the interesting part
 * is the mapping and the mapping is not otherwise reachable: it lives inside a
 * `before-input-event` handler, which nothing in a test can make fire.
 */

export interface ZoomKey {
  /** The character the keystroke produced, e.g. `=`, `+`, `-`, `_`, `0`. */
  key: string
  control: boolean
  meta: boolean
  shift: boolean
  alt: boolean
}

export type ZoomAction =
  'window-in' | 'window-out' | 'window-reset' | 'page-in' | 'page-out' | 'page-reset'

export function zoomActionFor(input: ZoomKey): ZoomAction | null {
  // Alt is somebody else's shortcut, and a bare key is just typing.
  if (!(input.control || input.meta) || input.alt) return null

  const page = input.shift
  if (input.key === '=' || input.key === '+') return page ? 'page-in' : 'window-in'
  if (input.key === '-' || input.key === '_') return page ? 'page-out' : 'window-out'
  if (input.key === '0') return page ? 'page-reset' : 'window-reset'
  return null
}

/** The command each page-zoom action dispatches to the renderer. */
export const PAGE_ZOOM_COMMANDS: Record<'page-in' | 'page-out' | 'page-reset', string> = {
  'page-in': 'view.pageZoomIn',
  'page-out': 'view.pageZoomOut',
  'page-reset': 'view.pageZoomReset'
}
