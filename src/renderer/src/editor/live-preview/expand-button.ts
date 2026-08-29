import { MEDIA_NOUN, type MediaViewerTarget } from '@/state/ui'
import { appState } from '@/state/app-state-access'

/** The `maximize` icon from the app's set, as markup a plain widget can use. */
const ICON =
  '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" ' +
  'stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M10 2.5h3.5V6M6 13.5H2.5V10M13.5 2.5L9 7M2.5 13.5L7 9" /></svg>'

/**
 * The corner control that opens a rendered block in the full-screen viewer.
 *
 * Enlarging needs a control of its own because a bare click on one of these
 * blocks already means something: in the editor it puts the caret in the source.
 * The button stops its own events reaching either the block's handler or
 * CodeMirror, so the two gestures stay separate.
 *
 * Returns a button the caller positions; the caller is also responsible for
 * giving the block `position: relative`.
 */
export function expandButton(target: MediaViewerTarget): HTMLButtonElement {
  const noun = MEDIA_NOUN[target.kind]
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'cm-or-expand'
  btn.setAttribute('aria-label', `Expand ${noun}`)
  btn.title = `Expand ${noun}`
  btn.innerHTML = ICON
  btn.addEventListener('mousedown', (event) => {
    event.preventDefault()
    event.stopPropagation()
  })
  btn.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    appState().openMediaViewer(target)
  })
  return btn
}
