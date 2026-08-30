import type { Settings } from '@shared/settings'
import {
  assistantMessage,
  dialectFor,
  MAX_TOOL_ROUNDS,
  parseAssistantTurn,
  toolResultMessages,
  toolsPayload,
  type ToolCall,
  type ToolOutcome,
  type ToolSpec
} from '@core/ai-tools'
import type { AiToolStep } from '@shared/types'
import { IpcError } from '../ipc/errors'

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

/** Runs one tool and comes back with what to tell the model. */
export type ToolRunner = (call: ToolCall) => Promise<{ text: string; isError: boolean }>

/**
 * Provider-agnostic chat completion. Runs in main so the API key never
 * enters the renderer. Non-streaming v1 — the IPC contract can grow a
 * streaming event channel later without breaking callers.
 */
export class AiService {
  constructor(private getSettings: () => Settings) {}

  async chat(system: string, messages: ChatMessage[]): Promise<string> {
    const { ai } = this.getSettings()
    const data = await this.send(ai, system, messages, [])
    return parseAssistantTurn(dialectFor(ai.provider), data).text
  }

  /**
   * The same conversation, with tools in it.
   *
   * The loop is the whole feature: ask, run whatever the model asked for, tell
   * it what happened, ask again. It is bounded — a model that keeps calling
   * tools without ever answering has to stop somewhere — and every tool goes
   * through `runTool`, which is where the permission gate lives. Nothing here
   * decides what may run.
   *
   * `onStep` reports as it goes, because a chat that sits silent while three
   * tools run looks broken.
   */
  async chatWithTools(
    system: string,
    messages: ChatMessage[],
    tools: ToolSpec[],
    runTool: ToolRunner,
    onStep: (step: AiToolStep) => void
  ): Promise<string> {
    const { ai } = this.getSettings()
    const dialect = dialectFor(ai.provider)
    const conversation: unknown[] = [...messages]
    const said: string[] = []

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const data = await this.send(ai, system, conversation, tools)
      const turn = parseAssistantTurn(dialect, data)
      if (turn.text) said.push(turn.text)

      if (turn.calls.length === 0) return said.join('\n\n')

      conversation.push(assistantMessage(dialect, turn))
      const outcomes: ToolOutcome[] = []
      for (const call of turn.calls) {
        onStep({ kind: 'call', name: call.name, args: call.args })
        const result = await runTool(call)
        onStep({ kind: 'result', name: call.name, text: result.text, isError: result.isError })
        outcomes.push({ call, ...result })
      }
      conversation.push(...toolResultMessages(dialect, outcomes))
    }

    said.push(`Stopped after ${MAX_TOOL_ROUNDS} rounds of tool calls without an answer.`)
    return said.join('\n\n')
  }

  /**
   * One request to the configured provider, returning its answer as it came.
   *
   * Parsing belongs to `core/ai-tools`; this is only the sending, which is the
   * part that needs the key, the URL and the error message naming the provider
   * that failed.
   */
  private async send(
    ai: Settings['ai'],
    system: string,
    messages: unknown[],
    tools: ToolSpec[]
  ): Promise<unknown> {
    if (ai.provider === 'claude') return this.claude(ai, system, messages, tools)
    if (ai.provider === 'ollama') return this.ollama(ai, system, messages, tools)
    if (ai.provider === 'openai-compatible') {
      return this.openAiCompatible(ai, system, messages, tools)
    }
    throw new IpcError('UNKNOWN', 'No AI provider configured (Settings → AI)')
  }

  private async claude(
    ai: Settings['ai'],
    system: string,
    messages: unknown[],
    tools: ToolSpec[]
  ): Promise<unknown> {
    if (!ai.apiKey) throw new IpcError('UNKNOWN', 'Claude API key missing (Settings → AI)')
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': ai.apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: ai.model,
        max_tokens: 2048,
        system,
        messages,
        ...(tools.length > 0 ? { tools: toolsPayload('claude', tools) } : {})
      })
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new IpcError('UNKNOWN', `Claude API ${res.status}: ${detail.slice(0, 300)}`)
    }
    return res.json()
  }

  /**
   * Any OpenAI-compatible chat endpoint. One code path covers DeepSeek, Groq,
   * OpenRouter, Together, LM Studio and vLLM — they differ only in base URL,
   * key and model name.
   */
  private async openAiCompatible(
    ai: Settings['ai'],
    system: string,
    messages: unknown[],
    tools: ToolSpec[]
  ): Promise<unknown> {
    if (!ai.compatKey) {
      throw new IpcError(
        'UNKNOWN',
        'API key missing for the OpenAI-compatible provider (Settings → AI)'
      )
    }
    const res = await fetch(chatCompletionsUrl(ai.compatUrl), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${ai.compatKey}`
      },
      body: JSON.stringify({
        model: ai.compatModel,
        stream: false,
        max_tokens: 2048,
        // OpenAI-style: the system prompt is the first message, not a field.
        messages: [{ role: 'system', content: system }, ...messages],
        ...(tools.length > 0 ? { tools: toolsPayload('openai', tools) } : {})
      })
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new IpcError(
        'UNKNOWN',
        `${ai.compatModel} request failed (${res.status}): ${detail.slice(0, 300)}`
      )
    }
    // Reasoning models return their thinking separately; `parseAssistantTurn`
    // prefers it to a blank when there is no answer text.
    return res.json()
  }

  private async ollama(
    ai: Settings['ai'],
    system: string,
    messages: unknown[],
    tools: ToolSpec[]
  ): Promise<unknown> {
    const res = await fetch(`${ai.ollamaUrl.replace(/\/$/, '')}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: ai.ollamaModel,
        stream: false,
        messages: [{ role: 'system', content: system }, ...messages],
        ...(tools.length > 0 ? { tools: toolsPayload('ollama', tools) } : {})
      })
    })
    if (!res.ok) {
      throw new IpcError('UNKNOWN', `Ollama ${res.status} — is Ollama running at ${ai.ollamaUrl}?`)
    }
    return res.json()
  }
}

/**
 * Base URL → chat completions endpoint, forgiving about what the user pasted:
 * a trailing slash, an explicit `/v1`, or the full path all work.
 */
function chatCompletionsUrl(baseUrl: string): string {
  const base = baseUrl.trim().replace(/\/+$/, '')
  return base.endsWith('/chat/completions') ? base : `${base}/chat/completions`
}
