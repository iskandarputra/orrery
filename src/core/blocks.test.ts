import { describe, expect, it } from 'vitest'
import { blockIndexAt, moveBlock, moveBlockTo, type Block } from './blocks'

/** Blocks of a document, as the syntax tree reports them. */
function blocksOf(text: string): Block[] {
  const found: Block[] = []
  let at = 0
  for (const chunk of text.split(/\n{2,}/)) {
    const from = text.indexOf(chunk, at)
    found.push({ from, to: from + chunk.length })
    at = from + chunk.length
  }
  return found
}

const DOC = 'first para\n\nsecond para\n\n- a list\n- of items\n\nlast para'

describe('blockIndexAt', () => {
  const blocks = blocksOf(DOC)

  it('finds the block a position sits in', () => {
    expect(blockIndexAt(blocks, 0)).toBe(0)
    expect(blockIndexAt(blocks, DOC.indexOf('second'))).toBe(1)
    expect(blockIndexAt(blocks, DOC.indexOf('of items'))).toBe(2)
  })

  it('counts the very end of a block as inside it', () => {
    expect(blockIndexAt(blocks, blocks[0]!.to)).toBe(0)
  })

  it('returns -1 between blocks', () => {
    expect(
      blockIndexAt(
        [
          { from: 0, to: 3 },
          { from: 10, to: 14 }
        ],
        6
      )
    ).toBe(-1)
  })
})

describe('moveBlock', () => {
  const blocks = blocksOf(DOC)

  it('swaps a block with the one above', () => {
    const moved = moveBlock(DOC, blocks, 1, 'up')!
    expect(moved.text).toBe('second para\n\nfirst para\n\n- a list\n- of items\n\nlast para')
  })

  it('swaps a block with the one below', () => {
    const moved = moveBlock(DOC, blocks, 0, 'down')!
    expect(moved.text.startsWith('second para\n\nfirst para')).toBe(true)
  })

  it('moves a multi-line block whole', () => {
    const moved = moveBlock(DOC, blocks, 2, 'up')!
    expect(moved.text).toBe('first para\n\n- a list\n- of items\n\nsecond para\n\nlast para')
  })

  it('reports where the moved block ended up, so the caret can follow it', () => {
    const moved = moveBlock(DOC, blocks, 1, 'up')!
    expect(moved.text.slice(moved.from, moved.to)).toBe('second para')
  })

  it('refuses to move past either end', () => {
    expect(moveBlock(DOC, blocks, 0, 'up')).toBeNull()
    expect(moveBlock(DOC, blocks, blocks.length - 1, 'down')).toBeNull()
  })

  it('leaves the separators where they are', () => {
    // Blocks swap; the blank lines between them do not travel.
    const doc = 'one\n\n\n\ntwo'
    const moved = moveBlock(doc, blocksOf(doc), 1, 'up')!
    expect(moved.text).toBe('two\n\n\n\none')
  })

  it('says nothing to do for an unknown block', () => {
    expect(moveBlock(DOC, blocks, -1, 'up')).toBeNull()
    expect(moveBlock(DOC, blocks, 99, 'down')).toBeNull()
  })
})

describe('moveBlockTo', () => {
  const DOC2 = 'A\n\nB\n\nC\n\nD'
  const blocks = blocksOf(DOC2)

  it('drops a block before a later one', () => {
    expect(moveBlockTo(DOC2, blocks, 0, 2)!.text).toBe('B\n\nA\n\nC\n\nD')
  })

  it('drops a block before an earlier one', () => {
    expect(moveBlockTo(DOC2, blocks, 3, 1)!.text).toBe('A\n\nD\n\nB\n\nC')
  })

  it('moves a block to the very end', () => {
    expect(moveBlockTo(DOC2, blocks, 0, 4)!.text).toBe('B\n\nC\n\nD\n\nA')
  })

  it('does nothing when dropped where it already is', () => {
    expect(moveBlockTo(DOC2, blocks, 1, 1)).toBeNull()
    expect(moveBlockTo(DOC2, blocks, 1, 2)).toBeNull()
  })

  it('keeps the separator style of the document', () => {
    const doc = 'A\n\nB\n\nC'
    expect(moveBlockTo(doc, blocksOf(doc), 2, 0)!.text).toBe('C\n\nA\n\nB')
  })

  it('reports where the block landed', () => {
    const moved = moveBlockTo(DOC2, blocks, 0, 2)!
    expect(moved.text.slice(moved.from, moved.to)).toBe('A')
  })

  it('refuses nonsense indexes', () => {
    expect(moveBlockTo(DOC2, blocks, -1, 2)).toBeNull()
    expect(moveBlockTo(DOC2, blocks, 0, 99)).toBeNull()
  })
})
