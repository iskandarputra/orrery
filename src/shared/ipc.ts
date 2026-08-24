import type {
  BacklinkHit,
  CloseConfirmChoice,
  FileNode,
  FileReadResult,
  FileWriteResult,
  FsChangedPayload,
  GraphData
} from './types'
import type { Settings } from './settings'

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
  'fs:writeFile': {
    req: { path: string; content: string; expectedMtimeMs: number | null }
    res: FileWriteResult
  }
  'fs:readTree': { req: { path: string }; res: FileNode }
  'fs:createFile': { req: { dirPath: string; name: string }; res: FileNode }
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
  /** Wikilink graph of the whole vault. */
  'workspace:graph': { req: { rootPath: string }; res: GraphData }

  /** User plugin sources from <userData>/plugins/*.js. */
  'plugins:list': { req: void; res: { name: string; source: string }[] }

  /** Rebuild the vault embedding index for semantic AI retrieval. */
  'embeddings:reindex': { req: { rootPath: string }; res: { files: number; chunks: number } }
  'embeddings:search': {
    req: { rootPath: string; query: string; k: number }
    res: BacklinkHit[]
  }

  /** Chat completion via the configured AI provider (key stays in main). */
  'ai:chat': {
    req: { system: string; messages: { role: 'user' | 'assistant'; content: string }[] }
    res: string
  }

  /** Export the given markdown; resolves to the saved path or null on cancel. */
  'export:html': { req: { title: string; markdown: string }; res: string | null }
  'export:pdf': { req: { title: string; markdown: string }; res: string | null }
  'fs:watch': { req: { path: string }; res: { watchId: string } }
  'fs:unwatch': { req: { watchId: string }; res: void }

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
  /** Native menu item clicked; renderer command registry executes it. */
  'menu:command': { commandId: string }
  /** Main intercepted a close; renderer must run the unsaved-changes flow. */
  'window:closeRequested': void
  /** A file was opened via OS (double-click / open-with / CLI arg). */
  'app:openPath': { path: string }
}

/** Error shape thrown across the IPC boundary for expected failures. */
export interface IpcErrorPayload {
  code: 'ENOENT' | 'EACCES' | 'CONFLICT' | 'EEXIST' | 'UNKNOWN'
  message: string
}

/** The api surface exposed on `window.zymd` by the preload script. */
export interface ZymdApi {
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
