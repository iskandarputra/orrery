import type { StateCreator } from 'zustand'
import type { GraphAnalysis } from '@shared/types'
import { invoke } from '@/services/client'
import type { AppState } from './store'

export interface GraphSlice {
  /** Last analysis of the workspace, or null before the first scan. */
  graph: GraphAnalysis | null
  /** Root the cached analysis belongs to — a different root invalidates it. */
  graphRoot: string | null
  graphLoading: boolean
  graphError: string | null

  /**
   * Scan and analyse the vault, or hand back the cache. Every surface calls
   * this; only the first one pays. `force` refreshes after edits.
   */
  loadGraph(force?: boolean): Promise<GraphAnalysis | null>
  /** Drop the cache — the vault changed underneath it. */
  invalidateGraph(): void
}

/** Shared between concurrent callers so three panels opening at once scan once. */
let inFlight: Promise<GraphAnalysis | null> | null = null

export const createGraphSlice: StateCreator<AppState, [], [], GraphSlice> = (set, get) => ({
  graph: null,
  graphRoot: null,
  graphLoading: false,
  graphError: null,

  async loadGraph(force = false) {
    const rootPath = get().rootPath
    if (!rootPath) return null
    const fresh = get().graph && get().graphRoot === rootPath
    if (fresh && !force) return get().graph
    if (inFlight && !force) return inFlight

    set({ graphLoading: true, graphError: null })
    inFlight = invoke('workspace:graph', { rootPath })
      .then((analysis) => {
        // A folder switch mid-scan makes the result stale: drop it.
        if (get().rootPath !== rootPath) return get().graph
        set({ graph: analysis, graphRoot: rootPath, graphLoading: false })
        return analysis
      })
      .catch((err: unknown) => {
        set({ graphLoading: false, graphError: err instanceof Error ? err.message : String(err) })
        return null
      })
      .finally(() => {
        inFlight = null
      })
    return inFlight
  },

  invalidateGraph() {
    set({ graph: null, graphRoot: null })
  }
})
