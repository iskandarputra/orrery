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
  /** Link degree — drives node size. */
  degree: number
}

export interface GraphEdge {
  from: string
  to: string
}

export interface GraphData {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

/** One [[wikilink]] occurrence found while scanning the workspace. */
export interface BacklinkHit {
  path: string
  line: number
  snippet: string
}
