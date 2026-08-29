import type {
  BacklinkHit,
  DiagnosticsPayload,
  CloseConfirmChoice,
  FileNode,
  FileReadResult,
  FileWriteResult,
  FsChangedPayload,
  GraphAnalysis,
  LinkSuggestion
} from './types'
import type { Settings } from './settings'
import type { LineChange } from '@core/git-diff'
import type { GitStatus } from '@core/git-status'
import type { FileDiff } from '@core/unified-diff'
import type { Commit } from '@core/git-graph'

/**
 * Single source of truth for renderer -> main request/response channels.
 * Every channel takes exactly one `req` payload and resolves to `res`.
 * Main-process handlers and the preload bridge both type-check against this map.
 */
export interface IpcInvokeContract {
  'dialog:openFile': { req: void; res: string[] | null }
  'dialog:openFolder': { req: void; res: string | null }
  'dialog:saveAs': { req: { suggestedName?: string; defaultDir?: string }; res: string | null }
  'dialog:confirmClose': { req: { fileNames: string[] }; res: CloseConfirmChoice }

  'fs:readFile': { req: { path: string }; res: FileReadResult }

  /**
   * Changed lines for one file, against git HEAD, for the editor gutter.
   * Resolves to an empty list whenever git cannot answer — no repository,
   * no git installed, an untracked file — so callers need no error path.
   */
  'git:fileChanges': { req: { path: string }; res: LineChange[] }
  /** Whether the vault is inside a git work tree. */
  'git:isRepository': { req: { rootPath: string }; res: boolean }
  /** Working-tree status; empty when git cannot answer. */
  'git:status': { req: { rootPath: string }; res: GitStatus }
  'git:stage': { req: { rootPath: string; paths: string[] }; res: void }
  'git:unstage': { req: { rootPath: string; paths: string[] }; res: void }
  /** Destructive and unrecoverable; the caller confirms first. */
  'git:discard': {
    req: { rootPath: string; paths: string[]; untracked: string[] }
    res: void
  }
  /** Null when git refused — nothing staged, no identity, a hook. */
  'git:commit': { req: { rootPath: string; message: string }; res: string | null }
  /** Recent commits across all branches, newest first, for the graph. */
  'git:log': { req: { rootPath: string; limit: number }; res: Commit[] }
  /** Absolute path for a repo-relative one, so the editor can open it. */
  'git:absolutePath': { req: { rootPath: string; path: string }; res: string }
  /** One file's diff; `staged` picks index-vs-HEAD over worktree-vs-index. */
  'git:fileDiff': {
    req: { rootPath: string; path: string; staged: boolean }
    res: FileDiff
  }

  /**
   * Language-server document sync. Every call is best-effort: a language
   * with no server installed resolves normally and simply produces no
   * diagnostics, so callers need no capability check.
   */
  'lsp:openDocument': { req: { path: string; text: string }; res: void }
  'lsp:changeDocument': { req: { path: string; text: string }; res: void }
  'lsp:closeDocument': { req: { path: string }; res: void }
  /** Which known servers are present on this machine, by languageId. */
  'lsp:installed': { req: void; res: Record<string, boolean> }
  /** Documentation for the symbol at a position; null when nothing is known. */
  'lsp:hover': {
    req: { path: string; line: number; character: number }
    res: string | null
  }
  /** Completions at a position; empty when the server has nothing. */
  'lsp:complete': {
    req: { path: string; line: number; character: number }
    res: { label: string; detail?: string; kind?: number }[]
  }
  /** Where a symbol is defined; null when the server cannot say. */
  'lsp:definition': {
    req: { path: string; line: number; character: number }
    res: { path: string; line: number; character: number } | null
  }
  'fs:writeFile': {
    req: { path: string; content: string; expectedMtimeMs: number | null }
    res: FileWriteResult
  }
  'fs:readTree': { req: { path: string }; res: FileNode }
  'fs:createFile': { req: { dirPath: string; name: string }; res: FileNode }
  /**
   * Create a note (and any missing parent folders) only if it isn't there yet.
   * Idempotent, so "open today's note" is one call whether or not it exists.
   */
  /**
   * Write binary content (a pasted or dropped image) into the vault, creating
   * folders as needed and never overwriting: the returned path may be a
   * de-duplicated variant of the requested name.
   */
  'fs:writeAsset': {
    req: { dirPath: string; name: string; base64: string }
    res: { path: string }
  }
  'fs:ensureFile': {
    req: { path: string; content: string }
    res: { path: string; created: boolean }
  }
  'fs:createDirectory': { req: { dirPath: string; name: string }; res: FileNode }
  'fs:rename': { req: { path: string; newName: string }; res: string }
  'fs:trash': { req: { path: string }; res: void }
  'shell:showItemInFolder': { req: { path: string }; res: void }
  /** Scan workspace markdown files for [[wikilinks]] pointing at a note. */
  'workspace:scanLinks': {
    req: { rootPath: string; targetStem: string }
    res: BacklinkHit[]
  }
  /** Full-text search across workspace markdown files. */
  'workspace:search': {
    req: { rootPath: string; query: string; regex: boolean; caseSensitive: boolean }
    res: BacklinkHit[]
  }
  /** Wikilink graph of the whole vault, with its structural analysis. */
  'workspace:graph': { req: { rootPath: string }; res: GraphAnalysis }

  /** User plugin sources from <userData>/plugins/*.js. */
  'plugins:list': { req: void; res: { name: string; source: string }[] }

  /** Rebuild the vault embedding index for semantic AI retrieval. */
  'embeddings:reindex': {
    req: { rootPath: string }
    /** `embedded` / `reused` report what the incremental pass actually did. */
    res: { files: number; chunks: number; embedded: number; reused: number }
  }
  'embeddings:search': {
    req: { rootPath: string; query: string; k: number }
    res: BacklinkHit[]
  }
  /** Notes semantically close to this one that it doesn't link to yet. */
  'embeddings:suggestLinks': {
    req: { rootPath: string; path: string; limit: number }
    res: LinkSuggestion[]
  }

  /** Chat completion via the configured AI provider (key stays in main). */
  'ai:chat': {
    req: { system: string; messages: { role: 'user' | 'assistant'; content: string }[] }
    res: string
  }

  /** Export the given markdown; resolves to the saved path or null on cancel. */
  'export:html': { req: { title: string; markdown: string }; res: string | null }
  'export:pdf': { req: { title: string; markdown: string }; res: string | null }
  /** Print the rendered note; resolves false if the user cancelled. */
  'export:print': { req: { title: string; markdown: string }; res: boolean }
  /** Swap a misspelled word for a suggestion, through Electron's checker. */
  'editor:replaceMisspelling': { req: { word: string }; res: void }
  'fs:watch': { req: { path: string }; res: { watchId: string } }
  'fs:unwatch': { req: { watchId: string }; res: void }

  /** Versions of a note, newest first. */
  'history:list': { req: { path: string }; res: { id: string; at: number; bytes: number }[] }
  /** The content of one version. */
  'history:read': { req: { path: string; id: string }; res: string }

  'settings:get': { req: void; res: Settings }
  'settings:set': { req: Partial<Settings>; res: Settings }

  'app:getRecentFiles': { req: void; res: string[] }
  'app:addRecentFile': { req: { path: string }; res: void }

  /** Renderer signals the unsaved-changes flow is resolved; main may destroy the window. */
  'window:readyToClose': { req: void; res: void }
  'window:setTitle': { req: { title: string }; res: void }
}

/** Main -> renderer push events. */
export interface IpcEventContract {
  'fs:changed': FsChangedPayload
  /** A language server published diagnostics for a file. */
  'lsp:diagnostics': DiagnosticsPayload
  /** Native menu item clicked; renderer command registry executes it. */
  'menu:command': { commandId: string }
  /** Main intercepted a close; renderer must run the unsaved-changes flow. */
  'window:closeRequested': void
  /** A file was opened via OS (double-click / open-with / CLI arg). */
  'app:openPath': { path: string }
  /**
   * Right-click inside the window. Forwarded from main because only there do
   * the spelling suggestions exist; the renderer draws its own themed menu so
   * it matches the tab and file-tree menus.
   */
  'editor:contextMenu': EditorContextRequest
}

export interface EditorContextRequest {
  x: number
  y: number
  selectionText: string
  isEditable: boolean
  /** The word under the cursor, if the checker flagged it. */
  misspelledWord: string
  dictionarySuggestions: string[]
}

/** Error shape thrown across the IPC boundary for expected failures. */
export interface IpcErrorPayload {
  code: 'ENOENT' | 'EACCES' | 'CONFLICT' | 'EEXIST' | 'UNKNOWN'
  message: string
}

/** The api surface exposed on `window.orrery` by the preload script. */
export interface OrreryApi {
  invoke<K extends keyof IpcInvokeContract>(
    channel: K,
    req: IpcInvokeContract[K]['req']
  ): Promise<IpcInvokeContract[K]['res']>
  /** Subscribe to a main-process event. Returns an unsubscribe function. */
  on<K extends keyof IpcEventContract>(
    channel: K,
    listener: (payload: IpcEventContract[K]) => void
  ): () => void
}
