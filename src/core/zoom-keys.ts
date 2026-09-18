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

/** A wheel notch, or a trackpad pinch, which arrives as the same event. */
export interface ZoomWheel {
  /** Pixels the wheel asked to scroll. Negative is away from you, which zooms in. */
  deltaY: number
  control: boolean
  meta: boolean
  shift: boolean
  alt: boolean
}

/**
 * Wheel that has to accumulate before it is worth a step.
 *
 * A mouse notch arrives as one event of about 100, so a notch should be a step.
 * A trackpad pinch arrives as a stream of events of two or three, and a step per
 * event would cross the whole -5..5 range before a finger had finished moving.
 *
 * The number is not 100, because a wheel delta reaches the renderer already
 * divided by the window's zoom factor. Zoomed all the way in, at 1.2^5 = 2.49,
 * a 100px notch arrives as 40, and a threshold of 100 swallows it: measured at
 * zoom level 1, a notch Playwright sent as 120 came through as 99.999996 and did
 * nothing. Zooming in then cost two turns of the wheel per step, and more the
 * further in you went. 30 clears the smallest a real notch can shrink to with
 * room to spare, and still asks a pinch for ten events or so.
 */
const WHEEL_STEP = 30

export interface WheelZoom {
  /**
   * Whether this wheel belongs to the zoom at all.
   *
   * Separate from `action` because the two answers are needed at different
   * times: the wheel has to be taken from the page as soon as the gesture
   * starts, which is well before enough of it has accumulated to move a step.
   * Reporting only the step lets the document scroll under a pinch.
   */
  zooming: boolean
  /** The step this event earned, if it earned one. */
  action: ZoomAction | null
  /** Wheel to carry into the next event. */
  rest: number
}

/**
 * One wheel event, against whatever wheel is carried over from the last.
 *
 * Shift picks which zoom, exactly as it does for the keys: without it the
 * window scales, with it only the document does.
 *
 * At most one step per event, and the accumulator is spent rather than
 * decremented when one is taken. Decrementing it looks more correct and is
 * worse to use: a notch of 120 against a step of 100 leaves 20 behind every
 * time, so every fifth notch of a plain mouse would jump two levels.
 */
export function zoomForWheel(input: ZoomWheel, carried: number): WheelZoom {
  // Alt is somebody else's shortcut, and a bare wheel is just scrolling.
  if (!(input.control || input.meta) || input.alt) return { zooming: false, action: null, rest: 0 }

  // A reversal is a new gesture. Carrying the old direction's total across it
  // means the first flick back the other way does nothing.
  const carry = Math.sign(carried) === Math.sign(input.deltaY) ? carried : 0
  const total = carry + input.deltaY
  if (Math.abs(total) < WHEEL_STEP) return { zooming: true, action: null, rest: total }

  const page = input.shift
  const inwards = total < 0
  return {
    zooming: true,
    action: inwards ? (page ? 'page-in' : 'window-in') : page ? 'page-out' : 'window-out',
    rest: 0
  }
}
