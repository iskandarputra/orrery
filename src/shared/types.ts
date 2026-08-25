/** A node in the workspace file tree. Directories carry children lazily. */
export interface FileNode {
  name: string
  path: string
  kind: 'file' | 'directory'
  children?: FileNode[]
}

/** Result of reading a file from disk. */
export interface FileReadResult {
  path: string
  content: string
  /** mtime in ms — used to detect external modification before overwriting. */
  mtimeMs: number
}

export interface FileWriteResult {
  path: string
  mtimeMs: number
}

export type FsEventKind = 'created' | 'changed' | 'removed'

export interface FsEvent {
  kind: FsEventKind
  path: string
  isDirectory: boolean
}

export interface FsChangedPayload {
  watchId: string
  events: FsEvent[]
}

/** Buttons of the unsaved-changes prompt. */
export type CloseConfirmChoice = 'save' | 'discard' | 'cancel'

export interface GraphNode {
  /** File path for real notes, `ghost:<stem>` for linked-but-missing notes. */
  id: string
  label: string
  exists: boolean
  /** Total link degree (in + out) — drives node size. */
  degree: number
  /** Folder holding the note, relative to the vault root ('' at the root). */
  folder: string
  /** Word count of the note body (0 for ghosts). */
  words: number
  /** Last-modified time, epoch ms (0 for ghosts). */
  mtimeMs: number
}

export interface GraphEdge {
  from: string
  to: string
}

/** The raw link graph, before analysis. */
export interface LinkGraph {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

/** Per-note structural measures, all computed from the link graph alone. */
export interface NodeMetrics {
  /** Notes linking here. */
  inDegree: number
  /** Notes this one links out to. */
  outDegree: number
  /** Influence: share of a random surfer's time. Sums to 1 across the vault. */
  pagerank: number
  /** Bridge score: how often this note lies on shortest paths between others. */
  betweenness: number
  /** Index of the disconnected island this note belongs to. */
  component: number
  /** Index of the topic cluster found by label propagation. */
  community: number
}

export interface AnalyzedGraphNode extends GraphNode, NodeMetrics {}

/** A note referenced by [[wikilink]] that has no file behind it. */
export interface BrokenLink {
  /** Ghost node id. */
  id: string
  label: string
  /** Paths of the notes pointing at it. */
  from: string[]
}

export interface RankedNote {
  id: string
  label: string
  score: number
}

export interface VaultStats {
  /** Notes that exist on disk. */
  notes: number
  /** Linked-but-missing targets. */
  ghosts: number
  links: number
  words: number
  avgOutDegree: number
  medianOutDegree: number
  /** Disconnected islands (ghosts included). */
  components: number
  /** Share of nodes in the biggest island, 0–1. */
  largestComponentShare: number
  /** Notes per out-link count: index = number of links, value = note count. */
  linkHistogram: number[]
  /** Notes touched within the last 7 / 30 / 90 days. */
  modified: { last7: number; last30: number; last90: number }
}

export interface GraphInsights {
  /** Real notes with no links in or out. */
  orphans: RankedNote[]
  /** Real notes linked from elsewhere that link nowhere themselves. */
  deadEnds: RankedNote[]
  brokenLinks: BrokenLink[]
  /** Most influential notes, by PageRank. */
  hubs: RankedNote[]
  /** Notes bridging otherwise separate parts of the vault, by betweenness. */
  connectors: RankedNote[]
}

/** A link the vault is missing: a note about the same thing, not linked yet. */
export interface LinkSuggestion {
  id: string
  label: string
  /** Cosine similarity of the two notes, 0–1. */
  similarity: number
  /** Shortest existing path between them, or null if they're on separate islands. */
  hops: number | null
}

/** The analysed graph — what `workspace:graph` returns and every surface reads. */
export interface GraphAnalysis {
  nodes: AnalyzedGraphNode[]
  edges: GraphEdge[]
  stats: VaultStats
  insights: GraphInsights
}

/** One [[wikilink]] occurrence found while scanning the workspace. */
export interface BacklinkHit {
  path: string
  line: number
  snippet: string
}
