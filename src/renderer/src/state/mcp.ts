import type { StateCreator } from 'zustand'
import type { McpAskRequest, McpAuditEntry, McpServerStatus, McpToolResult } from '@shared/types'
import { forgetServer } from '@core/mcp-permissions'
import type { McpServerConfig } from '@core/mcp-config'
import { invoke, parseIpcError } from '@/services/client'
import type { AppState } from './app-state'

/**
 * MCP, from the renderer's side.
 *
 * Thin on purpose. The connections, the permission gate and the log all live in
 * main, because the model's tool calls never pass through here and a check the
 * UI performs is a check that half the callers skip. What is left is what a
 * panel needs: the last status main announced, the questions waiting for an
 * answer, and the recent log.
 */

export interface McpSlice {
  mcpServers: McpServerStatus[]
  /**
   * Questions from main, oldest first. A queue rather than one at a time: two
   * servers can ask at once, and losing the second would hang a tool call.
   */
  mcpAsks: McpAskRequest[]
  mcpLog: McpAuditEntry[]

  loadMcp(): Promise<void>
  onMcpServerChanged(status: McpServerStatus): void
  onMcpAsk(request: McpAskRequest): void
  /** Answer the question at the front of the queue and drop it. */
  answerMcpAsk(id: string, value: unknown): void
  refreshMcpLog(): Promise<void>

  connectMcpServer(id: string): Promise<void>
  disconnectMcpServer(id: string): Promise<void>
  callMcpTool(id: string, tool: string, args: Record<string, unknown>): Promise<McpToolResult>

  /** Add or replace a server definition, then connect it if it is enabled. */
  saveMcpServer(config: McpServerConfig): Promise<void>
  removeMcpServer(id: string): Promise<void>
  setMcpToolEnabled(serverId: string, tool: string, enabled: boolean): void
}

const LOG_LIMIT = 50

export const createMcpSlice: StateCreator<AppState, [], [], McpSlice> = (set, get) => ({
  mcpServers: [],
  mcpAsks: [],
  mcpLog: [],

  async loadMcp() {
    try {
      set({ mcpServers: await invoke('mcp:status', undefined) })
    } catch {
      // A panel with nothing in it is a fine outcome; MCP is optional.
    }
  },

  onMcpServerChanged(status) {
    const servers = get().mcpServers
    const at = servers.findIndex((server) => server.id === status.id)
    set({
      mcpServers: at === -1 ? [...servers, status] : servers.map((s, i) => (i === at ? status : s))
    })
  },

  onMcpAsk(request) {
    set({ mcpAsks: [...get().mcpAsks, request] })
  },

  answerMcpAsk(id, value) {
    set({ mcpAsks: get().mcpAsks.filter((ask) => ask.id !== id) })
    void invoke('mcp:answer', { id, value })
  },

  async refreshMcpLog() {
    try {
      set({ mcpLog: await invoke('mcp:audit', { limit: LOG_LIMIT }) })
    } catch {
      // As above.
    }
  },

  async connectMcpServer(id) {
    try {
      get().onMcpServerChanged(await invoke('mcp:connect', { id }))
    } catch (err) {
      get().showToast(parseIpcError(err).message, 'error')
    }
  },

  async disconnectMcpServer(id) {
    await invoke('mcp:disconnect', { id }).catch(() => undefined)
    await get().loadMcp()
  },

  async callMcpTool(id, tool, args) {
    try {
      const result = await invoke('mcp:callTool', { id, tool, args })
      void get().refreshMcpLog()
      return result
    } catch (err) {
      return { text: parseIpcError(err).message, isError: true, denied: false }
    }
  },

  async saveMcpServer(config) {
    const { mcp } = get().settings
    const servers = mcp.servers.some((server) => server.id === config.id)
      ? mcp.servers.map((server) => (server.id === config.id ? config : server))
      : [...mcp.servers, config]

    get().updateSettings({ mcp: { ...mcp, servers } })
    await get().loadMcp()
    if (config.enabled) await get().connectMcpServer(config.id)
  },

  async removeMcpServer(id) {
    await invoke('mcp:disconnect', { id }).catch(() => undefined)
    const { mcp } = get().settings
    // Permissions go with it. Adding a server back should not quietly restore
    // what an earlier one of the same name was once allowed to do.
    const permissions = forgetServer({ remembered: mcp.permissions.remembered, alwaysAsk: [] }, id)
    get().updateSettings({
      mcp: {
        ...mcp,
        servers: mcp.servers.filter((server) => server.id !== id),
        permissions: { remembered: permissions.remembered }
      }
    })
    set({ mcpServers: get().mcpServers.filter((server) => server.id !== id) })
  },

  setMcpToolEnabled(serverId, tool, enabled) {
    const { mcp } = get().settings
    const key = `${serverId}/${tool}`
    const disabledTools = enabled
      ? mcp.disabledTools.filter((entry) => entry !== key)
      : [...new Set([...mcp.disabledTools, key])]
    get().updateSettings({ mcp: { ...mcp, disabledTools } })
  }
})
