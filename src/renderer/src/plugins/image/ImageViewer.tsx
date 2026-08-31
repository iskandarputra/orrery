import { useEffect, useRef, useState } from 'react'
import { resolveAssetUrl } from '@core/asset'
import { basename } from '@core/paths'
import { Icon } from '@/components/Icon'
import { EmptyState } from '@/components/PanelBits'
import { useStore } from '@/state/store'

/**
 * A picture, shown as a picture.
 *
 * Before this, opening a PNG from the tree read it as UTF-8 into a document:
 * megabytes of replacement characters where an image should be, and a save away
 * from writing that back over the file. A vault is full of images — pasted
 * screenshots, diagrams, scans — and every one of them was a trap.
 *
 * Everything an image viewer needs and nothing else: fit to the window or see
 * it at its own size, zoom in on the detail, and the dimensions, because "is
 * this the big one or the thumbnail" is the question people actually have.
 */

/** How far each zoom step goes, and where it stops. */
const STEP = 1.25
const MIN = 0.05
const MAX = 40

export function ImageViewer({ bufferId }: { bufferId: string }): React.JSX.Element {
  const path = useStore((s) => s.buffers[bufferId]?.filePath ?? '')
  const url = path ? resolveAssetUrl(null, path) : null

  const hostRef = useRef<HTMLDivElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)
  const [broken, setBroken] = useState(false)
  /** null means "fit to the window", which is what a picture opens as. */
  const [zoom, setZoom] = useState<number | null>(null)
  const [fitted, setFitted] = useState(1)

  // What "fit" means here, recomputed when the pane or the picture changes.
  useEffect(() => {
    const host = hostRef.current
    if (!host || !size) return
    const measure = (): void => {
      const room = host.getBoundingClientRect()
      // Never enlarge to fit: a 32-pixel icon blown up to fill a window is a
      // blurry mess, and nobody asked for it.
      setFitted(Math.min(1, (room.width - 32) / size.width, (room.height - 32) / size.height) || 1)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(host)
    return () => observer.disconnect()
  }, [size])

  if (!url || broken) {
    return (
      <div className="imgv">
        <EmptyState icon="image">
          {broken ? 'This image could not be shown.' : 'This file is somewhere unreachable.'}
        </EmptyState>
      </div>
    )
  }

  const scale = zoom ?? fitted
  const step = (by: number): void => setZoom(Math.min(MAX, Math.max(MIN, scale * by)))

  return (
    <div className="imgv">
      <div className="imgv__bar">
        <span className="imgv__name" title={path}>
          {basename(path)}
        </span>
        {size && (
          <span className="imgv__size">
            {size.width} × {size.height}
          </span>
        )}
        <span className="imgv__spacer" />
        <button className="pdfv__action" aria-label="Zoom out" onClick={() => step(1 / STEP)}>
          <Icon name="minus" size={13} />
        </button>
        <span className="imgv__zoom">{Math.round(scale * 100)}%</span>
        <button className="pdfv__action" aria-label="Zoom in" onClick={() => step(STEP)}>
          <Icon name="plus" size={13} />
        </button>
        <button
          className={`pdfv__action${zoom === null ? ' pdfv__action--active' : ''}`}
          aria-label="Fit to the window"
          title="Show the whole picture"
          onClick={() => setZoom(null)}
        >
          <Icon name="minimize" size={13} />
        </button>
        <button
          className="pdfv__action"
          aria-label="Actual size"
          title="One pixel of the image to one of the screen"
          onClick={() => setZoom(1)}
        >
          <Icon name="maximize" size={13} />
        </button>
      </div>

      <div
        className="imgv__stage"
        ref={hostRef}
        onWheel={(event) => {
          // Ctrl with the wheel is how every picture is zoomed, everywhere, and
          // without it the only way in is the toolbar. Plain scrolling is left
          // alone: that is how you look around one already larger than the pane.
          if (!event.ctrlKey && !event.metaKey) return
          event.preventDefault()
          // Proportional to the wheel rather than a fixed notch, so a trackpad
          // pinch is smooth instead of jumping a quarter at a time.
          step(Math.exp(-event.deltaY / 400))
        }}
      >
        <img
          ref={imageRef}
          className="imgv__image"
          src={url}
          alt={basename(path)}
          style={size ? { width: size.width * scale, height: size.height * scale } : undefined}
          onLoad={(event) => {
            const el = event.currentTarget
            // The intrinsic size, which is the thing worth reporting — an SVG
            // without one falls back to what it was drawn at.
            setSize({
              width: el.naturalWidth || el.clientWidth,
              height: el.naturalHeight || el.clientHeight
            })
          }}
          onError={() => setBroken(true)}
        />
      </div>
    </div>
  )
}
