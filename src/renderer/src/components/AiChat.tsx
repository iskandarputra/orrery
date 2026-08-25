import { useRef, useState } from 'react'
import { marked } from 'marked'
import { basename, stem } from '@core/paths'
import { getActiveView } from '@/editor/active-view'
import { invoke, parseIpcError } from '@/services/client'
import { useStore } from '@/state/store'
import { Icon } from './Icon'

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

const SUGGESTIONS = [
  'Summarize this note',
  'Extract action items',
  'Find related notes in vault',
  'Improve writing clarity'
]

export function AiChatBody(): React.JSX.Element {
  const provider = useStore((s) => s.settings.ai.provider)
  // The custom provider is whatever model you pointed it at, so name that.
  const providerLabel = useStore((s) =>
    s.settings.ai.provider === 'claude'
      ? 'Claude'
      : s.settings.ai.provider === 'ollama'
        ? 'Ollama'
        : s.settings.ai.compatModel || 'Custom'
  )
  const openSettings = useStore((s) => s.openSettings)
  const showToast = useStore((s) => s.showToast)
  const [turns, setTurns] = useState<Turn[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  const send = (overrideText?: string): void => {
    const question = (overrideText ?? input).trim()
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

  const handleCopyTurn = async (content: string): Promise<void> => {
    await navigator.clipboard.writeText(content)
    showToast('Copied to clipboard', 'success')
  }

  if (provider === 'none') {
    return (
      <div className="rpanel-empty">
        <div className="rpanel-empty__icon-wrap">
          <Icon name="sparkle" size={28} className="rpanel-empty__icon" />
        </div>
        <h3>AI Vault Assistant</h3>
        <p>Chat with your vault — answers grounded in your notes with cited sources.</p>
        <button className="btn btn--primary" onClick={openSettings}>
          <Icon name="gear" size={14} />
          Configure AI Provider
        </button>
      </div>
    )
  }

  return (
    <div className="aichat">
      <div className="aichat__header-info">
        <span className="aichat__provider-badge">
          <Icon name="sparkle" size={12} />
          <span>{providerLabel}</span>
        </span>
        {turns.length > 0 && (
          <button
            className="aichat__clear-btn"
            title="Clear conversation"
            onClick={() => setTurns([])}
          >
            <Icon name="trash" size={13} />
            <span>Clear</span>
          </button>
        )}
      </div>

      <div className="aichat__scroll" ref={scrollRef}>
        {turns.length === 0 && (
          <div className="aichat__welcome">
            <p className="aichat__intro">
              Ask questions about your notes. The active document and relevant vault snippets are provided automatically.
            </p>
            <div className="aichat__suggestions">
              <span className="aichat__suggestions-label">Try asking:</span>
              <div className="aichat__chips">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    className="aichat__chip"
                    onClick={() => send(s)}
                  >
                    <span>{s}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {turns.map((t, i) => (
          <div key={i} className={`aichat__turn aichat__turn--${t.role}`}>
            <div className="aichat__turn-header">
              <span className="aichat__turn-role">
                {t.role === 'user' ? 'You' : 'Assistant'}
              </span>
              <button
                className="aichat__turn-copy"
                title="Copy message"
                onClick={() => void handleCopyTurn(t.content)}
              >
                <Icon name="copy" size={12} />
              </button>
            </div>
            {t.role === 'assistant' ? (
              <div
                className="aichat__turn-content aichat__prose"
                dangerouslySetInnerHTML={{ __html: marked.parse(t.content) as string }}
              />
            ) : (
              <div className="aichat__turn-content">{t.content}</div>
            )}
          </div>
        ))}

        {busy && (
          <div className="aichat__turn aichat__turn--assistant aichat__turn--busy">
            <div className="aichat__typing">
              <span className="aichat__typing-dot" />
              <span className="aichat__typing-dot" />
              <span className="aichat__typing-dot" />
            </div>
            <span className="aichat__busy-text">Thinking with vault context…</span>
          </div>
        )}
      </div>

      <div className="aichat__bar">
        <textarea
          className="aichat__input"
          rows={2}
          placeholder="Ask your vault… (Enter to send, Shift+Enter for newline)"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
        />
        <button
          className={`aichat__send-btn${input.trim() && !busy ? ' aichat__send-btn--active' : ''}`}
          disabled={!input.trim() || busy}
          onClick={() => send()}
          title="Send message"
        >
          <Icon name="arrow-up" size={14} />
        </button>
      </div>
    </div>
  )
}
