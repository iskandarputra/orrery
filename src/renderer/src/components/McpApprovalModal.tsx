import { useStore } from '@/state/store'
import { toolLabel, type McpToolInfo } from '@core/mcp-tools'
import { Icon } from './Icon'

/**
 * May this tool run?
 *
 * The dialog shows three things, and it shows them because a prompt that only
 * says "allow?" trains people to click allow: which server is asking, what the
 * tool says about itself, and the exact arguments it was given. The arguments
 * matter most — the difference between reading a note and deleting a directory
 * is in there, not in the tool's name.
 *
 * It is modal on purpose. A tool call is waiting on the answer, and a prompt
 * that can be ignored in a corner is a prompt that gets answered by the
 * timeout, which is a refusal nobody understands.
 */

interface ToolAsk {
  serverId: string
  serverName: string
  tool: McpToolInfo
  args: Record<string, unknown>
  source: 'user' | 'model'
  reason: string
}

export function McpApprovalModal(): React.JSX.Element | null {
  const ask = useStore((s) => s.mcpAsks[0])
  const answer = useStore((s) => s.answerMcpAsk)

  if (!ask || ask.kind !== 'tool') return null
  const payload = ask.payload as ToolAsk
  const destructive = payload.tool.annotations?.destructiveHint === true
  const args = JSON.stringify(payload.args ?? {}, null, 2)

  const decide = (decision: 'allow' | 'once' | 'deny' | 'never'): void =>
    answer(ask.id, { decision })

  return (
    <div className="modal-backdrop modal-backdrop--top">
      <div className="mcp-approve" role="dialog" aria-modal="true" aria-label="Run this tool?">
        <header className="mcp-approve__head">
          <Icon
            name={destructive ? 'alert-triangle' : 'zap'}
            size={18}
            className={
              destructive ? 'mcp-approve__icon mcp-approve__icon--warn' : 'mcp-approve__icon'
            }
          />
          <div>
            <h2 className="mcp-approve__title">
              {payload.source === 'model' ? 'The assistant wants to run' : 'Run'}{' '}
              <code>{toolLabel(payload.tool)}</code>
            </h2>
            <p className="mcp-approve__server">
              from <strong>{payload.serverName}</strong>
            </p>
          </div>
        </header>

        {payload.tool.description && (
          <p className="mcp-approve__desc">{payload.tool.description}</p>
        )}
        <p className={`mcp-approve__reason${destructive ? ' mcp-approve__reason--warn' : ''}`}>
          {payload.reason}
        </p>

        <label className="mcp-approve__args-label" htmlFor="mcp-approve-args">
          Arguments
        </label>
        <pre className="mcp-approve__args" id="mcp-approve-args">
          {args === '{}' ? 'none' : args}
        </pre>

        <footer className="mcp-approve__actions">
          {/* Deny is about this call. Refusing for good is a separate button,
              because a prompt whose obvious no is permanent is one people stop
              being able to answer honestly. */}
          <button className="btn" onClick={() => decide('deny')}>
            Deny
          </button>
          <button className="btn" onClick={() => decide('never')}>
            Never allow
          </button>
          <div className="mcp-approve__spacer" />
          {/* Not offered for a destructive tool: it would be a promise that
              cannot be kept, since the rules make it ask again anyway. */}
          {!destructive && (
            <button className="btn" onClick={() => decide('allow')}>
              Always allow
            </button>
          )}
          <button className="btn btn--primary" onClick={() => decide('once')}>
            Allow once
          </button>
        </footer>
      </div>
    </div>
  )
}
