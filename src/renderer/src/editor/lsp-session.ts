import type { EditorView } from '@codemirror/view'
import type { DiagnosticsPayload } from '@shared/types'
import { serverForFile } from '@core/lsp-servers'
import { invoke } from '@/services/client'
import { viewForBuffer } from './active-view'
import { applyDiagnostics } from './lsp-diagnostics'

/**
 * The renderer's half of the language-server conversation.
 *
 * Diagnostics are pushed by the server whenever it has something to say, for
 * whatever file it pleases — including one in a background tab. They are held
 * by path and drawn when that file has a view, rather than applied to whatever
 * happens to be on screen when they land.
 */
const latest = new Map<string, DiagnosticsPayload['diagnostics']>()
/** Which buffer id is showing which path, so a payload can find its view. */
const openPaths = new Map<string, string>()

export function routeDiagnostics(payload: DiagnosticsPayload): void {
  latest.set(payload.path, payload.diagnostics)
  for (const [bufferId, path] of openPaths) {
    if (path !== payload.path) continue
    const view = viewForBuffer(bufferId)
    if (view) applyDiagnostics(view, payload.diagnostics)
  }
}

/** Draw whatever the server has already said about this file. */
export function replayDiagnostics(bufferId: string, path: string, view: EditorView): void {
  openPaths.set(bufferId, path)
  const known = latest.get(path)
  if (known) applyDiagnostics(view, known)
}

/** Tell the server a file is open. No-op for a language with no server. */
export async function openDocument(path: string, text: string): Promise<void> {
  if (!serverForFile(path)) return
  try {
    await invoke('lsp:openDocument', { path, text })
  } catch {
    // A missing server is the normal case, not an error worth surfacing.
  }
}

export async function changeDocument(path: string, text: string): Promise<void> {
  if (!serverForFile(path)) return
  try {
    await invoke('lsp:changeDocument', { path, text })
  } catch {
    // As above.
  }
}

export function closeDocument(bufferId: string, path: string): void {
  openPaths.delete(bufferId)
  if (!serverForFile(path)) return
  void invoke('lsp:closeDocument', { path }).catch(() => {})
}
