import { EditorSelection } from '@codemirror/state'
import type { Extension } from '@codemirror/state'
import { GutterMarker, gutter } from '@codemirror/view'
import type { EditorView } from '@codemirror/view'
import { blockIndexAt, moveBlockTo } from '@core/blocks'
import { topLevelBlocks } from './block-move'

/** The grip shown beside a block; dragging it reorders the block. */
class HandleMarker extends GutterMarker {
  override toDOM(): HTMLElement {
    const handle = document.createElement('div')
    handle.className = 'cm-or-block-handle'
    handle.title = 'Drag to move this block'
    handle.textContent = '⠿'
    return handle
  }
}

const handle = new HandleMarker()

/** Index of the block the drop lands before, from a pointer position. */
function dropIndexAt(view: EditorView, clientY: number): number | null {
  const blocks = topLevelBlocks(view.state)
  if (blocks.length === 0) return null
  const rect = view.dom.getBoundingClientRect()
  const y = Math.min(Math.max(clientY, rect.top + 1), rect.bottom - 1)
  const pos = view.posAtCoords({ x: rect.left + 8, y }) ?? view.state.doc.length

  const index = blockIndexAt(blocks, pos)
  if (index === -1)
    return blocks.findIndex((block) => block.from > pos) === -1
      ? blocks.length
      : blocks.findIndex((block) => block.from > pos)

  // Past the middle of a block means "after it", which is "before the next".
  const block = blocks[index]!
  const top = view.coordsAtPos(block.from)?.top ?? 0
  const bottom = view.coordsAtPos(block.to)?.bottom ?? top
  return y > (top + bottom) / 2 ? index + 1 : index
}

/**
 * Drag handles in the gutter, the way a block editor lets you pick a paragraph
 * up and drop it elsewhere. The whole block travels — a list, a fenced block, a
 * quote — because the blocks come from the syntax tree, not from blank lines.
 */
export function blockHandles(): Extension {
  return [
    gutter({
      class: 'cm-or-block-gutter',
      lineMarker: (view, line) => {
        const blocks = topLevelBlocks(view.state)
        // One handle per block, on the line the block starts at.
        return blocks.some((block) => block.from === line.from) ? handle : null
      },
      lineMarkerChange: (update) => update.docChanged,
      initialSpacer: () => handle,
      domEventHandlers: {
        mousedown: (view, line, event) => {
          const mouse = event as MouseEvent
          if (mouse.button !== 0) return false
          const blocks = topLevelBlocks(view.state)
          const index = blocks.findIndex((block) => block.from === line.from)
          if (index === -1) return false

          view.dom.classList.add('cm-or-dragging-block')
          const indicator = document.createElement('div')
          indicator.className = 'cm-or-drop-line'
          view.dom.appendChild(indicator)

          const showDrop = (clientY: number): number | null => {
            const target = dropIndexAt(view, clientY)
            if (target === null) return null
            const blocksNow = topLevelBlocks(view.state)
            const pos = target >= blocksNow.length ? view.state.doc.length : blocksNow[target]!.from
            const coords = view.coordsAtPos(pos)
            if (coords) {
              const rect = view.dom.getBoundingClientRect()
              indicator.style.top = `${coords.top - rect.top}px`
            }
            return target
          }
          let target = showDrop(mouse.clientY)

          const onMove = (moveEvent: MouseEvent): void => {
            target = showDrop(moveEvent.clientY)
          }
          const onUp = (): void => {
            window.removeEventListener('mousemove', onMove)
            window.removeEventListener('mouseup', onUp)
            indicator.remove()
            view.dom.classList.remove('cm-or-dragging-block')
            if (target === null) return

            const text = view.state.doc.toString()
            const moved = moveBlockTo(text, topLevelBlocks(view.state), index, target)
            if (!moved) return
            view.dispatch({
              changes: { from: 0, to: text.length, insert: moved.text },
              selection: EditorSelection.cursor(moved.from),
              userEvent: 'move.block'
            })
          }
          window.addEventListener('mousemove', onMove)
          window.addEventListener('mouseup', onUp)
          return true
        }
      }
    })
  ]
}
