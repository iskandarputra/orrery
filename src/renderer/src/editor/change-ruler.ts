import type { Extension } from '@codemirror/state'
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view'
import { mergeRuns, rulerBands, type ChangeRun } from '@core/change-bands'
import { RULER_WIDTH } from '@core/minimap-mode'
import type { ChangeKind } from '@core/git-diff'
import { gitMarks, markedLines } from './git-gutter'

/**
 * The changed lines of a file, marked down the scroll track.
 *
 * The minimap answered this before, and only while it was switched on: turning
 * it off took the one view of where the edits are with it, leaving the gutter,
 * which can only speak for the twenty lines currently on screen. The ruler is
 * always there instead, so "how much of this file did I touch, and where" is a
 * glance rather than a scroll.
 *
 * It is drawn as elements over the track rather than painted into the scrollbar
 * because a scrollbar cannot be painted. `::-webkit-scrollbar-track` takes one
 * background for the whole track and has no notion of a position within it, so
 * a wider scrollbar is all CSS alone can give.
 */

/** A single changed line in a long file is a fraction of a pixel, which is nothing. */
const MIN_BAND = 3

/**
 * The theme's own diff colours, not the git gutter's.
 *
 * The gutter hardcodes three hex values. These tokens are the same three hues
 * deepened per theme until they clear AA against that theme's surfaces, and a
 * band needs that more than a gutter bar does: a bar sits on the editor
 * background, while a band is painted at 0.75 over the scroll track and, where
 * the thumb happens to be, over the thumb.
 */
const KIND_COLOURS: Record<ChangeKind, string> = {
  added: 'var(--or-diff-add)',
  modified: 'var(--or-diff-mod)',
  removed: 'var(--or-diff-del)'
}

export interface ChangeRulerOptions {
  /**
   * A colour per 1-based line, for a surface that already knows its changes.
   *
   * The diff has them from its own alignment and has no git gutter to read.
   * Left out, the ruler follows the gutter's field instead, which is the
   * editor's case: it is live, so a band moves as you type rather than going
   * stale until the next save.
   */
  changes?: Record<number, string>
  /**
   * The width of the ruler, and of the track it lies on, which must be one
   * number: a band inset into a 12px strip over a 6px scrollbar hangs off it.
   *
   * Wider when the minimap is collapsed, because then this is the minimap:
   * `rulerWidth` in `core/minimap-mode.ts` decides, and nothing else should.
   */
  width?: number
}

export function changeRuler(options: ChangeRulerOptions = {}): Extension {
  const fixed = options.changes ? mergeRuns(options.changes) : null
  return [ViewPlugin.fromClass(rulerPlugin(fixed)), rulerTheme(options.width ?? RULER_WIDTH)]
}

function rulerPlugin(fixed: ChangeRun[] | null) {
  return class {
    dom: HTMLElement
    bands: HTMLElement[] = []
    /** What the last draw drew, so an unrelated update does not touch the DOM. */
    signature = ''

    constructor(readonly view: EditorView) {
      this.dom = document.createElement('div')
      this.dom.className = 'cm-or-ruler'
      view.dom.appendChild(this.dom)
      // The scroller has not been laid out yet in a plugin constructor, so the
      // track height would measure zero and every band would be dropped.
      requestAnimationFrame(() => this.draw())
    }

    update(update: ViewUpdate): void {
      // Geometry covers a resize, a font change and the horizontal scrollbar
      // coming and going. The field comparison covers git answering, and it is
      // an identity check on the range set rather than a redraw on every
      // transaction: the ruler would otherwise rebuild its bands on a keystroke.
      const moved =
        update.geometryChanged ||
        update.docChanged ||
        update.startState.field(gitMarks, false) !== update.state.field(gitMarks, false)
      if (moved) this.draw()
    }

    destroy(): void {
      this.dom.remove()
    }

    runs(): ChangeRun[] {
      if (fixed) return fixed
      const changes: Record<number, string> = {}
      for (const mark of markedLines(this.view.state)) changes[mark.line] = KIND_COLOURS[mark.kind]
      return mergeRuns(changes)
    }

    draw(): void {
      // clientHeight, not the scroller's full height: it excludes a horizontal
      // scrollbar, and that is exactly where the vertical track stops.
      const track = this.view.scrollDOM.clientHeight
      const bands = rulerBands(this.runs(), this.view.state.doc.lines, track, MIN_BAND)

      const signature = bands.map((b) => `${b.top}:${b.height}:${b.colour}`).join('|')
      if (signature === this.signature) return
      this.signature = signature

      for (const [i, band] of bands.entries()) {
        const el = this.bands[i] ?? this.addBand()
        el.style.display = 'block'
        el.style.top = `${band.top}px`
        el.style.height = `${band.height}px`
        el.style.background = band.colour
      }
      for (let i = bands.length; i < this.bands.length; i++) {
        this.bands[i]!.style.display = 'none'
      }
    }

    addBand(): HTMLElement {
      const band = document.createElement('div')
      band.className = 'cm-or-ruler-change'
      this.dom.appendChild(band)
      this.bands.push(band)
      return band
    }
  }
}

/**
 * Cached per width, and not rebuilt per call.
 *
 * `EditorView.theme` mints a fresh StyleModule every time, and this is called
 * from a compartment reconfigure, which happens on every settings change:
 * building one each time would leave a stylesheet behind per keystroke in the
 * Settings dialog. There are two widths in practice.
 */
const THEMES = new Map<number, Extension>()

function rulerTheme(width: number): Extension {
  const cached = THEMES.get(width)
  if (cached) return cached
  const theme = buildRulerTheme(width)
  THEMES.set(width, theme)
  return theme
}

function buildRulerTheme(width: number): Extension {
  // The thumb is inset inside the track and a band inside that, both in
  // proportion, so a collapsed 24px strip reads as a wider version of the
  // ordinary one rather than as the same marks adrift on a wider track.
  const thumbInset = Math.round(width / 4)
  const bandInset = Math.round(width / 6)
  return EditorView.theme({
    /*
     * The track the ruler marks, widened to be worth marking.
     *
     * Here rather than in editor.css because a theme's rules are already
     * scoped to the editors that carry it, which is exactly the set with a
     * ruler. The alternative was a class the plugin put on the editor and took
     * off again, and that is a race: a compartment reconfigure builds the
     * replacement plugin before retiring the old one, so the outgoing
     * `destroy` removes a class the incoming constructor has just added, and
     * the scrollbar silently goes back to 6px with the ruler still on it.
     *
     * The app's other scrollers stay at 6px. Nothing else gained a reason to
     * grow.
     */
    '& .cm-scroller::-webkit-scrollbar': {
      width: `${width}px`
    },
    // The thumb slides over the bands, so it cannot be opaque. background-clip
    // keeps the fill inside a transparent border, which is how a webkit thumb
    // is made narrower than its track without taking width away from the
    // pointer.
    '& .cm-scroller::-webkit-scrollbar-thumb': {
      background: 'color-mix(in srgb, var(--or-fg-muted) 45%, transparent)',
      backgroundClip: 'padding-box',
      border: `${thumbInset}px solid transparent`,
      borderRadius: 'var(--or-radius-full)'
    },
    '& .cm-scroller::-webkit-scrollbar-thumb:hover': {
      background: 'color-mix(in srgb, var(--or-fg-muted) 70%, transparent)',
      backgroundClip: 'padding-box'
    },
    // Over the scrollbar's own gutter: an absolute child of .cm-editor is
    // placed against its border box, while a child of the scroller would be
    // placed against the padding box and land to the left of the scrollbar
    // instead.
    '& .cm-or-ruler': {
      position: 'absolute',
      top: '0',
      right: '0',
      bottom: '0',
      width: `${width}px`,
      // The thumb has to stay draggable, and it is on the far side of this.
      pointerEvents: 'none',
      overflow: 'hidden'
    },
    '& .cm-or-ruler-change': {
      position: 'absolute',
      // Inset rather than edge to edge, so a band reads as a mark on the track
      // rather than as the track having changed colour.
      left: `${bandInset}px`,
      right: `${bandInset}px`,
      borderRadius: '1px',
      // The overlay paints above the native scrollbar, so where the thumb
      // passes a hunk the band is on top of it. Solid would blank the thumb
      // out; 0.75 reads at a glance and still shows the thumb through it.
      // Measured against the track on every sampled palette by the ui audit,
      // which wants 3:1.
      opacity: '0.75'
    }
  })
}
