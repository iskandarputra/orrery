import { useState } from 'react'
import { invoke, parseIpcError } from '@/services/client'
import { useStore } from '@/state/store'
import { SegmentedControl, SettingRow, TextField, Toggle } from '../controls'

export function AiSection(): React.JSX.Element {
  const settings = useStore((s) => s.settings)
  const update = useStore((s) => s.updateSettings)
  const a = settings.ai

  return (
    <>
      <h3 className="set-group">Provider</h3>
      <SettingRow
        label="AI provider"
        description="Powers chat-with-vault; keys stay on this machine"
      >
        <SegmentedControl
          value={a.provider}
          onChange={(provider) => update({ ai: { ...a, provider } })}
          options={[
            { value: 'none', label: 'Off' },
            { value: 'claude', label: 'Claude' },
            { value: 'ollama', label: 'Ollama' },
            { value: 'openai-compatible', label: 'Custom' }
          ]}
        />
      </SettingRow>
      {a.provider === 'claude' && (
        <>
          <SettingRow label="API key" description="From console.anthropic.com — stored locally">
            <TextField
              value={a.apiKey}
              placeholder="sk-ant-…"
              onChange={(apiKey) => update({ ai: { ...a, apiKey } })}
            />
          </SettingRow>
          <SettingRow label="Model">
            <TextField
              value={a.model}
              placeholder="claude-sonnet-5"
              onChange={(model) => update({ ai: { ...a, model } })}
            />
          </SettingRow>
        </>
      )}
      {a.provider === 'ollama' && (
        <>
          <SettingRow label="Ollama URL" description="Local server — private and offline">
            <TextField
              value={a.ollamaUrl}
              placeholder="http://localhost:11434"
              onChange={(ollamaUrl) => update({ ai: { ...a, ollamaUrl } })}
            />
          </SettingRow>
          <SettingRow label="Model">
            <TextField
              value={a.ollamaModel}
              placeholder="llama3.1"
              onChange={(ollamaModel) => update({ ai: { ...a, ollamaModel } })}
            />
          </SettingRow>
        </>
      )}
      {a.provider === 'openai-compatible' && (
        <>
          <SettingRow
            label="Base URL"
            description="Any OpenAI-compatible API — DeepSeek, Groq, OpenRouter, LM Studio"
          >
            <TextField
              value={a.compatUrl}
              placeholder="https://api.deepseek.com"
              onChange={(compatUrl) => update({ ai: { ...a, compatUrl } })}
            />
          </SettingRow>
          <SettingRow label="API key" description="Stored locally, never leaves this machine">
            <TextField
              value={a.compatKey}
              placeholder="sk-…"
              onChange={(compatKey) => update({ ai: { ...a, compatKey } })}
            />
          </SettingRow>
          <SettingRow label="Model">
            <TextField
              value={a.compatModel}
              placeholder="deepseek-chat"
              onChange={(compatModel) => update({ ai: { ...a, compatModel } })}
            />
          </SettingRow>
        </>
      )}
      {a.provider !== 'none' && (
        <>
          <h3 className="set-group">Retrieval</h3>
          <SettingRow
            label="Semantic search"
            description="Retrieve by meaning (embeddings), widened along [[wikilinks]] from the best matches"
          >
            <Toggle
              checked={a.semanticSearch}
              onChange={(semanticSearch) => update({ ai: { ...a, semanticSearch } })}
            />
          </SettingRow>
          {a.semanticSearch && (
            <>
              <SettingRow
                label="Embedding model"
                description="Local Ollama model — run: ollama pull nomic-embed-text"
              >
                <TextField
                  value={a.embedModel}
                  placeholder="nomic-embed-text"
                  onChange={(embedModel) => update({ ai: { ...a, embedModel } })}
                />
              </SettingRow>
              <ReindexRow />
            </>
          )}
        </>
      )}
      <p className="set-note">
        Open the chat with Ctrl+Shift+A. Answers are grounded in your active note and matching vault
        snippets, with [file:line] citations.
      </p>
    </>
  )
}

function ReindexRow(): React.JSX.Element {
  const rootPath = useStore((s) => s.rootPath)
  const [status, setStatus] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const reindex = (): void => {
    if (!rootPath) {
      setStatus('Open a folder first.')
      return
    }
    setBusy(true)
    setStatus('Indexing…')
    void invoke('embeddings:reindex', { rootPath })
      .then((r) =>
        setStatus(
          r.embedded === 0
            ? `Up to date — ${r.chunks} chunks from ${r.files} notes.`
            : `Embedded ${r.embedded} changed note${r.embedded === 1 ? '' : 's'}, reused ${r.reused}.`
        )
      )
      .catch((err) => setStatus(parseIpcError(err).message))
      .finally(() => setBusy(false))
  }
  return (
    <SettingRow label="Index" description="Rebuild embeddings for the open vault">
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
        <button className="btn" disabled={busy} onClick={reindex}>
          {busy ? 'Indexing…' : 'Reindex vault'}
        </button>
        {status && <span className="set-row__desc">{status}</span>}
      </div>
    </SettingRow>
  )
}
