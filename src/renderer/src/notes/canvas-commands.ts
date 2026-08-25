import { seedCanvasFromNotes, serializeCanvas } from '@core/canvas'
import { invoke, parseIpcError } from '@/services/client'
import { useStore } from '@/state/store'

/** Filesystem-safe note name. */
function safeName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '-').trim() || 'Canvas'
}

/** First free `<base>.canvas`, `<base> 2.canvas`, … in the vault root. */
async function createCanvas(base: string, content: string): Promise<string | null> {
  const { rootPath, showToast } = useStore.getState()
  if (!rootPath) {
    showToast('Open a folder first', 'warning')
    return null
  }
  for (let attempt = 1; attempt <= 20; attempt++) {
    const name = attempt === 1 ? `${base}.canvas` : `${base} ${attempt}.canvas`
    const path = `${rootPath}/${name}`
    try {
      const { created } = await invoke('fs:ensureFile', { path, content })
      if (created) return path
    } catch (err) {
      showToast(parseIpcError(err).message, 'error')
      return null
    }
  }
  showToast('Could not find a free canvas name', 'error')
  return null
}

/** A blank board. */
export async function newCanvas(): Promise<void> {
  const path = await createCanvas('Canvas', serializeCanvas({ nodes: [], edges: [] }))
  if (!path) return
  const store = useStore.getState()
  void store.refreshTree()
  await store.openPaths([path])
}

/**
 * A board seeded from the open note's topic cluster: every note the link
 * analysis groups with it, already wired with the links between them. The graph
 * knows which notes belong together, so the board starts from real structure.
 */
export async function canvasFromCluster(): Promise<void> {
  const store = useStore.getState()
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
  const path = await createCanvas(safeName(`${lead?.label ?? 'Cluster'} map`), serializeCanvas(canvas))
  if (!path) return
  void store.refreshTree()
  await store.openPaths([path])
  showToast(`Laid out ${canvas.nodes.length} notes`, 'success')
}
