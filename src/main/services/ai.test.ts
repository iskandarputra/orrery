import { defaultSettings, type Settings } from '@shared/settings'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AiService } from './ai'

interface Captured {
  url: string
  headers: Record<string, string>
  body: Record<string, unknown>
}

/** Stubs fetch and records what the service sent. */
function stubFetch(response: unknown, ok = true): { calls: Captured[] } {
  const calls: Captured[] = []
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    calls.push({
      url,
      headers: init.headers as Record<string, string>,
      body: JSON.parse(init.body as string)
    })
    return {
      ok,
      status: ok ? 200 : 401,
      json: async () => response,
      text: async () => JSON.stringify(response)
    } as Response
  })
  return { calls }
}

function settingsWith(ai: Partial<Settings['ai']>): Settings {
  return { ...defaultSettings, ai: { ...defaultSettings.ai, ...ai } }
}

const compatible = {
  provider: 'openai-compatible' as const,
  compatUrl: 'https://api.deepseek.com',
  compatKey: 'sk-test',
  compatModel: 'deepseek-chat'
}

afterEach(() => vi.unstubAllGlobals())

describe('OpenAI-compatible provider', () => {
  it('posts to the chat completions endpoint with a bearer key', async () => {
    const { calls } = stubFetch({ choices: [{ message: { content: 'hi' } }] })
    const service = new AiService(() => settingsWith(compatible))

    const reply = await service.chat('be terse', [{ role: 'user', content: 'hello' }])

    expect(reply).toBe('hi')
    expect(calls[0]!.url).toBe('https://api.deepseek.com/chat/completions')
    expect(calls[0]!.headers['Authorization']).toBe('Bearer sk-test')
    expect(calls[0]!.body['model']).toBe('deepseek-chat')
    // The system prompt travels as the first message, OpenAI-style.
    expect(calls[0]!.body['messages']).toEqual([
      { role: 'system', content: 'be terse' },
      { role: 'user', content: 'hello' }
    ])
  })

  it('tolerates a base URL with a trailing slash or an explicit /v1', async () => {
    const { calls } = stubFetch({ choices: [{ message: { content: 'ok' } }] })

    await new AiService(() => settingsWith({ ...compatible, compatUrl: 'https://api.deepseek.com/' }))
      .chat('s', [{ role: 'user', content: 'q' }])
    await new AiService(() => settingsWith({ ...compatible, compatUrl: 'https://api.openai.com/v1' }))
      .chat('s', [{ role: 'user', content: 'q' }])

    expect(calls[0]!.url).toBe('https://api.deepseek.com/chat/completions')
    expect(calls[1]!.url).toBe('https://api.openai.com/v1/chat/completions')
  })

  it('does not double up when the URL already ends in /chat/completions', async () => {
    const { calls } = stubFetch({ choices: [{ message: { content: 'ok' } }] })
    await new AiService(() =>
      settingsWith({ ...compatible, compatUrl: 'https://api.deepseek.com/chat/completions' })
    ).chat('s', [{ role: 'user', content: 'q' }])
    expect(calls[0]!.url).toBe('https://api.deepseek.com/chat/completions')
  })

  it('falls back to reasoning content when a reasoner returns no answer text', async () => {
    // deepseek-reasoner splits thinking from the answer; an empty `content`
    // with reasoning present must not surface as a blank reply.
    stubFetch({
      choices: [{ message: { content: '', reasoning_content: 'thought it through' } }]
    })
    const reply = await new AiService(() => settingsWith(compatible)).chat('s', [
      { role: 'user', content: 'q' }
    ])
    expect(reply).toBe('thought it through')
  })

  it('prefers the answer over the reasoning when both are present', async () => {
    stubFetch({
      choices: [{ message: { content: 'the answer', reasoning_content: 'thinking…' } }]
    })
    const reply = await new AiService(() => settingsWith(compatible)).chat('s', [
      { role: 'user', content: 'q' }
    ])
    expect(reply).toBe('the answer')
  })

  it('explains a missing key instead of calling out', async () => {
    const { calls } = stubFetch({})
    const service = new AiService(() => settingsWith({ ...compatible, compatKey: '' }))
    await expect(service.chat('s', [{ role: 'user', content: 'q' }])).rejects.toThrow(/key/i)
    expect(calls).toHaveLength(0)
  })

  it('surfaces the provider error body on a failed request', async () => {
    stubFetch({ error: { message: 'insufficient balance' } }, false)
    const service = new AiService(() => settingsWith(compatible))
    await expect(service.chat('s', [{ role: 'user', content: 'q' }])).rejects.toThrow(
      /insufficient balance/
    )
  })
})
