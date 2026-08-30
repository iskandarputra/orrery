import type { StateCreator } from 'zustand'
import type {
  McpAskRequest,
  McpAuditEntry,
  McpPromptInfo,
  McpServerStatus,
  McpToolResult
} from '@shared/types'
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
  /**
   * Text waiting to be put in the AI chat box.
   *
   * A server's prompt, or a resource someone attached. The panel and the
   * palette can both fill it; the chat picks it up and clears it, so nothing
   * has to reach into the chat's own state.
   */
  aiDraft: string
  /**
   * A prompt waiting for its arguments.
   *
   * Rendering a prompt that takes a subject without asking for one gets an
   * error back from the server, which is a worse answer than a form.
   */
  mcpPromptPending: { serverId: string; prompt: McpPromptInfo } | null

  loadMcp(): Promise<void>
  onMcpServerChanged(status: McpServerStatus): void
  onMcpAsk(request: McpAskRequest): void
  /** Answer the question at the front of the queue and drop it. */
  answerMcpAsk(id: string, value: unknown): void
  refreshMcpLog(): Promise<void>
  /** Put text in the chat box and show it. */
  draftToChat(text: string): void
  clearAiDraft(): void
  /** Use a server's prompt: straight to the chat, or via a form for its arguments. */
  useMcpPrompt(serverId: string, name: string): Promise<void>
  /** Finish a prompt that needed arguments. */
  runMcpPrompt(args: Record<string, string>): Promise<void>
  cancelMcpPrompt(): void
  /** Render a prompt with the arguments it needs and draft the result. */
  runMcpPromptWith(serverId: string, name: string, args: Record<string, string>): Promise<void>
  /** Read a resource and attach it to the chat box. */
  attachMcpResource(serverId: string, uri: string): Promise<void>

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
  aiDraft: '',
  mcpPromptPending: null,

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

  draftToChat(text) {
    set({ aiDraft: text })
    get().setSidePanel('ai')
  },

  clearAiDraft() {
    set({ aiDraft: '' })
  },

  async useMcpPrompt(serverId, name) {
    const prompt = get()
      .mcpServers.find((server) => server.id === serverId)
      ?.prompts.find((candidate) => candidate.name === name)

    if (prompt?.arguments && prompt.arguments.length > 0) {
      set({ mcpPromptPending: { serverId, prompt } })
      return
    }
    await get().runMcpPromptWith(serverId, name, {})
  },

  async runMcpPrompt(args) {
    const pending = get().mcpPromptPending
    if (!pending) return
    set({ mcpPromptPending: null })
    await get().runMcpPromptWith(pending.serverId, pending.prompt.name, args)
  },

  cancelMcpPrompt() {
    set({ mcpPromptPending: null })
  },

  async runMcpPromptWith(serverId, name, args) {
    const text = await invoke('mcp:getPrompt', { id: serverId, name, args }).catch(() => '')
    if (text) get().draftToChat(text)
    else get().showToast('That prompt returned nothing', 'error')
  },

  async attachMcpResource(serverId, uri) {
    const text = await invoke('mcp:readResource', { id: serverId, uri }).catch(() => '')
    if (!text) {
      get().showToast('That resource could not be read', 'error')
      return
    }
    // Labelled where it came from: a question about "the file below" is
    // ambiguous once three resources are attached.
    const existing = get().aiDraft
    get().draftToChat(`${existing ? `${existing}\n\n` : ''}From ${uri}:\n\n${text}`)
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
