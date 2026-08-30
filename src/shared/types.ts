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
  /**
   * A note, or a source file.
   *
   * The vault is a folder, and a folder with code in it has two kinds of thing
   * that link to each other in two different ways. Drawing both and saying
   * which is which beats drawing half of it.
   */
  kind: 'note' | 'code'
  /** Total link degree (in + out) — drives node size. */
  degree: number
  /** Folder holding the note, relative to the vault root ('' at the root). */
  folder: string
  /** Word count of the note body (0 for ghosts). */
  words: number
  /** Last-modified time, epoch ms (0 for ghosts). */
  mtimeMs: number
  /** `#tags` found in the note, in order of first appearance. */
  tags: string[]
}

export interface GraphEdge {
  from: string
  to: string
  /** `link` is a wikilink between notes; `import` is one file requiring another. */
  kind: 'link' | 'import'
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

/** One diagnostic from a language server, flattened to what the editor draws. */
export interface LspDiagnostic {
  /** 0-based, as the protocol gives them. */
  startLine: number
  startChar: number
  endLine: number
  endChar: number
  severity: 'error' | 'warning' | 'info' | 'hint'
  message: string
  source?: string
}

export interface DiagnosticsPayload {
  path: string
  diagnostics: LspDiagnostic[]
}

/** One tool as an MCP server describes it. Mirrors `core/mcp-tools`. */
export interface McpToolInfo {
  name: string
  title?: string
  description?: string
  inputSchema?: Record<string, unknown>
  annotations?: {
    title?: string
    readOnlyHint?: boolean
    destructiveHint?: boolean
    idempotentHint?: boolean
    openWorldHint?: boolean
  }
}

export interface McpResourceInfo {
  uri: string
  name?: string
  title?: string
  description?: string
  mimeType?: string
}

export interface McpPromptInfo {
  name: string
  title?: string
  description?: string
  arguments?: { name: string; description?: string; required?: boolean }[]
}

/** What a server is doing, as the panel shows it. */
export interface McpServerStatus {
  id: string
  name: string
  enabled: boolean
  state: 'idle' | 'connecting' | 'ready' | 'failed'
  /** Empty unless `state` is `failed`. */
  error: string
  tools: McpToolInfo[]
  resources: McpResourceInfo[]
  prompts: McpPromptInfo[]
}

export interface McpToolResult {
  text: string
  /** The server reported a failure, or the call could not be made. */
  isError: boolean
  /** The user refused. Distinct from an error: nothing went wrong. */
  denied: boolean
}

/** A question main needs the person at the keyboard to answer. */
export interface McpAskRequest {
  id: string
  kind: 'tool' | 'elicitation' | 'sampling'
  payload: unknown
}

/** One tool call, as the log records it and the panel shows it. */
export interface McpAuditEntry {
  at: number
  serverId: string
  serverName: string
  tool: string
  /** What the model or the user asked for, as given to the server. */
  args: unknown
  decision: 'allow' | 'ask' | 'deny'
  /** How it went. `denied` means the user said no; `error` means it failed. */
  outcome: 'ok' | 'error' | 'denied'
  ms: number
  /** First lines of the result or the error, for a list that has to fit. */
  summary: string
}

/** One thing that happened while the assistant was answering with tools. */
export interface AiToolStep {
  kind: 'call' | 'result'
  name: string
  args?: unknown
  text?: string
  isError?: boolean
}

/** Orrery's own MCP server, as the settings pane shows it. */
export interface McpHostStatus {
  running: boolean
  /** Where a client should point. Empty when nothing is listening. */
  url: string
  token: string
  allowWrites: boolean
}

/** One column of a table in a SQLite file. */
export interface DbColumnInfo {
  name: string
  type: string
  primaryKey: boolean
  notNull: boolean
}

export interface DbTableInfo {
  name: string
  kind: 'table' | 'view'
  /** The `CREATE` statement, as SQLite stored it. */
  sql: string
  columns: DbColumnInfo[]
  /** -1 when it could not be counted. */
  rowCount: number
}

/** Rows as text: a grid draws strings, and JSON cannot carry a blob. */
export interface DbQueryResult {
  columns: string[]
  rows: string[][]
  /** Empty when the query ran. */
  error: string
  /** More rows existed than the viewer will show. */
  truncated: boolean
}
