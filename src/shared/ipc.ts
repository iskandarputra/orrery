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
import type {
  AiToolStep,
  DbQueryResult,
  DbTableInfo,
  McpAskRequest,
  McpHostStatus,
  McpAuditEntry,
  McpServerStatus,
  McpToolResult
} from './types'
import type { Settings } from './settings'
import type { LineChange } from '@core/git-diff'
import type { GitStatus } from '@core/git-status'
import type { DiffStats } from '@core/git-numstat'
import type { CommitDetail } from '@core/commit-detail'
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

  /**
   * Which of these paths git is told to ignore.
   *
   * Asked per directory listing rather than for the whole tree: the tree is
   * lazy, so the question is only ever about the handful of entries somebody
   * just opened. Resolves to nothing when git cannot answer, which shows the
   * files rather than hiding them — a tree that omits entries because git is
   * missing would be lying about the folder.
   */
  'git:ignored': { req: { rootPath: string; paths: string[] }; res: string[] }

  /**
   * How much each changed file changed, for the counts beside the names.
   *
   * `untracked` is passed in rather than re-derived: the panel has just read
   * the status that says which files are new, and git cannot answer for them.
   */
  'git:diffStats': {
    req: { rootPath: string; untracked: string[] }
    res: DiffStats
  }
  'git:stage': { req: { rootPath: string; paths: string[] }; res: void }
  'git:unstage': { req: { rootPath: string; paths: string[] }; res: void }
  /** Destructive and unrecoverable; the caller confirms first. */
  'git:discard': {
    req: { rootPath: string; paths: string[]; untracked: string[] }
    res: void
  }
  /** Null when git refused — nothing staged, no identity, a hook. */
  'git:commit': { req: { rootPath: string; message: string }; res: string | null }
  /** Whether a pseudo-terminal can be started at all (node-pty is optional). */
  'terminal:available': { req: void; res: boolean }
  /** Start a shell; null when the terminal is unavailable. */
  'terminal:create': {
    req: { cwd: string; cols: number; rows: number }
    res: string | null
  }
  'terminal:write': { req: { id: string; data: string }; res: void }
  'terminal:resize': { req: { id: string; cols: number; rows: number }; res: void }
  'terminal:kill': { req: { id: string }; res: void }
  /** Recent commits across all branches, newest first, for the graph. */
  'git:log': { req: { rootPath: string; limit: number }; res: Commit[] }
  /** Absolute path for a repo-relative one, so the editor can open it. */
  'git:absolutePath': { req: { rootPath: string; path: string }; res: string }
  /**
   * Both sides of a diff in full, for the side-by-side editor. A hunk alone
   * cannot render the unchanged stretches between changes.
   */
  'git:fileContents': {
    req: { rootPath: string; path: string; staged: boolean; commit?: string }
    res: { old: string; new: string }
  }
  /** One file's diff; `staged` picks index-vs-HEAD over worktree-vs-index. */
  'git:fileDiff': {
    req: { rootPath: string; path: string; staged: boolean; commit?: string }
    res: FileDiff
  }
  /** The body of a commit's message and the files it touched. */
  'git:commitDetail': { req: { rootPath: string; hash: string }; res: CommitDetail }
  /** Move the working tree to a commit or branch. Rejects on dirty state. */
  'git:checkout': { req: { rootPath: string; ref: string }; res: void }
  /** A new branch at a commit, switched to. */
  'git:createBranch': { req: { rootPath: string; name: string; at: string }; res: void }
  /** A new commit that undoes an old one. */
  'git:revert': { req: { rootPath: string; hash: string }; res: void }
  /** Apply one commit's changes on top of the current branch. */
  'git:cherryPick': { req: { rootPath: string; hash: string }; res: void }

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
  'fs:readTree': { req: { path: string; showHidden?: boolean }; res: FileNode }
  /**
   * One directory's entries, fetched when it is opened in the tree.
   *
   * The tree is read a directory at a time: reading a whole vault before the
   * window can show anything costs seconds and tens of megabytes on a folder
   * that is somebody's entire Documents.
   */
  'fs:readDir': { req: { path: string; showHidden?: boolean }; res: FileNode[] }
  /**
   * When a file was last written, and how big it is.
   *
   * For a surface that reads its file itself: without it there is nothing to
   * compare against on save, and the first write would overwrite a document
   * that had changed on disk since it was opened.
   */
  'fs:stat': { req: { path: string }; res: { mtimeMs: number; size: number } }
  /**
   * Every file in the vault as a flat list, for opening by name and resolving
   * links. Bounded — `truncated` says the vault was larger than the limit.
   */
  'fs:listFiles': {
    req: { path: string; limit: number }
    res: { paths: string[]; truncated: boolean }
  }
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
  /**
   * Full-text search across every text file in the vault.
   *
   * `include` and `exclude` are comma-separated globs over vault-relative
   * paths; empty means "everything" and "nothing" respectively.
   */
  'workspace:search': {
    req: {
      rootPath: string
      query: string
      regex: boolean
      caseSensitive: boolean
      wholeWord: boolean
      include: string
      exclude: string
    }
    res: BacklinkHit[]
  }
  /**
   * The vault's graph, with its structural analysis.
   *
   * `withCode` widens it from wikilinks between notes to imports between
   * source files as well, which is a different walk rather than a filter.
   */
  'workspace:graph': { req: { rootPath: string; withCode?: boolean }; res: GraphAnalysis }

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

  /**
   * Model Context Protocol.
   *
   * Connecting is explicit rather than implicit in every call: a server takes a
   * second or two to start, and a panel that shows what is happening beats one
   * that appears to hang the first time a tool is used.
   */
  'mcp:status': { req: void; res: McpServerStatus[] }
  'mcp:connect': { req: { id: string }; res: McpServerStatus }
  'mcp:disconnect': { req: { id: string }; res: void }
  /** Re-read a server's tools, resources and prompts. */
  'mcp:refresh': { req: { id: string }; res: McpServerStatus }
  /**
   * Run a tool. Asks the user first unless the answer is remembered, so this
   * can take as long as someone takes to read a dialog.
   */
  'mcp:callTool': {
    req: { id: string; tool: string; args: Record<string, unknown> }
    res: McpToolResult
  }
  'mcp:readResource': { req: { id: string; uri: string }; res: string }
  'mcp:getPrompt': {
    req: { id: string; name: string; args?: Record<string, string> }
    res: string
  }
  /** The renderer's answer to an `mcp:ask` event. */
  'mcp:answer': { req: { id: string; value: unknown }; res: void }
  /** Orrery's own server: is it listening, and where. */
  'mcp:hostStatus': { req: void; res: McpHostStatus }
  /** Start or stop it, following the setting. */
  'mcp:hostSync': { req: void; res: McpHostStatus }
  /** A new token; any client using the old one stops working. */
  'mcp:hostRegenerateToken': { req: void; res: McpHostStatus }

  /** Recent tool calls, newest first. */
  'mcp:audit': { req: { limit: number }; res: McpAuditEntry[] }

  /**
   * The same chat, with whatever MCP tools are connected offered to the model.
   *
   * Separate from `ai:chat` rather than a flag on it: this one can take as long
   * as several tool calls and a permission dialog, and the callers that want a
   * single completion should not have to think about that.
   */
  'ai:chatWithTools': {
    req: { system: string; messages: { role: 'user' | 'assistant'; content: string }[] }
    res: string
  }

  /**
   * SQLite files, read-only.
   *
   * The viewer never writes: the handle is opened read-only and the SQL is
   * checked before it gets there. `db:available` reports whether the runtime
   * has SQLite at all, so the surface can say so rather than look broken.
   */
  /**
   * What a PDF says, page by page, read once and cached.
   *
   * `emptyPages` are the ones with no text on them at all — a scan, waiting to
   * be recognised.
   */
  'pdf:text': { req: { path: string }; res: { pages: string[]; emptyPages: number[] } }
  /**
   * Every channel below that changes a document changes the *draft* of it, not
   * the file: the bytes are kept in main, the reader is served them in place of
   * what is on disk, and only `pdf:save` writes. That is what makes a PDF
   * behave like every other document in the app — a dot on the tab, Ctrl+S to
   * commit, close without saving to throw the changes away — and it is why
   * none of them carries `expectedMtimeMs` any more. There is one check against
   * the file changing underneath, and it happens at the save.
   *
   * They answer `{ version }`: a number that changes whenever the draft does,
   * for the reader to hang its reload off.
   */
  /**
   * Rearrange a document's pages: reorder, remove, rotate, merge.
   *
   * The plan comes from `core/pdf-pages.ts` and describes the whole result at
   * once, so any number of rearrangements is one change. `also` names further
   * documents whose pages the plan may draw on, numbered after the first one's.
   */
  'pdf:pages': {
    req: {
      path: string
      plan: { order: number[]; rotate: number[] }
      also?: string[]
    }
    res: { version: number }
  }
  /**
   * Write some of this document's pages out as a document of their own.
   *
   * The one page operation that is not a draft: it makes a new file rather than
   * changing this one, so there is nothing to defer and nothing to overwrite —
   * main picks a free name. The pages come from the draft, so what is extracted
   * is what you can see.
   */
  'pdf:extractPages': {
    req: { path: string; plan: { order: number[]; rotate: number[] }; saveAs: string }
    res: { path: string; mtimeMs: number }
  }
  /**
   * Everything drawn on a page: what it is, what it says, and where it sits.
   *
   * Page and object numbers are 0-based, as the engine counts them — a click on
   * a rendered page is only editable once it has become "object three on page
   * two", and these are those numbers.
   */
  'pdf:objects': {
    req: { path: string; page: number }
    res: {
      index: number
      kind: string
      bounds: { left: number; bottom: number; right: number; top: number }
      text: string
    }[]
  }
  /**
   * Retype a line, keeping its font, size and position.
   *
   * `indexes` because a line is rarely one object: most PDFs position every
   * character separately, so a line of twenty letters is twenty objects and
   * retyping it means replacing the run.
   */
  'pdf:editObject': {
    req: { path: string; page: number; indexes: number[]; text: string }
    res: { version: number }
  }
  /**
   * Take objects off a page and out of the file — the difference between
   * redaction and drawing a black rectangle over something.
   */
  'pdf:removeObjects': {
    req: { path: string; page: number; indexes: number[] }
    res: { version: number }
  }
  /**
   * Step a document back, or forward again, through the changes made to it.
   *
   * A PDF's undo cannot be a stack of edits in memory: the engine rewrites the
   * whole document for every change, so what is kept is what the bytes were.
   * It steps the draft and writes nothing — undoing an unsaved change leaves
   * the file alone, and undoing past the last save makes the tab dirty again.
   * `null` means there was nothing to step to.
   */
  'pdf:undo': {
    req: { path: string; direction: 'undo' | 'redo' }
    res: { version: number; undo: boolean; redo: boolean } | null
  }
  /**
   * Where this document stands: what can be stepped through, and whether it
   * says something the file does not.
   *
   * `drafted` is asked on open as well as after every change, because a second
   * pane onto a document that is already being edited is shown the draft — and
   * a tab showing unsaved work has to know that is what it is showing.
   */
  'pdf:canUndo': {
    req: { path: string }
    res: { undo: boolean; redo: boolean; drafted: boolean }
  }
  /** Move an object on a page, in PDF units. Nothing else about it changes. */
  'pdf:moveObject': {
    req: { path: string; page: number; index: number; dx: number; dy: number }
    res: { version: number }
  }
  /** Put new text on a page, in a font every reader has. */
  'pdf:addText': {
    req: { path: string; page: number; text: string; x: number; y: number; size: number }
    res: { version: number }
  }
  /** Scale an object about its own corner, so it grows in place. */
  'pdf:resizeObject': {
    req: { path: string; page: number; index: number; sx: number; sy: number }
    res: { version: number }
  }
  /** Turn one object about its own middle, by however many degrees. */
  'pdf:rotateObject': {
    req: { path: string; page: number; index: number; degrees: number }
    res: { version: number }
  }
  /** How many pages another document has, for planning a merge. */
  'pdf:pageCount': { req: { path: string }; res: number }
  /** Choose a PDF from disk — the other half of merging one in. */
  'dialog:pickPdf': { req: void; res: string | null }
  /** Choose a picture from disk, to put on a page. */
  'dialog:pickImage': { req: void; res: string | null }
  /**
   * Draw a picture onto a page, at a place and size given in PDF units.
   *
   * The image is read and decoded in main — the renderer never sees its bytes —
   * and becomes a page object, so every reader draws it and the same undo takes
   * it away.
   */
  'pdf:addImage': {
    req: {
      path: string
      page: number
      image: string
      x: number
      y: number
      width: number
      height: number
    }
    res: { version: number }
  }
  /**
   * Write this document to disk — the only channel that does.
   *
   * `bytes` when the reader has something the draft does not: annotations and
   * form values live in pdf.js's storage and only it can serialise them, so it
   * hands over the whole document. The bytes rather than a base64 string: a
   * scanned document runs to tens of megabytes and encoding it would cost a
   * third again in memory on both sides for no benefit — Electron's own
   * serialisation carries a `Uint8Array`. `null` when there is nothing to add
   * and the draft is already the answer, which saves sending a document across
   * the boundary to be written back unchanged.
   *
   * `expectedMtimeMs` is the same optimistic check every other save uses, so a
   * document that changed on disk while it was open refuses rather than
   * overwriting.
   */
  'pdf:save': {
    req: { path: string; bytes: Uint8Array | null; expectedMtimeMs: number | null }
    res: { path: string; mtimeMs: number }
  }
  /**
   * Fold what the reader is holding into the draft, without writing anything.
   *
   * An annotation lives in pdf.js's storage until it is saved, and an edit to
   * the page itself is carried out by an engine in main that reads the draft
   * and knows nothing about that storage. Without this, editing the page after
   * marking it up would rebuild the document from bytes the annotation was
   * never in, and the reload would take the annotation away — silently, with
   * the tab still claiming there was something to save.
   */
  'pdf:stage': { req: { path: string; bytes: Uint8Array }; res: { version: number } }
  /**
   * Throw away a document's draft and its history, when its tab has gone.
   *
   * Closing without saving is how you say no to changes you have made, and this
   * is what makes that mean something.
   */
  'pdf:discard': { req: { path: string }; res: void }
  /**
   * Text recognised from pages that had none, merged into the same cache the
   * extractor fills so search asks one question and gets one answer.
   */
  'pdf:recognised': {
    req: { path: string; pages: { page: number; text: string }[] }
    res: { pages: string[]; emptyPages: number[] }
  }
  /**
   * Notes that have been written but never given a file.
   *
   * Kept so that quitting with a new note open is not a decision about it: the
   * note comes back with the app, and the question is asked when you close the
   * note rather than when you close the application. Untitled notes only —
   * anything with a file already has somewhere to be.
   */
  'drafts:list': { req: void; res: { id: string; n: number; content: string }[] }
  'drafts:put': { req: { id: string; n: number; content: string }; res: void }
  'drafts:forget': { req: { id: string }; res: void }
  'db:available': { req: void; res: boolean }
  'db:tables': { req: { path: string }; res: DbTableInfo[] }
  'db:rows': {
    req: {
      path: string
      table: string
      limit?: number
      offset?: number
      orderBy?: string
      descending?: boolean
    }
    res: DbQueryResult
  }
  'db:query': { req: { path: string; sql: string }; res: DbQueryResult }
  'db:close': { req: { path: string }; res: void }

  /** Export the given markdown; resolves to the saved path or null on cancel. */
  'export:html': { req: { title: string; markdown: string }; res: string | null }
  'export:pdf': { req: { title: string; markdown: string }; res: string | null }
  /** Print the rendered note; resolves false if the user cancelled. */
  'export:print': { req: { title: string; markdown: string }; res: boolean }
  /** Swap a misspelled word for a suggestion, through Electron's checker. */
  'editor:replaceMisspelling': { req: { word: string }; res: void }
  'fs:watch': { req: { path: string }; res: { watchId: string } }
  'fs:unwatch': { req: { watchId: string }; res: void }
  /**
   * The directories worth watching: the vault root and whichever are open.
   *
   * A recursive watch over a large folder is tens of thousands of file handles
   * and a scan of every file in it, for events about directories nobody is
   * looking at.
   */
  'fs:watchPaths': { req: { watchId: string; paths: string[] }; res: void }

  /** Versions of a note, newest first. */
  'history:list': { req: { path: string }; res: { id: string; at: number; bytes: number }[] }
  /** The content of one version. */
  'history:read': { req: { path: string; id: string }; res: string }

  'settings:get': { req: void; res: Settings }
  'settings:set': { req: Partial<Settings>; res: Settings }

  'app:getRecentFiles': { req: void; res: string[] }
  'app:getRecentFolders': { req: void; res: string[] }
  'app:addRecentFile': { req: { path: string }; res: void }
  /** Forget everything recently opened, files and folders alike. */
  'app:clearRecent': { req: void; res: void }

  /** Renderer signals the unsaved-changes flow is resolved; main may destroy the window. */
  'window:readyToClose': { req: void; res: void }
  'window:setTitle': { req: { title: string }; res: void }
  /**
   * Interface zoom. `by` steps from where it is, `level` sets it outright.
   * Resolves to the level that ended up being applied.
   */
  'window:setZoom': { req: { by?: number; level?: number }; res: number }
}

/** Main -> renderer push events. */
export interface IpcEventContract {
  'fs:changed': FsChangedPayload
  /** Output from a shell, as it arrives. */
  'terminal:data': { id: string; data: string }
  /** A shell exited; the panel closes that session. */
  'terminal:exit': { id: string; exitCode: number }
  /** A language server published diagnostics for a file. */
  'lsp:diagnostics': DiagnosticsPayload
  /** Native menu item clicked; renderer command registry executes it. */
  'menu:command': { commandId: string }
  /** The assistant called a tool, or got an answer back. */
  'ai:toolStep': AiToolStep
  /** A server connected, dropped, or changed what it offers. */
  'mcp:serverChanged': McpServerStatus
  /** Something ran; the panel's log is stale. */
  'mcp:activity': void
  /**
   * Main needs an answer before it can go on: may this tool run, fill in this
   * form, may this server borrow the model. The renderer replies on
   * `mcp:answer`, and silence is a refusal.
   */
  'mcp:ask': McpAskRequest

  /** Main intercepted a close; renderer must run the unsaved-changes flow. */
  'window:closeRequested': void
  /** A file was opened via OS (double-click / open-with / CLI arg). */
  'app:openPath': { path: string }
  /** Open this folder as the vault — the File menu's recent list. */
  'app:openFolder': { path: string }
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
