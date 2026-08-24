import { useRef, useState } from 'react'
import { basename, stem } from '@core/paths'
import { getActiveView } from '@/editor/active-view'
import { invoke, parseIpcError } from '@/services/client'
import { useStore } from '@/state/store'

interface Turn {
  role: 'user' | 'assistant'
  content: string
}

/** Grounding context: the active note plus vault snippets matching the question. */
async function buildContext(question: string): Promise<string> {
  const { rootPath, activeId, buffers, settings } = useStore.getState()
  const parts: string[] = []
  const active = activeId ? buffers[activeId] : null
  const view = getActiveView()
  if (active && view) {
    parts.push(
      `## Active note: ${stem(active.fileName)}\n${view.state.doc.toString().slice(0, 6000)}`
    )
  }
  if (!rootPath) return parts.join('\n\n')

  const seen = new Set<string>()
  const add = (hit: { path: string; line: number; snippet: string }): boolean => {
    const key = `${hit.path}:${hit.line}`
    if (seen.has(key)) return true
    seen.add(key)
    parts.push(`[${basename(hit.path)}:${hit.line}] ${hit.snippet}`)
    return seen.size < 16
  }

  // Semantic retrieval (embeddings) when enabled, else keyword search.
  if (settings.ai.semanticSearch) {
    try {
      const hits = await invoke('embeddings:search', { rootPath, query: question, k: 12 })
      for (const hit of hits) if (!add(hit)) break
    } catch {
      // fall through to keyword search below
    }
  }
  if (seen.size === 0) {
    const terms = question
      .split(/\W+/)
      .filter((w) => w.length > 3)
      .slice(0, 6)
    for (const term of terms) {
      try {
        const hits = await invoke('workspace:search', {
          rootPath,
          query: term,
          regex: false,
          caseSensitive: false
        })
        for (const hit of hits.slice(0, 4)) if (!add(hit)) break
      } catch {
        // search failure shouldn't kill the chat
      }
      if (seen.size >= 16) break
    }
  }
  return parts.join('\n\n')
}

const SYSTEM = `You are the AI assistant inside zymd, the user's markdown knowledge base.
Answer from the provided vault context when possible and cite sources as [file:line].
When the context is insufficient, say so briefly before answering from general knowledge.
Be concise. Use markdown.`

export function AiChatBody(): React.JSX.Element {
  const provider = useStore((s) => s.settings.ai.provider)
  const openSettings = useStore((s) => s.openSettings)
  const [turns, setTurns] = useState<Turn[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  const send = (): void => {
    const question = input.trim()
    if (!question || busy) return
    setInput('')
    setBusy(true)
    const history: Turn[] = [...turns, { role: 'user', content: question }]
    setTurns(history)
    void (async () => {
      try {
        const context = await buildContext(question)
        const answer = await invoke('ai:chat', {
          system: context ? `${SYSTEM}\n\n# Vault context\n${context}` : SYSTEM,
          messages: history.slice(-8)
        })
        setTurns([...history, { role: 'assistant', content: answer }])
      } catch (err) {
        setTurns([...history, { role: 'assistant', content: `⚠ ${parseIpcError(err).message}` }])
      } finally {
        setBusy(false)
        setTimeout(() => scrollRef.current?.scrollTo({ top: 1e9 }), 50)
      }
    })()
  }

  if (provider === 'none') {
    return (
      <div className="rpanel-empty">
        <p>Chat with your vault — answers grounded in your notes with cited sources.</p>
        <button className="btn btn--primary" onClick={openSettings}>
          Configure AI provider
        </button>
      </div>
    )
  }

  return (
    <div className="aichat">
      <div className="aichat__scroll" ref={scrollRef}>
        {turns.length === 0 && (
          <p className="rpanel-empty">
            Ask about your notes — the active note and matching vault snippets are provided as
            context.
          </p>
        )}
        {turns.map((t, i) => (
          <div key={i} className={`aichat__turn aichat__turn--${t.role}`}>
            {t.content}
          </div>
        ))}
        {busy && <div className="aichat__turn aichat__turn--assistant">Thinking…</div>}
      </div>
      <div className="aichat__bar">
        <textarea
          className="aichat__input"
          rows={2}
          placeholder="Ask your vault… (Enter to send)"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
        />
      </div>
    </div>
  )
}
