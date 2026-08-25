import type { Settings } from '@shared/settings'
import { IpcError } from '../ipc/errors'

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

/**
 * Provider-agnostic chat completion. Runs in main so the API key never
 * enters the renderer. Non-streaming v1 — the IPC contract can grow a
 * streaming event channel later without breaking callers.
 */
export class AiService {
  constructor(private getSettings: () => Settings) {}

  async chat(system: string, messages: ChatMessage[]): Promise<string> {
    const { ai } = this.getSettings()
    if (ai.provider === 'claude') return this.claude(ai, system, messages)
    if (ai.provider === 'ollama') return this.ollama(ai, system, messages)
    if (ai.provider === 'openai-compatible') return this.openAiCompatible(ai, system, messages)
    throw new IpcError('UNKNOWN', 'No AI provider configured (Settings → AI)')
  }

  private async claude(
    ai: Settings['ai'],
    system: string,
    messages: ChatMessage[]
  ): Promise<string> {
    if (!ai.apiKey) throw new IpcError('UNKNOWN', 'Claude API key missing (Settings → AI)')
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': ai.apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({ model: ai.model, max_tokens: 2048, system, messages })
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new IpcError('UNKNOWN', `Claude API ${res.status}: ${detail.slice(0, 300)}`)
    }
    const data = (await res.json()) as { content?: { type: string; text?: string }[] }
    return (data.content ?? [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text ?? '')
      .join('')
  }

  /**
   * Any OpenAI-compatible chat endpoint. One code path covers DeepSeek, Groq,
   * OpenRouter, Together, LM Studio and vLLM — they differ only in base URL,
   * key and model name.
   */
  private async openAiCompatible(
    ai: Settings['ai'],
    system: string,
    messages: ChatMessage[]
  ): Promise<string> {
    if (!ai.compatKey) {
      throw new IpcError('UNKNOWN', 'API key missing for the OpenAI-compatible provider (Settings → AI)')
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
        messages: [{ role: 'system', content: system }, ...messages]
      })
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new IpcError('UNKNOWN', `${ai.compatModel} request failed (${res.status}): ${detail.slice(0, 300)}`)
    }
    const data = (await res.json()) as {
      choices?: { message?: { content?: string; reasoning_content?: string } }[]
    }
    const message = data.choices?.[0]?.message
    // Reasoning models (deepseek-reasoner and friends) return their thinking
    // separately; if there is no answer text, showing the thinking beats a blank.
    return message?.content?.trim() ? message.content : (message?.reasoning_content ?? '')
  }

  private async ollama(
    ai: Settings['ai'],
    system: string,
    messages: ChatMessage[]
  ): Promise<string> {
    const res = await fetch(`${ai.ollamaUrl.replace(/\/$/, '')}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: ai.ollamaModel,
        stream: false,
        messages: [{ role: 'system', content: system }, ...messages]
      })
    })
    if (!res.ok) {
      throw new IpcError('UNKNOWN', `Ollama ${res.status} — is Ollama running at ${ai.ollamaUrl}?`)
    }
    const data = (await res.json()) as { message?: { content?: string } }
    return data.message?.content ?? ''
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
