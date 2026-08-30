import type { Extension } from '@codemirror/state'
import { EditorView, ViewPlugin } from '@codemirror/view'
import { showMinimap } from '@replit/codemirror-minimap'

/**
 * The scaled-down preview of the whole file beside the scrollbar.
 *
 * Painted to a canvas, but coloured by reading the editor's own highlighting —
 * so all seven palettes come out right without any of them being described a
 * second time here.
 *
 * `blocks` rather than `characters`: at this scale glyphs are illegible anyway,
 * and drawing them costs a full text layout of the document on every change.
 * The shape of the code — indentation, line length, where the blank lines fall —
 * is the whole of what a minimap is read for.
 */
export interface MinimapOptions {
  /**
   * A colour per 1-based line, drawn as a band across the whole preview.
   *
   * Used by the diff to show where the changes are, so the shape of the edit is
   * visible without scrolling through the file. Any CSS colour, `var(--…)`
   * included, since a band is an element rather than canvas paint.
   */
  changes?: Record<number, string>
}

export function minimap(enabled: boolean, options: MinimapOptions = {}): Extension {
  if (!enabled) return []
  const runs = mergeRuns(options.changes ?? {})
  return [
    showMinimap.compute([], () => ({
      create: () => ({ dom: document.createElement('div') }),
      displayText: 'blocks',
      // Always, not on hover: the point is to see where you are without first
      // having to go and ask.
      showOverlay: 'always'
    })),
    runs.length > 0 ? changeBands(runs) : [],
    minimapTheme
  ]
}

interface Run {
  from: number
  to: number
  colour: string
}

/** Consecutive lines of one colour are one band, so a hunk reads as a block. */
function mergeRuns(changes: Record<number, string>): Run[] {
  const lines = Object.keys(changes)
    .map(Number)
    .filter((line) => Number.isInteger(line) && line > 0)
    .sort((a, b) => a - b)

  const runs: Run[] = []
  for (const line of lines) {
    const colour = changes[line]!
    const last = runs[runs.length - 1]
    if (last && last.to === line - 1 && last.colour === colour) last.to = line
    else runs.push({ from: line, to: line, colour })
  }
  return runs
}

/**
 * The package's own scale, which it does not export.
 *
 * A minimap line is a quarter of an editor line tall, drawn on a canvas with
 * twice the pixels of its box. Both numbers are needed to put a band beside the
 * row it belongs to, and both are checked by the diff's e2e, which measures a
 * band against where the line it marks actually sits in the editor.
 */
const SIZE_RATIO = 4
const PIXEL_RATIO = 2

/** A single changed line is under three pixels tall, which is not a mark. */
const MIN_BAND = 3

interface Geometry {
  /** Canvas pixels per line. */
  lineHeight: number
  /** Canvas pixels above the first drawn line. */
  offsetY: number
  /** 0-based document line the preview starts at. */
  startIndex: number
  /** The preview's height in CSS pixels. */
  height: number
}

/**
 * Where the preview's rows are, worked out the way the package works them out.
 *
 * The package draws a window of lines around wherever you are scrolled to,
 * rather than the whole file scaled to fit, so a band has to be placed by the
 * same arithmetic or it drifts away from the line it marks as you scroll. Every
 * input is public: the editor's own line height, its document padding, and the
 * scroller's position.
 */
function geometry(view: EditorView): Geometry | null {
  const height = view.dom.getBoundingClientRect().height
  // The package measures a line's computed height rather than asking the view,
  // and the two can disagree by a fraction that a thousand lines turn into a
  // visible drift. Measured the same way, they cannot.
  const line = view.contentDOM.querySelector('.cm-line')
  const measured = line ? parseFloat(getComputedStyle(line).lineHeight) : NaN
  const editorLine = Number.isFinite(measured) && measured > 0 ? measured : view.defaultLineHeight
  if (height <= 0 || editorLine <= 0) return null

  const lineHeight = editorLine / SIZE_RATIO
  const padTop = view.documentPadding.top / SIZE_RATIO
  const padBottom = view.documentPadding.bottom / SIZE_RATIO
  const canvasHeight = height * PIXEL_RATIO

  const { clientHeight, scrollHeight, scrollTop } = view.scrollDOM
  const scrolled = scrollHeight > clientHeight ? scrollTop / (scrollHeight - clientHeight) : 0
  const total = padTop + padBottom + view.state.doc.lines * lineHeight
  const canvasTop = Math.max(0, scrolled * (total - canvasHeight))

  return {
    lineHeight,
    offsetY: Math.max(0, padTop - canvasTop),
    startIndex: Math.round(Math.max(0, canvasTop - padTop) / lineHeight),
    height
  }
}

/**
 * The changed lines, as bands across the whole width of the preview.
 *
 * The package can colour a line too, but as a four-pixel strip down one edge of
 * the canvas: at the scale a minimap is read at that is a sliver you have to go
 * looking for, which is the opposite of what it is for. These are elements
 * rather than canvas paint, laid over the preview and under its viewport box,
 * so a change is a stripe you cannot miss and the theme's own colours can be
 * used by name.
 */
function changeBands(runs: Run[]): Extension {
  return ViewPlugin.fromClass(
    class {
      layer: HTMLElement | null = null
      bands: HTMLElement[] = []

      constructor(readonly view: EditorView) {
        // Nothing has been laid out yet in the constructor, so the first draw
        // waits for the frame the minimap itself is built in.
        requestAnimationFrame(() => this.draw())
      }

      update(): void {
        this.draw()
      }

      destroy(): void {
        this.layer?.remove()
        this.layer = null
        this.bands = []
      }

      draw(): void {
        const inner = this.view.dom.querySelector<HTMLElement>('.cm-minimap-inner')
        if (!inner) return
        if (!this.layer?.isConnected) {
          this.layer = document.createElement('div')
          this.layer.className = 'cm-or-minimap-changes'
          this.bands = []
          // Before the viewport box, so the box still reads as the thing on top.
          inner.insertBefore(this.layer, inner.querySelector('.cm-minimap-overlay-container'))
        }

        const geo = geometry(this.view)
        if (!geo) return

        let used = 0
        for (const run of runs) {
          const top = (geo.offsetY + (run.from - 1 - geo.startIndex) * geo.lineHeight) / PIXEL_RATIO
          const height = Math.max(
            MIN_BAND,
            ((run.to - run.from + 1) * geo.lineHeight) / PIXEL_RATIO
          )
          // Lines above or below the drawn window: the package has not drawn
          // them either.
          if (top + height < 0 || top > geo.height) continue

          const band = this.bands[used] ?? this.addBand()
          band.style.display = 'block'
          band.style.top = `${top}px`
          band.style.height = `${height}px`
          band.style.background = run.colour
          used++
        }
        for (let i = used; i < this.bands.length; i++) this.bands[i]!.style.display = 'none'
      }

      addBand(): HTMLElement {
        const band = document.createElement('div')
        band.className = 'cm-or-minimap-change'
        this.layer!.appendChild(band)
        this.bands.push(band)
        return band
      }
    },
    {
      // Scrolling moves the window of lines the preview draws without changing
      // the document, so the bands are placed again on the same frame the
      // package redraws its canvas on.
      eventHandlers: {
        scroll() {
          requestAnimationFrame(() => this.draw())
        }
      }
    }
  )
}

/**
 * The package ships no colours of its own, so the panel would otherwise sit on
 * whatever is behind it with an overlay that cannot be seen. Everything here is
 * a token, so a theme change carries the minimap with it.
 */
const minimapTheme = EditorView.theme({
  // The column itself. Without a background the blocks float over the page and
  // the strip stops wherever the file does, leaving a bright gap below it.
  '& .cm-minimap-gutter': {
    background: 'var(--or-editor-bg)',
    borderLeft: '1px solid var(--or-border)',
    height: '100%'
  },
  // The package's default is a fixed grey that disappears into a dark theme and
  // muddies a light one; the foreground token is legible against either.
  '& .cm-minimap-overlay-container .cm-minimap-overlay': {
    background: 'var(--or-fg)',
    opacity: '0.1'
  },
  '& .cm-minimap-overlay-container .cm-minimap-overlay:hover': {
    opacity: '0.16'
  },
  '& .cm-minimap-overlay-container.cm-minimap-overlay-active .cm-minimap-overlay': {
    opacity: '0.22'
  },
  '& .cm-or-minimap-changes': {
    position: 'absolute',
    inset: '0',
    overflow: 'hidden',
    pointerEvents: 'none'
  },
  // Strong enough to find at a glance, thin enough to read the code through.
  '& .cm-or-minimap-change': {
    position: 'absolute',
    left: '0',
    right: '0',
    opacity: '0.34'
  }
})
