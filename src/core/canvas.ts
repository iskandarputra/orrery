import type { LinkGraph } from '@shared/types'

/**
 * The JSON Canvas format (jsoncanvas.org) — the same `.canvas` files Obsidian
 * writes, so boards move between the two without conversion.
 */

export type CanvasSide = 'top' | 'right' | 'bottom' | 'left'

interface BaseNode {
  id: string
  x: number
  y: number
  width: number
  height: number
  /** Preset "1"–"6" or a hex colour. */
  color?: string
}

export interface TextNode extends BaseNode {
  type: 'text'
  text: string
}

export interface FileNodeRef extends BaseNode {
  type: 'file'
  /** Vault-relative path. */
  file: string
  subpath?: string
}

export interface LinkNode extends BaseNode {
  type: 'link'
  url: string
}

export interface GroupNode extends BaseNode {
  type: 'group'
  label?: string
}

export type CanvasNode = TextNode | FileNodeRef | LinkNode | GroupNode

export interface CanvasEdge {
  id: string
  fromNode: string
  fromSide?: CanvasSide
  toNode: string
  toSide?: CanvasSide
  color?: string
  label?: string
}

export interface JsonCanvas {
  nodes: CanvasNode[]
  edges: CanvasEdge[]
}

export const DEFAULT_NODE_WIDTH = 260
export const DEFAULT_NODE_HEIGHT = 120
/** Gap between seeded cards, so a generated board isn't cramped. */
const SEED_GAP = 60

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const num = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback

const str = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined)

function parseNode(raw: unknown): CanvasNode | null {
  if (!isRecord(raw)) return null
  const id = str(raw['id'])
  const type = str(raw['type'])
  if (!id || !type) return null

  const base = {
    id,
    x: num(raw['x'], 0),
    y: num(raw['y'], 0),
    width: num(raw['width'], DEFAULT_NODE_WIDTH),
    height: num(raw['height'], DEFAULT_NODE_HEIGHT),
    ...(str(raw['color']) ? { color: str(raw['color'])! } : {})
  }

  switch (type) {
    case 'text':
      return { ...base, type: 'text', text: str(raw['text']) ?? '' }
    case 'file': {
      const file = str(raw['file'])
      if (!file) return null
      const subpath = str(raw['subpath'])
      return { ...base, type: 'file', file, ...(subpath ? { subpath } : {}) }
    }
    case 'link': {
      const url = str(raw['url'])
      return url ? { ...base, type: 'link', url } : null
    }
    case 'group': {
      const label = str(raw['label'])
      return { ...base, type: 'group', ...(label ? { label } : {}) }
    }
    default:
      return null
  }
}

const SIDES: CanvasSide[] = ['top', 'right', 'bottom', 'left']
const side = (value: unknown): CanvasSide | undefined =>
  SIDES.includes(value as CanvasSide) ? (value as CanvasSide) : undefined

function parseEdge(raw: unknown, known: Set<string>): CanvasEdge | null {
  if (!isRecord(raw)) return null
  const id = str(raw['id'])
  const fromNode = str(raw['fromNode'])
  const toNode = str(raw['toNode'])
  // An edge to a node that didn't survive parsing would draw into nowhere.
  if (!id || !fromNode || !toNode || !known.has(fromNode) || !known.has(toNode)) return null
  const fromSide = side(raw['fromSide'])
  const toSide = side(raw['toSide'])
  const color = str(raw['color'])
  const label = str(raw['label'])
  return {
    id,
    fromNode,
    toNode,
    ...(fromSide ? { fromSide } : {}),
    ...(toSide ? { toSide } : {}),
    ...(color ? { color } : {}),
    ...(label ? { label } : {})
  }
}

/**
 * Read a `.canvas` file. Deliberately forgiving: a board someone hand-edited
 * (or a newer node type from another app) opens with whatever is valid rather
 * than failing shut and looking like data loss.
 */
export function parseCanvas(source: string): JsonCanvas {
  let raw: unknown
  try {
    raw = JSON.parse(source.trim() || '{}')
  } catch {
    return { nodes: [], edges: [] }
  }
  if (!isRecord(raw)) return { nodes: [], edges: [] }

  const nodes = Array.isArray(raw['nodes'])
    ? raw['nodes'].map(parseNode).filter((n): n is CanvasNode => n !== null)
    : []
  const known = new Set(nodes.map((n) => n.id))
  const edges = Array.isArray(raw['edges'])
    ? raw['edges'].map((e) => parseEdge(e, known)).filter((e): e is CanvasEdge => e !== null)
    : []
  return { nodes, edges }
}

/** Indented and newline-terminated, so `.canvas` files diff cleanly in git. */
export function serializeCanvas(canvas: JsonCanvas): string {
  return `${JSON.stringify(canvas, null, 2)}\n`
}

export interface CanvasBounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/** The box containing every node — what "fit to screen" zooms to. */
export function canvasBounds(nodes: readonly CanvasNode[]): CanvasBounds {
  if (nodes.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 }
  return nodes.reduce<CanvasBounds>(
    (box, node) => ({
      minX: Math.min(box.minX, node.x),
      minY: Math.min(box.minY, node.y),
      maxX: Math.max(box.maxX, node.x + node.width),
      maxY: Math.max(box.maxY, node.y + node.height)
    }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
  )
}

/** Topmost node under a point — later nodes draw over earlier ones. */
export function nodeAt(nodes: readonly CanvasNode[], x: number, y: number): CanvasNode | null {
  for (let i = nodes.length - 1; i >= 0; i--) {
    const node = nodes[i]!
    if (x >= node.x && x <= node.x + node.width && y >= node.y && y <= node.y + node.height) {
      return node
    }
  }
  return null
}

/** Vault-relative path, as JSON Canvas stores file references. */
function relativeTo(root: string, path: string): string {
  if (!root || !path.startsWith(root)) return path
  return path.slice(root.length).replace(/^[/\\]/, '')
}

/**
 * Build a board from notes already in the vault: a card per note, laid out on a
 * grid, wired with the links that exist between them. This is the canvas only
 * orrery can offer — the graph knows which notes belong together, so a board can
 * start from real structure instead of a blank page.
 *
 * Placement is by index, so seeding the same notes twice gives the same board.
 */
export function seedCanvasFromNotes(graph: LinkGraph, ids: readonly string[], root = ''): JsonCanvas {
  const wanted = ids.filter((id) => graph.nodes.some((n) => n.id === id))
  const columns = Math.max(1, Math.ceil(Math.sqrt(wanted.length)))
  const idOf = new Map<string, string>()

  const nodes: CanvasNode[] = wanted.map((path, index) => {
    const id = `n${index + 1}`
    idOf.set(path, id)
    return {
      id,
      type: 'file',
      file: relativeTo(root, path),
      x: (index % columns) * (DEFAULT_NODE_WIDTH + SEED_GAP),
      y: Math.floor(index / columns) * (DEFAULT_NODE_HEIGHT + SEED_GAP),
      width: DEFAULT_NODE_WIDTH,
      height: DEFAULT_NODE_HEIGHT
    }
  })

  const edges: CanvasEdge[] = []
  for (const edge of graph.edges) {
    const from = idOf.get(edge.from)
    const to = idOf.get(edge.to)
    // Links to notes left off the board would dangle.
    if (!from || !to || from === to) continue
    edges.push({ id: `e${edges.length + 1}`, fromNode: from, fromSide: 'right', toNode: to, toSide: 'left' })
  }

  return { nodes, edges }
}

export interface Point {
  x: number
  y: number
}

/** Where an edge meets a card: the midpoint of the named side. */
export function sideAnchor(node: CanvasNode, side: CanvasSide): Point {
  switch (side) {
    case 'top':
      return { x: node.x + node.width / 2, y: node.y }
    case 'bottom':
      return { x: node.x + node.width / 2, y: node.y + node.height }
    case 'left':
      return { x: node.x, y: node.y + node.height / 2 }
    case 'right':
      return { x: node.x + node.width, y: node.y + node.height / 2 }
  }
}

/**
 * The sides two cards should connect through when the file doesn't say: the
 * pair that faces the other card, so a link never loops around a box.
 */
export function chooseSides(from: CanvasNode, to: CanvasNode): { from: CanvasSide; to: CanvasSide } {
  const dx = to.x + to.width / 2 - (from.x + from.width / 2)
  const dy = to.y + to.height / 2 - (from.y + from.height / 2)
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? { from: 'right', to: 'left' } : { from: 'left', to: 'right' }
  }
  return dy >= 0 ? { from: 'bottom', to: 'top' } : { from: 'top', to: 'bottom' }
}

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

/** A drag can go up or left; turn two corners into a positive-sized box. */
export function normaliseBox(x1: number, y1: number, x2: number, y2: number): Box {
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1)
  }
}

const overlaps = (node: CanvasNode, box: Box): boolean =>
  node.x < box.x + box.width &&
  node.x + node.width > box.x &&
  node.y < box.y + box.height &&
  node.y + node.height > box.y

/** Marquee selection: touching a card is enough, no need to enclose it. */
export function nodesInBox(nodes: readonly CanvasNode[], box: Box): CanvasNode[] {
  return nodes.filter((node) => overlaps(node, box))
}

/**
 * The cards a group holds — fully inside it, so dragging a group moves what
 * visibly sits in it and nothing that merely brushes its edge. Groups never
 * contain other groups, which keeps a drag from cascading.
 */
export function nodesInGroup(nodes: readonly CanvasNode[], group: CanvasNode): CanvasNode[] {
  return nodes.filter(
    (node) =>
      node.id !== group.id &&
      node.type !== 'group' &&
      node.x >= group.x &&
      node.y >= group.y &&
      node.x + node.width <= group.x + group.width &&
      node.y + node.height <= group.y + group.height
  )
}
