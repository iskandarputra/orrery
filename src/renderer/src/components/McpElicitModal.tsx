import { useMemo, useState } from 'react'
import { fieldsForSchema } from '@core/json-schema-form'
import { schemaForPromptArguments } from '@core/mcp-tools'
import { useStore } from '@/state/store'
import { Icon } from './Icon'
import { SchemaForm, coerceValues, initialValues } from './SchemaForm'

/**
 * A server asking the user for something.
 *
 * Elicitation is the polite half of MCP: rather than failing because it lacks a
 * title, a folder or a confirmation, a server can ask. The form comes from the
 * schema it sent, drawn by the same code that draws a tool's arguments.
 *
 * Three answers, and they are different: accept sends what was typed, decline
 * says no, and closing the dialog cancels. A server is entitled to treat those
 * differently — "no" and "not now" are not the same instruction — so the
 * dialog does not collapse them.
 */

interface ElicitAsk {
  serverId: string
  serverName: string
  message: string
  schema: unknown
}

export function McpElicitModal(): React.JSX.Element | null {
  const ask = useStore((s) => s.mcpAsks[0])
  const answer = useStore((s) => s.answerMcpAsk)
  const payload = ask?.kind === 'elicitation' ? (ask.payload as ElicitAsk) : null

  const fields = useMemo(() => fieldsForSchema(payload?.schema), [payload?.schema])
  const [values, setValues] = useState<Record<string, string>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [seen, setSeen] = useState<string | null>(null)

  if (!ask || !payload) return null

  // A new question starts from its own schema's defaults rather than from
  // whatever the last one left in the boxes.
  if (seen !== ask.id) {
    setSeen(ask.id)
    setValues(initialValues(fields))
    setErrors({})
    return null
  }

  const accept = (): void => {
    const { values: content, errors: problems } = coerceValues(fields, values)
    setErrors(problems)
    if (Object.keys(problems).length > 0) return
    answer(ask.id, { action: 'accept', content })
  }

  return (
    <div className="modal-backdrop modal-backdrop--top">
      <div className="mcp-approve" role="dialog" aria-modal="true" aria-label="A server is asking">
        <header className="mcp-approve__head">
          <Icon name="info" size={18} className="mcp-approve__icon" />
          <div>
            <h2 className="mcp-approve__title">{payload.message}</h2>
            <p className="mcp-approve__server">
              asked by <strong>{payload.serverName}</strong>
            </p>
          </div>
        </header>

        <div className="mcp-approve__form">
          <SchemaForm
            fields={fields}
            values={values}
            errors={errors}
            idPrefix={`elicit-${payload.serverId}`}
            onChange={(name, value) => setValues({ ...values, [name]: value })}
          />
        </div>

        <footer className="mcp-approve__actions">
          <button className="btn" onClick={() => answer(ask.id, { action: 'cancel' })}>
            Cancel
          </button>
          <button className="btn" onClick={() => answer(ask.id, { action: 'decline' })}>
            Decline
          </button>
          <div className="mcp-approve__spacer" />
          <button className="btn btn--primary" onClick={accept}>
            Send
          </button>
        </footer>
      </div>
    </div>
  )
}

/**
 * A server asking to borrow the model.
 *
 * Sampling spends the user's own API budget on somebody else's prompt, which is
 * reason enough to ask. The prompt is shown in full: it is the only way to tell
 * a summariser from something rummaging through the conversation.
 */
interface SamplingAsk {
  serverId: string
  serverName: string
  system: string
  preview: string
}

export function McpSamplingModal(): React.JSX.Element | null {
  const ask = useStore((s) => s.mcpAsks[0])
  const answer = useStore((s) => s.answerMcpAsk)
  if (!ask || ask.kind !== 'sampling') return null
  const payload = ask.payload as SamplingAsk

  return (
    <div className="modal-backdrop modal-backdrop--top">
      <div
        className="mcp-approve"
        role="dialog"
        aria-modal="true"
        aria-label="A server wants to use your model"
      >
        <header className="mcp-approve__head">
          <Icon name="sparkle" size={18} className="mcp-approve__icon" />
          <div>
            <h2 className="mcp-approve__title">
              <strong>{payload.serverName}</strong> wants to use your model
            </h2>
            <p className="mcp-approve__server">
              It runs through your configured provider, and is charged to it.
            </p>
          </div>
        </header>

        {payload.system && (
          <>
            <label className="mcp-approve__args-label">Instructions</label>
            <pre className="mcp-approve__args">{payload.system}</pre>
          </>
        )}
        <label className="mcp-approve__args-label">Prompt</label>
        <pre className="mcp-approve__args">{payload.preview}</pre>

        <footer className="mcp-approve__actions">
          <button className="btn" onClick={() => answer(ask.id, { decision: 'deny' })}>
            Decline
          </button>
          <div className="mcp-approve__spacer" />
          <button
            className="btn btn--primary"
            onClick={() => answer(ask.id, { decision: 'allow' })}
          >
            Run it
          </button>
        </footer>
      </div>
    </div>
  )
}

/**
 * A prompt that needs arguments before it can be rendered.
 *
 * The same form, from a schema built out of the prompt's argument list. Without
 * it, using a prompt that takes a subject means sending no subject and getting
 * an error back from the server, which is a worse answer than a question.
 */
export function McpPromptModal(): React.JSX.Element | null {
  const pending = useStore((s) => s.mcpPromptPending)
  const run = useStore((s) => s.runMcpPrompt)
  const cancel = useStore((s) => s.cancelMcpPrompt)

  const fields = useMemo(
    () => fieldsForSchema(schemaForPromptArguments(pending?.prompt.arguments)),
    [pending?.prompt.arguments]
  )
  const [values, setValues] = useState<Record<string, string>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [seen, setSeen] = useState<string | null>(null)

  if (!pending) return null

  const key = `${pending.serverId}/${pending.prompt.name}`
  if (seen !== key) {
    setSeen(key)
    setValues(initialValues(fields))
    setErrors({})
    return null
  }

  const send = (): void => {
    const { values: args, errors: problems } = coerceValues(fields, values)
    setErrors(problems)
    if (Object.keys(problems).length > 0) return
    void run(Object.fromEntries(Object.entries(args).map(([k, v]) => [k, String(v)])))
  }

  return (
    <div className="modal-backdrop modal-backdrop--top">
      <div className="mcp-approve" role="dialog" aria-modal="true" aria-label="Prompt arguments">
        <header className="mcp-approve__head">
          <Icon name="sparkle" size={18} className="mcp-approve__icon" />
          <div>
            <h2 className="mcp-approve__title">{pending.prompt.title || pending.prompt.name}</h2>
            <p className="mcp-approve__server">
              {pending.prompt.description || 'This prompt needs a little more to work with.'}
            </p>
          </div>
        </header>

        <div className="mcp-approve__form">
          <SchemaForm
            fields={fields}
            values={values}
            errors={errors}
            idPrefix={`prompt-${pending.serverId}`}
            onChange={(name, value) => setValues({ ...values, [name]: value })}
          />
        </div>

        <footer className="mcp-approve__actions">
          <button className="btn" onClick={cancel}>
            Cancel
          </button>
          <div className="mcp-approve__spacer" />
          <button className="btn btn--primary" onClick={send}>
            Use prompt
          </button>
        </footer>
      </div>
    </div>
  )
}
