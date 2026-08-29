import { formatDate, renderTemplate } from '@core/template'
import { stem } from '@core/paths'
import { getActiveView } from '@/editor/active-view'
import { appState } from '@/state/app-state-access'
import { invoke, parseIpcError } from '@/services/client'

/**
 * Vault-relative segments joined for IPC. Forward slashes are accepted by the
 * Node path APIs on every platform, and main normalises before touching disk.
 */
function vaultPath(root: string, ...segments: string[]): string {
  return [root, ...segments.filter((s) => s.trim() !== '')].join('/').replace(/\/+/g, '/')
}

/** Read a vault-relative template file; empty string if it isn't there. */
async function readTemplate(root: string, relativePath: string): Promise<string> {
  if (!relativePath.trim()) return ''
  const target = vaultPath(root, relativePath.endsWith('.md') ? relativePath : `${relativePath}.md`)
  try {
    const file = await invoke('fs:readFile', { path: target })
    return file.content
  } catch {
    return '' // a missing template shouldn't block the note
  }
}

/**
 * Open today's dated note, creating it (and its folder) from the configured
 * template the first time. Idempotent: opening it again never overwrites what
 * you wrote.
 */
export async function openDailyNote(date = new Date()): Promise<void> {
  const { rootPath, settings, openPaths, showToast, refreshTree } = appState()
  if (!rootPath) {
    showToast('Open a folder first', 'warning')
    return
  }

  const { folder, format, template } = settings.dailyNotes
  const name = `${formatDate(date, format || 'YYYY-MM-DD')}.md`
  const target = vaultPath(rootPath, folder, name)

  const source = await readTemplate(rootPath, template)
  const rendered = renderTemplate(source || `# ${stem(name)}\n\n`, {
    now: date,
    title: stem(name),
    dateFormat: format || 'YYYY-MM-DD'
  })

  try {
    const { created } = await invoke('fs:ensureFile', { path: target, content: rendered.text })
    await openPaths([target])
    if (created) {
      void refreshTree()
      placeCursor(rendered.cursor)
    }
  } catch (err) {
    showToast(parseIpcError(err).message, 'error')
  }
}

/** Render a template file and drop it in at the cursor. */
export async function insertTemplate(templatePath: string): Promise<void> {
  const { rootPath, settings, showToast } = appState()
  const view = getActiveView()
  if (!rootPath || !view) return

  let source: string
  try {
    source = (await invoke('fs:readFile', { path: templatePath })).content
  } catch (err) {
    showToast(parseIpcError(err).message, 'error')
    return
  }

  const active = appState().activeId
  const title = active ? stem(appState().buffers[active]?.fileName ?? '') : ''
  const rendered = renderTemplate(source, {
    now: new Date(),
    title,
    dateFormat: settings.dailyNotes.format || 'YYYY-MM-DD'
  })

  const { from, to } = view.state.selection.main
  view.dispatch({
    changes: { from, to, insert: rendered.text },
    selection: { anchor: from + (rendered.cursor ?? rendered.text.length) }
  })
  view.focus()
}

/** Move the caret to a template's `{{cursor}}` marker once the note is open. */
function placeCursor(offset: number | null): void {
  if (offset === null) return
  // The buffer mounts a tick after openPaths resolves.
  setTimeout(() => {
    const view = getActiveView()
    if (!view) return
    const anchor = Math.min(offset, view.state.doc.length)
    view.dispatch({ selection: { anchor }, scrollIntoView: true })
    view.focus()
  }, 50)
}
