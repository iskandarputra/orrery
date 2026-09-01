import { syntaxTree } from '@codemirror/language'
import { EditorSelection, type EditorState } from '@codemirror/state'
import type { Command, KeyBinding } from '@codemirror/view'
import { blockIndexAt, moveBlock, type Block } from '@core/blocks'

/**
 * The document's top-level blocks: paragraphs, lists, quotes, fenced code,
 * headings, tables. Reading them from the syntax tree rather than guessing at
 * blank lines is what makes "move this block" move a whole list or code fence
 * instead of one line of it.
 */
export function topLevelBlocks(state: EditorState): Block[] {
  const blocks: Block[] = []
  const tree = syntaxTree(state)
  const cursor = tree.cursor()
  if (!cursor.firstChild()) return blocks
  do {
    blocks.push({ from: cursor.from, to: cursor.to })
  } while (cursor.nextSibling())
  return blocks
}

function move(direction: 'up' | 'down'): Command {
  return (view) => {
    const blocks = topLevelBlocks(view.state)
    const head = view.state.selection.main.head
    const index = blockIndexAt(blocks, head)
    if (index === -1) return false

    const text = view.state.doc.toString()
    const moved = moveBlock(text, blocks, index, direction)
    if (!moved) return false

    // The caret keeps its place *within* the block, so repeated presses walk
    // the block along instead of stranding the cursor.
    const offsetInBlock = head - blocks[index]!.from
    view.dispatch({
      changes: { from: 0, to: text.length, insert: moved.text },
      selection: EditorSelection.cursor(
        moved.from + Math.min(offsetInBlock, moved.to - moved.from)
      ),
      scrollIntoView: true,
      userEvent: 'move.block'
    })
    return true
  }
}

export const moveBlockUp = move('up')
export const moveBlockDown = move('down')

/** Alt+Up / Alt+Down, as every block editor binds them. */
export const blockMoveKeymap: KeyBinding[] = [
  { key: 'Alt-ArrowUp', run: moveBlockUp, preventDefault: true },
  { key: 'Alt-ArrowDown', run: moveBlockDown, preventDefault: true }
]
