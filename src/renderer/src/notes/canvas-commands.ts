import { seedCanvasFromNotes, serializeCanvas } from '@core/canvas'
import { buildMocSkeleton, mocPrompt } from '@core/moc'
import { appState } from '@/state/app-state-access'
import { invoke, parseIpcError } from '@/services/client'

/** Filesystem-safe note name. */
function safeName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '-').trim() || 'Canvas'
}

/** First free `<base>.<ext>`, `<base> 2.<ext>`, … in the vault root. */
export async function createInVault(
  base: string,
  ext: string,
  content: string
): Promise<string | null> {
  const { rootPath, showToast } = appState()
  if (!rootPath) {
    showToast('Open a folder first', 'warning')
    return null
  }
  for (let attempt = 1; attempt <= 20; attempt++) {
    const name = attempt === 1 ? `${base}.${ext}` : `${base} ${attempt}.${ext}`
    const path = `${rootPath}/${name}`
    try {
      const { created } = await invoke('fs:ensureFile', { path, content })
      if (created) return path
    } catch (err) {
      showToast(parseIpcError(err).message, 'error')
      return null
    }
  }
  showToast('Could not find a free file name', 'error')
  return null
}

/** A blank board. */
export async function newCanvas(): Promise<void> {
  const path = await createInVault('Canvas', 'canvas', serializeCanvas({ nodes: [], edges: [] }))
  if (!path) return
  const store = appState()
  void store.refreshTree()
  await store.openPaths([path])
}

/**
 * A board seeded from the open note's topic cluster: every note the link
 * analysis groups with it, already wired with the links between them. The graph
 * knows which notes belong together, so the board starts from real structure.
 */
export async function canvasFromCluster(): Promise<void> {
  const store = appState()
  const { rootPath, activeId, buffers, showToast } = store
  const activePath = activeId ? (buffers[activeId]?.filePath ?? null) : null
  if (!rootPath || !activePath) {
    showToast('Open a note first', 'warning')
    return
  }

  const analysis = await store.loadGraph()
  const note = analysis?.nodes.find((n) => n.id === activePath)
  if (!analysis || !note) {
    showToast('That note is not in the link graph yet — save it, then retry', 'warning')
    return
  }

  const cluster = analysis.nodes.filter((n) => n.exists && n.community === note.community)
  if (cluster.length < 2) {
    showToast('This note has no cluster to lay out yet — link it to a few others', 'info')
    return
  }

  const canvas = seedCanvasFromNotes(
    { nodes: analysis.nodes, edges: analysis.edges },
    cluster.map((n) => n.id),
    rootPath
  )
  const lead = [...cluster].sort((a, b) => b.pagerank - a.pagerank)[0]
  const path = await createInVault(
    safeName(`${lead?.label ?? 'Cluster'} map`),
    'canvas',
    serializeCanvas(canvas)
  )
  if (!path) return
  void store.refreshTree()
  await store.openPaths([path])
  showToast(`Laid out ${canvas.nodes.length} notes`, 'success')
}


/**
 * Write a Map of Content for the open note's cluster.
 *
 * The structure comes from the link analysis, so this works with no AI
 * configured at all; when a provider is set up, the model adds a framing
 * paragraph on top. A failed or missing model degrades to the skeleton rather
 * than to nothing.
 */
export async function clusterMoc(): Promise<void> {
  const store = appState()
  const { rootPath, activeId, buffers, settings, showToast } = store
  const activePath = activeId ? (buffers[activeId]?.filePath ?? null) : null
  if (!rootPath || !activePath) {
    showToast('Open a note first', 'warning')
    return
  }

  const analysis = await store.loadGraph()
  const note = analysis?.nodes.find((n) => n.id === activePath)
  if (!analysis || !note) {
    showToast('That note is not in the link graph yet — save it, then retry', 'warning')
    return
  }

  const cluster = analysis.nodes.filter((n) => n.exists && n.community === note.community)
  if (cluster.length < 2) {
    showToast('This note has no cluster yet — link it to a few others', 'info')
    return
  }

  const skeleton = buildMocSkeleton(cluster)
  let intro = ''
  if (settings.ai.provider !== 'none') {
    try {
      intro = (
        await invoke('ai:chat', {
          system: 'You write concise, concrete notes. No preamble, no filler.',
          messages: [{ role: 'user', content: mocPrompt(skeleton, cluster) }]
        })
      ).trim()
    } catch {
      showToast('Model unavailable — wrote the map without its summary', 'warning')
    }
  }

  const body = intro
    ? skeleton.markdown.replace(/\n\n/, `\n\n${intro}\n\n`)
    : skeleton.markdown
  const path = await createInVault(safeName(`${skeleton.title} MOC`), 'md', body)
  if (!path) return
  void store.refreshTree()
  await store.openPaths([path])
  showToast(`Mapped ${cluster.length} notes`, 'success')
}
