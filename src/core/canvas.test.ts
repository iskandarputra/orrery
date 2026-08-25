import type { GraphNode, LinkGraph } from '@shared/types'
import { describe, expect, it } from 'vitest'
import {
  canvasBounds,
  chooseSides,
  sideAnchor,
  nodeAt,
  parseCanvas,
  seedCanvasFromNotes,
  serializeCanvas,
  type CanvasNode
} from './canvas'

const textNode = (id: string, x: number, y: number): CanvasNode => ({
  id,
  type: 'text',
  text: id,
  x,
  y,
  width: 200,
  height: 100
})

describe('parseCanvas', () => {
  it('reads the JSON Canvas shape', () => {
    const canvas = parseCanvas(
      JSON.stringify({
        nodes: [
          { id: 'a', type: 'text', text: 'hello', x: 10, y: 20, width: 250, height: 60 },
          { id: 'b', type: 'file', file: 'Note.md', x: 0, y: 0, width: 300, height: 200 }
        ],
        edges: [{ id: 'e', fromNode: 'a', toNode: 'b' }]
      })
    )
    expect(canvas.nodes).toHaveLength(2)
    expect(canvas.nodes[0]).toMatchObject({ type: 'text', text: 'hello', x: 10 })
    expect(canvas.edges[0]).toMatchObject({ fromNode: 'a', toNode: 'b' })
  })

  it('opens an empty or blank file as an empty canvas', () => {
    expect(parseCanvas('')).toEqual({ nodes: [], edges: [] })
    expect(parseCanvas('   ')).toEqual({ nodes: [], edges: [] })
    expect(parseCanvas('{}')).toEqual({ nodes: [], edges: [] })
  })

  it('survives a corrupt file instead of throwing', () => {
    expect(parseCanvas('{ not json')).toEqual({ nodes: [], edges: [] })
  })

  it('drops malformed nodes but keeps the good ones', () => {
    const canvas = parseCanvas(
      JSON.stringify({
        nodes: [
          { id: 'ok', type: 'text', text: 'fine', x: 0, y: 0, width: 100, height: 50 },
          { id: 'no-type', x: 0, y: 0 },
          { type: 'text', x: 0, y: 0 }, // no id
          'nonsense'
        ],
        edges: [{ id: 'e1', fromNode: 'ok', toNode: 'missing' }, { id: 'e2' }]
      })
    )
    expect(canvas.nodes.map((n) => n.id)).toEqual(['ok'])
    // An edge pointing at a node that didn't survive is dropped too.
    expect(canvas.edges).toEqual([])
  })

  it('supplies sane sizes when they are missing', () => {
    const canvas = parseCanvas(
      JSON.stringify({ nodes: [{ id: 'a', type: 'text', text: 'x', x: 5, y: 6 }] })
    )
    expect(canvas.nodes[0]!.width).toBeGreaterThan(0)
    expect(canvas.nodes[0]!.height).toBeGreaterThan(0)
  })
})

describe('serializeCanvas', () => {
  it('round-trips without losing anything', () => {
    const source = {
      nodes: [
        { id: 'a', type: 'text' as const, text: 'hi', x: 1, y: 2, width: 3, height: 4, color: '5' },
        { id: 'b', type: 'file' as const, file: 'N.md', x: 9, y: 8, width: 7, height: 6 }
      ],
      edges: [{ id: 'e', fromNode: 'a', fromSide: 'right' as const, toNode: 'b', label: 'why' }]
    }
    expect(parseCanvas(serializeCanvas(source))).toEqual(source)
  })

  it('writes indented JSON so the file survives version control', () => {
    const out = serializeCanvas({ nodes: [textNode('a', 0, 0)], edges: [] })
    expect(out).toContain('\n  ')
    expect(out.endsWith('\n')).toBe(true)
  })
})

describe('geometry', () => {
  it('measures the bounding box of every node', () => {
    const bounds = canvasBounds([textNode('a', 0, 0), textNode('b', 300, 150)])
    expect(bounds).toEqual({ minX: 0, minY: 0, maxX: 500, maxY: 250 })
  })

  it('returns a zero box for an empty canvas', () => {
    expect(canvasBounds([])).toEqual({ minX: 0, minY: 0, maxX: 0, maxY: 0 })
  })

  it('hit-tests the topmost node under a point', () => {
    const stacked = [textNode('under', 0, 0), textNode('over', 50, 50)]
    expect(nodeAt(stacked, 60, 60)?.id).toBe('over') // later nodes draw on top
    expect(nodeAt(stacked, 10, 10)?.id).toBe('under')
    expect(nodeAt(stacked, 900, 900)).toBeNull()
  })
})

describe('seedCanvasFromNotes', () => {
  function node(id: string): GraphNode {
    return { id, label: id, exists: true, degree: 0, folder: '', words: 0, mtimeMs: 0 }
  }
  const graph: LinkGraph = {
    nodes: ['/v/A.md', '/v/B.md', '/v/C.md'].map(node),
    edges: [{ from: '/v/A.md', to: '/v/B.md' }]
  }

  it('turns notes into file nodes and keeps the links between them', () => {
    const canvas = seedCanvasFromNotes(graph, ['/v/A.md', '/v/B.md'], '/v')
    expect(canvas.nodes).toHaveLength(2)
    expect(canvas.nodes[0]).toMatchObject({ type: 'file', file: 'A.md' })
    expect(canvas.edges).toHaveLength(1)
    expect(canvas.edges[0]).toMatchObject({ fromNode: canvas.nodes[0]!.id })
  })

  it('leaves out links to notes that are not on the canvas', () => {
    const canvas = seedCanvasFromNotes(graph, ['/v/A.md', '/v/C.md'], '/v')
    expect(canvas.edges).toEqual([])
  })

  it('never overlaps two nodes', () => {
    const many: LinkGraph = {
      nodes: Array.from({ length: 12 }, (_, i) => node(`/v/n${i}.md`)),
      edges: []
    }
    const canvas = seedCanvasFromNotes(many, many.nodes.map((n) => n.id), '/v')
    for (const a of canvas.nodes) {
      for (const b of canvas.nodes) {
        if (a.id === b.id) continue
        const apart =
          a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y
        expect(apart).toBe(true)
      }
    }
  })

  it('places notes in the same order every time', () => {
    const first = seedCanvasFromNotes(graph, ['/v/A.md', '/v/B.md'], '/v')
    const second = seedCanvasFromNotes(graph, ['/v/A.md', '/v/B.md'], '/v')
    expect(first.nodes.map((n) => [n.x, n.y])).toEqual(second.nodes.map((n) => [n.x, n.y]))
  })
})

describe('edge geometry', () => {
  const a = { ...textNode('a', 0, 0), width: 100, height: 100 }
  const b = { ...textNode('b', 300, 0), width: 100, height: 100 }

  it('anchors to the middle of the named side', () => {
    expect(sideAnchor(a, 'right')).toEqual({ x: 100, y: 50 })
    expect(sideAnchor(a, 'left')).toEqual({ x: 0, y: 50 })
    expect(sideAnchor(a, 'top')).toEqual({ x: 50, y: 0 })
    expect(sideAnchor(a, 'bottom')).toEqual({ x: 50, y: 100 })
  })

  it('faces the sides that point at each other', () => {
    expect(chooseSides(a, b)).toEqual({ from: 'right', to: 'left' })
    expect(chooseSides(b, a)).toEqual({ from: 'left', to: 'right' })
  })

  it('uses top and bottom when the gap is mostly vertical', () => {
    const below = { ...textNode('c', 0, 400), width: 100, height: 100 }
    expect(chooseSides(a, below)).toEqual({ from: 'bottom', to: 'top' })
    expect(chooseSides(below, a)).toEqual({ from: 'top', to: 'bottom' })
  })
})
