import { useEffect, useMemo, useState } from 'react'
import { fieldsForSchema } from '@core/json-schema-form'
import { toolLabel, type McpToolInfo } from '@core/mcp-tools'
import type { McpServerStatus, McpToolResult } from '@shared/types'
import { useStore } from '@/state/store'
import { Icon } from './Icon'
import { EmptyState } from './PanelBits'
import { SchemaForm, coerceValues, initialValues } from './SchemaForm'

/**
 * What Orrery is connected to, and what it can do.
 *
 * The panel exists to make MCP legible before it is useful: which servers are
 * up, what each offers, and what has actually run. Running a tool by hand from
 * here is not a debugging aid — it is how someone finds out what a tool does
 * before deciding whether the assistant may call it.
 */

const STATE_LABEL: Record<McpServerStatus['state'], string> = {
  idle: 'Not connected',
  connecting: 'Connecting…',
  ready: 'Connected',
  failed: 'Failed'
}

export function McpBody(): React.JSX.Element {
  const servers = useStore((s) => s.mcpServers)
  const log = useStore((s) => s.mcpLog)
  const loadMcp = useStore((s) => s.loadMcp)
  const refreshLog = useStore((s) => s.refreshMcpLog)
  const openSettings = useStore((s) => s.openSettings)
  const [openServer, setOpenServer] = useState<string | null>(null)

  useEffect(() => {
    void loadMcp()
    void refreshLog()
  }, [loadMcp, refreshLog])

  if (servers.length === 0) {
    return (
      <EmptyState icon="zap">
        No MCP servers yet. Add one in{' '}
        <button className="link-btn" onClick={openSettings}>
          Settings → MCP
        </button>
        , or paste the config you already use elsewhere.
      </EmptyState>
    )
  }

  return (
    <div className="mcp-panel">
      {servers.map((server) => (
        <ServerCard
          key={server.id}
          server={server}
          expanded={openServer === server.id}
          onToggle={() => setOpenServer(openServer === server.id ? null : server.id)}
        />
      ))}

      <h4 className="mcp-panel__section">Recent calls</h4>
      {log.length === 0 ? (
        <p className="mcp-panel__quiet">Nothing has run yet.</p>
      ) : (
        <ul className="mcp-log">
          {log.map((entry, i) => (
            <li
              key={`${entry.at}-${i}`}
              className={`mcp-log__row mcp-log__row--${entry.outcome}`}
              title={`${JSON.stringify(entry.args)}\n${entry.summary}`}
            >
              <Icon
                name={
                  entry.outcome === 'ok'
                    ? 'check'
                    : entry.outcome === 'denied'
                      ? 'x'
                      : 'alert-triangle'
                }
                size={12}
              />
              <span className="mcp-log__tool">{entry.tool}</span>
              <span className="mcp-log__server">{entry.serverName}</span>
              <span className="mcp-log__ms">{entry.ms} ms</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function ServerCard({
  server,
  expanded,
  onToggle
}: {
  server: McpServerStatus
  expanded: boolean
  onToggle(): void
}): React.JSX.Element {
  const connect = useStore((s) => s.connectMcpServer)
  const disconnect = useStore((s) => s.disconnectMcpServer)

  return (
    <section className={`mcp-server mcp-server--${server.state}`}>
      <header className="mcp-server__head">
        <button className="mcp-server__toggle" onClick={onToggle} aria-expanded={expanded}>
          <Icon name={expanded ? 'chevron-down' : 'chevron-right'} size={13} />
          <span className={`mcp-dot mcp-dot--${server.state}`} aria-hidden="true" />
          <span className="mcp-server__name">{server.name}</span>
          <span className="mcp-server__state">{STATE_LABEL[server.state]}</span>
        </button>
        {server.state === 'ready' ? (
          <button
            className="mcp-server__action"
            title="Disconnect"
            aria-label={`Disconnect ${server.name}`}
            onClick={() => void disconnect(server.id)}
          >
            <Icon name="x" size={12} />
          </button>
        ) : (
          <button
            className="mcp-server__action"
            title="Connect"
            aria-label={`Connect ${server.name}`}
            onClick={() => void connect(server.id)}
          >
            <Icon name="refresh" size={12} />
          </button>
        )}
      </header>

      {server.state === 'failed' && server.error && (
        <p className="mcp-server__error">{server.error}</p>
      )}

      {expanded && (
        <div className="mcp-server__body">
          {server.tools.length === 0 && server.state === 'ready' && (
            <p className="mcp-panel__quiet">This server offers no tools.</p>
          )}
          {server.tools.map((tool) => (
            <ToolRow key={tool.name} serverId={server.id} tool={tool} />
          ))}

          {server.resources.length > 0 && (
            <>
              <h5 className="mcp-server__sub">Resources</h5>
              {server.resources.map((resource) => (
                <p className="mcp-server__resource" key={resource.uri} title={resource.uri}>
                  {resource.title || resource.name || resource.uri}
                </p>
              ))}
            </>
          )}

          {server.prompts.length > 0 && (
            <>
              <h5 className="mcp-server__sub">Prompts</h5>
              {server.prompts.map((prompt) => (
                <p className="mcp-server__resource" key={prompt.name} title={prompt.description}>
                  {prompt.title || prompt.name}
                </p>
              ))}
            </>
          )}
        </div>
      )}
    </section>
  )
}

function ToolRow({ serverId, tool }: { serverId: string; tool: McpToolInfo }): React.JSX.Element {
  const callTool = useStore((s) => s.callMcpTool)
  const disabledTools = useStore((s) => s.settings.mcp.disabledTools)
  const setEnabled = useStore((s) => s.setMcpToolEnabled)

  const fields = useMemo(() => fieldsForSchema(tool.inputSchema), [tool.inputSchema])
  const [open, setOpen] = useState(false)
  const [values, setValues] = useState<Record<string, string>>(() => initialValues(fields))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [result, setResult] = useState<McpToolResult | null>(null)
  const [busy, setBusy] = useState(false)

  const enabled = !disabledTools.includes(`${serverId}/${tool.name}`)

  const run = (): void => {
    const { values: args, errors: problems } = coerceValues(fields, values)
    setErrors(problems)
    if (Object.keys(problems).length > 0) return
    setBusy(true)
    void callTool(serverId, tool.name, args)
      .then(setResult)
      .finally(() => setBusy(false))
  }

  return (
    <div className={`mcp-tool${enabled ? '' : ' mcp-tool--off'}`}>
      <div className="mcp-tool__head">
        <button className="mcp-tool__name" onClick={() => setOpen(!open)} aria-expanded={open}>
          <Icon name={open ? 'chevron-down' : 'chevron-right'} size={12} />
          <span>{toolLabel(tool)}</span>
          {tool.annotations?.destructiveHint && (
            <span className="mcp-tool__flag" title="The server calls this destructive">
              destructive
            </span>
          )}
        </button>
        <label className="mcp-tool__switch" title="Offer this tool to the assistant">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(serverId, tool.name, e.target.checked)}
          />
          <span className="mcp-tool__switch-label">use</span>
        </label>
      </div>

      {open && (
        <div className="mcp-tool__body">
          {tool.description && <p className="mcp-tool__desc">{tool.description}</p>}
          <SchemaForm
            fields={fields}
            values={values}
            errors={errors}
            idPrefix={`${serverId}-${tool.name}`}
            onChange={(name, value) => setValues({ ...values, [name]: value })}
          />
          <button className="btn btn--primary mcp-tool__run" disabled={busy} onClick={run}>
            {busy ? 'Running…' : 'Run'}
          </button>
          {result && (
            <pre className={`mcp-tool__result${result.isError ? ' mcp-tool__result--error' : ''}`}>
              {result.text}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}
