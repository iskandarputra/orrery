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
