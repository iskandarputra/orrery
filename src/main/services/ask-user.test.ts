import { describe, expect, it, vi } from 'vitest'
import { AskUser, type AskRequest } from './ask-user'

const collector = (): { sent: AskRequest[]; deliver: (r: AskRequest) => boolean } => {
  const sent: AskRequest[] = []
  return {
    sent,
    deliver: (request) => {
      sent.push(request)
      return true
    }
  }
}

describe('AskUser', () => {
  it('resolves with the answer the renderer sends back', async () => {
    const { sent, deliver } = collector()
    const ask = new AskUser(deliver)

    const answer = ask.ask<{ decision: string }>('tool', { tool: 'search' })
    ask.answer(sent[0]!.id, { decision: 'allow' })

    await expect(answer).resolves.toEqual({ decision: 'allow' })
    expect(ask.outstanding).toBe(0)
  })

  it('denies when there is no window to ask', async () => {
    // Nobody is there to consent, so nothing may proceed.
    const ask = new AskUser(() => false)
    await expect(ask.ask('tool', {})).resolves.toBeNull()
  })

  it('denies when the answer never comes', async () => {
    vi.useFakeTimers()
    try {
      const { deliver } = collector()
      const ask = new AskUser(deliver, 1000)
      const answer = ask.ask('tool', {})
      vi.advanceTimersByTime(1001)
      await expect(answer).resolves.toBeNull()
      expect(ask.outstanding).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('ignores an answer that arrives after the question expired', async () => {
    vi.useFakeTimers()
    try {
      const { sent, deliver } = collector()
      const ask = new AskUser(deliver, 1000)
      const answer = ask.ask('tool', {})
      vi.advanceTimersByTime(1001)
      // A dialog answered a minute late must not un-deny a call that already
      // failed closed.
      ask.answer(sent[0]!.id, { decision: 'allow' })
      await expect(answer).resolves.toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('ignores an id nobody is waiting for', () => {
    const ask = new AskUser(() => true)
    expect(() => ask.answer('not-a-question', { decision: 'allow' })).not.toThrow()
  })

  it('keeps two questions apart', async () => {
    const { sent, deliver } = collector()
    const ask = new AskUser(deliver)

    const first = ask.ask<string>('tool', { tool: 'a' })
    const second = ask.ask<string>('tool', { tool: 'b' })
    expect(ask.outstanding).toBe(2)

    ask.answer(sent[1]!.id, 'second')
    ask.answer(sent[0]!.id, 'first')

    await expect(first).resolves.toBe('first')
    await expect(second).resolves.toBe('second')
  })

  it('denies everything outstanding when the window goes away', async () => {
    const { deliver } = collector()
    const ask = new AskUser(deliver)
    const answer = ask.ask('tool', {})

    ask.cancelAll()

    await expect(answer).resolves.toBeNull()
    expect(ask.outstanding).toBe(0)
  })

  it('gives each question an id of its own', () => {
    const { sent, deliver } = collector()
    const ask = new AskUser(deliver)
    void ask.ask('tool', {})
    void ask.ask('elicitation', {})
    expect(sent[0]!.id).not.toBe(sent[1]!.id)
    expect(sent.map((r) => r.kind)).toEqual(['tool', 'elicitation'])
  })
})
