import { useCallback, useEffect, useRef, useState } from 'react'
import katex from 'katex'
import {
  actualSize,
  fitBounds,
  panBy,
  transformOf,
  zoomAround,
  zoomToCentre,
  type Bounds,
  type Viewport,
  type ZoomLimits
} from '@core/pan-zoom'
import { renderMermaid } from '@/editor/live-preview/mermaid'
import { MEDIA_NOUN } from '@/state/ui'
import { useStore } from '@/state/store'
import { Icon } from './Icon'

/**
 * Wider than the canvas board's range: a diagram scaled down to a prose column
 * is the reason this exists, so it has to be able to go well past 1:1, and a
 * page-sized screenshot has to be able to come well below it.
 */
const LIMITS: ZoomLimits = { min: 0.1, max: 8 }
/** Content-space breathing room when framing. */
const FIT_PAD = 24
const STEP = 1.25
/** Arrow-key pan, in viewport pixels. */
const NUDGE = 60

/**
 * Code is scaled by type size, not by transform. Panning a wall of text with a
 * drag is the wrong gesture — it wants a scrollbar and a wheel — and zooming it
 * to 340% is not what "bigger" means for something you are going to read.
 */
const BASE_FONT = 14
const MIN_FONT = 9
const MAX_FONT = 32

/**
 * Mermaid sizes its SVG to the element it was rendered into and caps it with an
 * inline max-width. In here the SVG *is* the content being measured, so it has
 * to carry its own natural size instead — otherwise it reports the viewport's
 * size back to us and every diagram "fits" at 1:1 no matter how big it is.
 */
function naturalizeSvg(host: HTMLElement): void {
  const svg = host.querySelector('svg')
  if (!svg) return
  svg.style.maxWidth = 'none'
  const vb = svg.viewBox.baseVal
  if (vb && vb.width > 0 && vb.height > 0) {
    svg.style.width = `${vb.width}px`
    svg.style.height = `${vb.height}px`
  }
}

/**
 * A diagram, image or equation, full screen, pannable and zoomable.
 *
 * Clicking a block in the editor already means "reveal the source", so this is
 * opened by an explicit control on the block (or the Expand Media command)
 * rather than by a bare click.
 */
export function MediaViewerModal(): React.JSX.Element | null {
  const target = useStore((s) => s.mediaViewer)
  const close = useStore((s) => s.closeMediaViewer)

  const stageRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, zoom: 1 })
  /** Natural content size, measured once the media has actually laid out. */
  const [bounds, setBounds] = useState<Bounds | null>(null)
  const [panning, setPanning] = useState(false)
  /** Code presentation only. */
  const [fontSize, setFontSize] = useState(BASE_FONT)
  const [wrap, setWrap] = useState(false)

  // A fresh block opens at the default size, not at whatever the last one was
  // left on. Adjusted during render rather than in an effect — React's own
  // guidance for reacting to a changed input, and one render pass instead of two.
  const [shown, setShown] = useState(target)
  if (target !== shown) {
    setShown(target)
    setFontSize(BASE_FONT)
    setWrap(false)
  }

  const stageSize = (): { width: number; height: number } => {
    const rect = stageRef.current?.getBoundingClientRect()
    return { width: rect?.width ?? 0, height: rect?.height ?? 0 }
  }

  /**
   * Measure the content at its natural size and frame it. `offsetWidth` is the
   * pre-transform layout size, so this is unaffected by the zoom already applied.
   */
  const measureAndFit = useCallback((): boolean => {
    const el = contentRef.current
    if (!el) return false
    const width = el.offsetWidth
    const height = el.offsetHeight
    if (width <= 0 || height <= 0) return false
    const box: Bounds = { minX: 0, minY: 0, maxX: width, maxY: height }
    setBounds(box)
    setViewport(fitBounds(stageSize(), box, LIMITS, FIT_PAD))
    return true
  }, [])

  // Paint the media, then frame it. Each kind reaches its final size at a
  // different moment — an image on load, a diagram when mermaid resolves — so
  // measuring is driven by whichever of those happens, not by mount.
  useEffect(() => {
    const el = contentRef.current
    if (!target || target.kind === 'code' || !el) return
    setBounds(null)
    setViewport({ x: 0, y: 0, zoom: 1 })
    let live = true

    if (target.kind === 'mermaid') {
      el.replaceChildren()
      const host = document.createElement('div')
      el.appendChild(host)
      void renderMermaid(target.code ?? '', host).then(() => {
        if (!live) return
        naturalizeSvg(host)
        measureAndFit()
      })
    } else if (target.kind === 'math') {
      el.replaceChildren()
      const host = document.createElement('div')
      host.className = 'media-viewer__math'
      try {
        katex.render(target.code ?? '', host, { displayMode: true, throwOnError: false })
      } catch {
        host.textContent = target.code ?? ''
      }
      el.appendChild(host)
      measureAndFit()
    }

    return () => {
      live = false
    }
  }, [target, measureAndFit])

  useEffect(() => {
    if (!target) return
    const onKey = (e: KeyboardEvent): void => {
      const size = stageSize()
      if (e.key === 'Escape') return close()

      if (target.kind === 'code') {
        // Arrows and Page keys are left alone so the stage scrolls natively.
        if (e.key === '+' || e.key === '=') {
          setFontSize((f) => Math.min(MAX_FONT, f + 1))
        } else if (e.key === '-' || e.key === '_') {
          setFontSize((f) => Math.max(MIN_FONT, f - 1))
        } else if (e.key === '0') {
          setFontSize(BASE_FONT)
        } else {
          return
        }
        e.preventDefault()
        return
      }

      if (e.key === '+' || e.key === '=') {
        setViewport((v) => zoomToCentre(v, STEP, size, LIMITS))
      } else if (e.key === '-' || e.key === '_') {
        setViewport((v) => zoomToCentre(v, 1 / STEP, size, LIMITS))
      } else if (e.key === '0') {
        if (bounds) setViewport(fitBounds(size, bounds, LIMITS, FIT_PAD))
      } else if (e.key === '1') {
        if (bounds) setViewport(actualSize(size, bounds))
      } else if (e.key === 'ArrowLeft') {
        setViewport((v) => panBy(v, NUDGE, 0))
      } else if (e.key === 'ArrowRight') {
        setViewport((v) => panBy(v, -NUDGE, 0))
      } else if (e.key === 'ArrowUp') {
        setViewport((v) => panBy(v, 0, NUDGE))
      } else if (e.key === 'ArrowDown') {
        setViewport((v) => panBy(v, 0, -NUDGE))
      } else {
        return
      }
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [target, close, bounds])

  // Re-frame when the window changes shape, so the diagram does not end up
  // parked off screen after a resize.
  useEffect(() => {
    if (!target || target.kind === 'code' || !bounds) return
    const onResize = (): void => setViewport(fitBounds(stageSize(), bounds, LIMITS, FIT_PAD))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [target, bounds])

  if (!target) return null

  const isCode = target.kind === 'code'
  const noun = MEDIA_NOUN[target.kind]
  const detail = (isCode ? target.lang : target.alt)?.trim()
  const label = detail ? `${noun}: ${detail}` : noun

  const onWheel = (e: React.WheelEvent): void => {
    const rect = stageRef.current?.getBoundingClientRect()
    if (!rect) return
    // Plain wheel zooms here — unlike the canvas board, where a plain wheel
    // scrolls the board and only ctrl/cmd zooms. There is nothing to scroll in
    // a single-object viewer, and zoom is the whole point of it.
    const factor = e.deltaY < 0 ? STEP : 1 / STEP
    setViewport((v) => zoomAround(v, factor, e.clientX - rect.left, e.clientY - rect.top, LIMITS))
  }

  const onPointerDown = (e: React.PointerEvent): void => {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    setPanning(true)
  }

  const onPointerMove = (e: React.PointerEvent): void => {
    if (!panning) return
    setViewport((v) => panBy(v, e.movementX, e.movementY))
  }

  const endPan = (e: React.PointerEvent): void => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    setPanning(false)
  }

  const zoomBy = (factor: number): void =>
    setViewport((v) => zoomToCentre(v, factor, stageSize(), LIMITS))

  return (
    <div
      className="modal-backdrop media-viewer"
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <div className="media-viewer__frame" role="dialog" aria-modal="true" aria-label={label}>
        <div className="media-viewer__bar">
          <span className="media-viewer__title">{label}</span>
          <div className="media-viewer__tools">
            <button
              className="icon-btn"
              aria-label={isCode ? 'Smaller text' : 'Zoom out'}
              title={isCode ? 'Smaller text (−)' : 'Zoom out (−)'}
              onClick={() =>
                isCode ? setFontSize((f) => Math.max(MIN_FONT, f - 1)) : zoomBy(1 / STEP)
              }
            >
              <Icon name="minus" size={14} />
            </button>
            <span
              className="media-viewer__pct"
              aria-live="polite"
              title={isCode ? 'Text size (0 resets)' : 'Zoom (0 fits, 1 is actual size)'}
            >
              {isCode ? `${fontSize}px` : `${Math.round(viewport.zoom * 100)}%`}
            </span>
            <button
              className="icon-btn"
              aria-label={isCode ? 'Larger text' : 'Zoom in'}
              title={isCode ? 'Larger text (+)' : 'Zoom in (+)'}
              onClick={() =>
                isCode ? setFontSize((f) => Math.min(MAX_FONT, f + 1)) : zoomBy(STEP)
              }
            >
              <Icon name="plus" size={14} />
            </button>
            {isCode ? (
              <button
                className="media-viewer__toggle"
                aria-pressed={wrap}
                title="Wrap long lines"
                onClick={() => setWrap((w) => !w)}
              >
                Wrap
              </button>
            ) : (
              <>
                <button
                  className="icon-btn"
                  aria-label="Fit to window"
                  title="Fit to window (0)"
                  onClick={() =>
                    bounds && setViewport(fitBounds(stageSize(), bounds, LIMITS, FIT_PAD))
                  }
                >
                  <Icon name="maximize" size={14} />
                </button>
                <button
                  className="icon-btn"
                  aria-label="Actual size"
                  title="Actual size (1)"
                  onClick={() => bounds && setViewport(actualSize(stageSize(), bounds))}
                >
                  <Icon name="minimize" size={14} />
                </button>
              </>
            )}
            <button className="icon-btn" aria-label="Close" title="Close (Esc)" onClick={close}>
              <Icon name="x" size={15} />
            </button>
          </div>
        </div>

        {isCode ? (
          <div ref={stageRef} className="media-viewer__stage media-viewer__stage--code">
            <pre
              className={`media-viewer__code${wrap ? ' media-viewer__code--wrap' : ''}`}
              style={{ fontSize: `${fontSize}px` }}
            >
              <code>
                {(target.spans ?? [{ text: target.code ?? '', cls: '' }]).map((span, i) =>
                  span.cls ? (
                    <span key={i} className={span.cls}>
                      {span.text}
                    </span>
                  ) : (
                    span.text
                  )
                )}
              </code>
            </pre>
          </div>
        ) : (
          <div
            ref={stageRef}
            className={`media-viewer__stage${panning ? ' media-viewer__stage--panning' : ''}`}
            onWheel={onWheel}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endPan}
            onPointerCancel={endPan}
          >
            <div
              ref={contentRef}
              className="media-viewer__content"
              style={{
                transform: transformOf(viewport),
                visibility: bounds ? 'visible' : 'hidden'
              }}
            >
              {target.kind === 'image' && (
                <img src={target.src} alt={target.alt ?? ''} onLoad={measureAndFit} />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
