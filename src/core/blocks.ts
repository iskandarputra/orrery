export interface Block {
  from: number
  to: number
}

export interface MovedBlock {
  text: string
  /** Where the moved block now starts and ends, so the caret can follow it. */
  from: number
  to: number
}

/** Index of the block containing `pos`, or -1 if it falls between blocks. */
export function blockIndexAt(blocks: readonly Block[], pos: number): number {
  return blocks.findIndex((block) => pos >= block.from && pos <= block.to)
}

/**
 * Swap a block with its neighbour, the way "move this paragraph up" should
 * behave: the whole block travels — a list, a fenced code block, a quote — and
 * the blank lines between blocks stay where they are rather than travelling
 * with it, which would slowly reshape the document's spacing.
 */
export function moveBlock(
  text: string,
  blocks: readonly Block[],
  index: number,
  direction: 'up' | 'down'
): MovedBlock | null {
  const otherIndex = direction === 'up' ? index - 1 : index + 1
  if (index < 0 || index >= blocks.length) return null
  if (otherIndex < 0 || otherIndex >= blocks.length) return null

  const first = blocks[Math.min(index, otherIndex)]!
  const second = blocks[Math.max(index, otherIndex)]!
  const firstText = text.slice(first.from, first.to)
  const secondText = text.slice(second.from, second.to)
  const between = text.slice(first.to, second.from)

  const swapped =
    text.slice(0, first.from) + secondText + between + firstText + text.slice(second.to)

  // Where the block the user asked to move now sits.
  const movedFrom =
    direction === 'up' ? first.from : first.from + secondText.length + between.length
  const moved = direction === 'up' ? secondText : firstText
  return { text: swapped, from: movedFrom, to: movedFrom + moved.length }
}

/**
 * Move a block to sit before block `toIndex` (or to the end when `toIndex` is
 * past the last block) — what dragging a block by its handle does.
 *
 * The separator between blocks is reused rather than carried along, so a
 * document written with one blank line between blocks stays that way.
 */
export function moveBlockTo(
  text: string,
  blocks: readonly Block[],
  fromIndex: number,
  toIndex: number
): MovedBlock | null {
  if (fromIndex < 0 || fromIndex >= blocks.length) return null
  if (toIndex < 0 || toIndex > blocks.length) return null
  // Dropping a block just before or just after itself changes nothing.
  if (toIndex === fromIndex || toIndex === fromIndex + 1) return null

  const source = blocks[fromIndex]!
  const moving = text.slice(source.from, source.to)
  // The gap that follows a block, reused wherever it lands.
  const separator =
    blocks.length > 1
      ? fromIndex < blocks.length - 1
        ? text.slice(source.to, blocks[fromIndex + 1]!.from)
        : text.slice(blocks[fromIndex - 1]!.to, source.from)
      : '\n\n'

  // Remove the block along with the gap that separated it from its neighbour.
  const cutFrom = fromIndex < blocks.length - 1 ? source.from : blocks[fromIndex - 1]!.to
  const cutTo = fromIndex < blocks.length - 1 ? blocks[fromIndex + 1]!.from : source.to
  const without = text.slice(0, cutFrom) + text.slice(cutTo)

  // Where the drop lands, once the removal has shifted everything after it.
  const anchor = toIndex >= blocks.length ? text.length : blocks[toIndex]!.from
  const shift = cutTo - cutFrom
  const insertAt = anchor > cutFrom ? anchor - shift : anchor

  const atEnd = insertAt >= without.length
  const insertion = atEnd ? `${separator}${moving}` : `${moving}${separator}`
  const landed = atEnd ? insertAt + separator.length : insertAt

  return {
    text: without.slice(0, insertAt) + insertion + without.slice(insertAt),
    from: landed,
    to: landed + moving.length
  }
}
