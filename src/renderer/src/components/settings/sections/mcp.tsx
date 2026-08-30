import { useEffect, useState } from 'react'
import {
  configErrors,
  describeServer,
  importServers,
  serverId,
  type McpServerConfig
} from '@core/mcp-config'
import { clientConfigSnippet } from '@core/mcp-config'
import { grants } from '@core/mcp-permissions'
import { VAULT_TOOLS } from '@core/vault-tools'
import type { McpHostStatus } from '@shared/types'
import { invoke } from '@/services/client'
import { useStore } from '@/state/store'
import { Icon } from '@/components/Icon'
import { NumberField, SettingRow, TextField, Toggle } from '../controls'

/**
 * The servers Orrery talks to, and what they are allowed to do.
 *
 * Two ways in, because there are two kinds of person here: someone who already
 * has MCP servers configured for another client and wants them to work, and
 * someone adding their first one by hand. The first path is a paste box, and it
 * is deliberately the one at the top.
 */
export function McpSection(): React.JSX.Element {
  const settings = useStore((s) => s.settings)
  const update = useStore((s) => s.updateSettings)
  const save = useStore((s) => s.saveMcpServer)
  const remove = useStore((s) => s.removeMcpServer)
  const servers = settings.mcp.servers

  const [paste, setPaste] = useState('')
  const [importErrors, setImportErrors] = useState<string[]>([])
  const [draft, setDraft] = useState<McpServerConfig | null>(null)

  const runImport = (): void => {
    const { servers: found, errors } = importServers(
      paste,
      servers.map((s) => s.id)
    )
    setImportErrors(errors)
    if (found.length === 0) return
    update({ mcp: { ...settings.mcp, servers: [...servers, ...found] } })
    for (const server of found) if (server.enabled) void save(server)
    setPaste('')
  }

  const blank = (): McpServerConfig => ({
    id: serverId(
      'new server',
      servers.map((s) => s.id)
    ),
    name: '',
    enabled: true,
    transport: 'stdio',
    command: '',
    args: [],
    env: {},
    cwd: ''
  })

  return (
    <>
      <h3 className="set-group">Servers</h3>
      <p className="set-note">
        An MCP server is a program that offers tools, resources and prompts. Orrery runs the ones
        listed here on your machine, or connects to them over HTTP, and asks before any tool of
        theirs is allowed to run.
      </p>

      {servers.length === 0 && <p className="set-note">Nothing configured yet.</p>}

      {servers.map((server) => (
        <SettingRow key={server.id} label={server.name} description={describeServer(server)}>
          <div className="mcp-set__row-actions">
            <Toggle
              checked={server.enabled}
              onChange={(enabled) => void save({ ...server, enabled })}
            />
            <button
              className="btn"
              aria-label={`Edit ${server.name}`}
              onClick={() => setDraft(server)}
            >
              <Icon name="pencil" size={13} />
            </button>
            <button
              className="btn"
              aria-label={`Remove ${server.name}`}
              onClick={() => void remove(server.id)}
            >
              <Icon name="trash" size={13} />
            </button>
          </div>
        </SettingRow>
      ))}

      <SettingRow label="Add a server" description="By hand, one field at a time">
        <button className="btn" onClick={() => setDraft(blank())}>
          <Icon name="plus" size={13} />
          New server
        </button>
      </SettingRow>

      {draft && (
        <ServerEditor
          draft={draft}
          onChange={setDraft}
          onCancel={() => setDraft(null)}
          onSave={() => {
            void save(draft)
            setDraft(null)
          }}
        />
      )}

      <h3 className="set-group">Import</h3>
      <p className="set-note">
        Paste the <code>mcpServers</code> block from Claude Desktop, Claude Code or VS Code. Servers
        that cannot be read are named rather than skipped silently.
      </p>
      <textarea
        className="set-textarea"
        rows={5}
        spellCheck={false}
        placeholder={
          '{\n  "mcpServers": {\n    "filesystem": { "command": "npx", "args": ["-y", "…"] }\n  }\n}'
        }
        value={paste}
        onChange={(e) => setPaste(e.target.value)}
      />
      <SettingRow label="Import" description="Adds every server the block describes">
        <button className="btn btn--primary" disabled={!paste.trim()} onClick={runImport}>
          Import
        </button>
      </SettingRow>
      {importErrors.length > 0 && (
        <ul className="mcp-set__errors">
          {importErrors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      )}

      <h3 className="set-group">Permissions</h3>
      <p className="set-note">
        Answers you asked Orrery to remember. A tool a server calls destructive asks every time
        whatever is remembered here, and a refusal stays until you revoke it.
      </p>
      {grants({ remembered: settings.mcp.permissions.remembered, alwaysAsk: [] }).map((grant) => (
        <SettingRow
          key={grant.key}
          label={grant.key}
          description={grant.decision === 'allow' ? 'Allowed without asking' : 'Always refused'}
        >
          <button
            className="btn"
            onClick={() => {
              const remembered = { ...settings.mcp.permissions.remembered }
              delete remembered[grant.key]
              update({ mcp: { ...settings.mcp, permissions: { remembered } } })
            }}
          >
            Revoke
          </button>
        </SettingRow>
      ))}
      {Object.keys(settings.mcp.permissions.remembered).length === 0 && (
        <p className="set-note">Nothing remembered; every tool asks.</p>
      )}

      <VaultServer />

      <h3 className="set-group">Limits</h3>
      <SettingRow label="Call timeout" description="Milliseconds before a tool call is abandoned">
        <NumberField
          value={settings.mcp.timeoutMs}
          min={1000}
          max={300_000}
          step={1000}
          onChange={(timeoutMs) => update({ mcp: { ...settings.mcp, timeoutMs } })}
        />
      </SettingRow>
      <SettingRow
        label="Result size"
        description="Characters kept from a tool result before it is trimmed"
      >
        <NumberField
          value={settings.mcp.maxResultChars}
          min={500}
          max={200_000}
          step={500}
          onChange={(maxResultChars) => update({ mcp: { ...settings.mcp, maxResultChars } })}
        />
      </SettingRow>
    </>
  )
}

function ServerEditor({
  draft,
  onChange,
  onSave,
  onCancel
}: {
  draft: McpServerConfig
  onChange(next: McpServerConfig): void
  onSave(): void
  onCancel(): void
}): React.JSX.Element {
  const errors = configErrors(draft)

  return (
    <div className="mcp-set__editor">
      <SettingRow label="Name" description="How it appears in the panel">
        <TextField
          value={draft.name}
          placeholder="filesystem"
          onChange={(name) =>
            onChange({ ...draft, name, id: draft.name ? draft.id : serverId(name) })
          }
        />
      </SettingRow>

      <SettingRow label="Connection" description="A program on this machine, or a URL">
        <div className="mcp-set__row-actions">
          <button
            className={`btn${draft.transport === 'stdio' ? ' btn--primary' : ''}`}
            onClick={() =>
              onChange({
                id: draft.id,
                name: draft.name,
                enabled: draft.enabled,
                transport: 'stdio',
                command: '',
                args: [],
                env: {},
                cwd: ''
              })
            }
          >
            Command
          </button>
          <button
            className={`btn${draft.transport === 'http' ? ' btn--primary' : ''}`}
            onClick={() =>
              onChange({
                id: draft.id,
                name: draft.name,
                enabled: draft.enabled,
                transport: 'http',
                url: '',
                headers: {}
              })
            }
          >
            URL
          </button>
        </div>
      </SettingRow>

      {draft.transport === 'stdio' ? (
        <>
          <SettingRow label="Command" description="The executable alone, with no arguments">
            <TextField
              value={draft.command}
              placeholder="npx"
              onChange={(command) => onChange({ ...draft, command })}
            />
          </SettingRow>
          <SettingRow label="Arguments" description="Separated by spaces">
            <TextField
              value={draft.args.join(' ')}
              placeholder="-y @modelcontextprotocol/server-filesystem /home/me/notes"
              onChange={(text) => onChange({ ...draft, args: text.split(/\s+/).filter(Boolean) })}
            />
          </SettingRow>
          <SettingRow
            label="Environment"
            description="KEY=value, separated by commas. ${VAR} reads your own environment."
          >
            <TextField
              value={Object.entries(draft.env)
                .map(([key, value]) => `${key}=${value}`)
                .join(', ')}
              placeholder="GITHUB_TOKEN=${GITHUB_TOKEN}"
              onChange={(text) =>
                onChange({
                  ...draft,
                  env: Object.fromEntries(
                    text
                      .split(',')
                      .map((pair) => pair.trim())
                      .filter(Boolean)
                      .map((pair) => {
                        const at = pair.indexOf('=')
                        return at === -1
                          ? [pair, '']
                          : [pair.slice(0, at).trim(), pair.slice(at + 1).trim()]
                      })
                  )
                })
              }
            />
          </SettingRow>
        </>
      ) : (
        <SettingRow label="URL" description="The server's MCP endpoint">
          <TextField
            value={draft.url}
            placeholder="https://mcp.example.com/mcp"
            onChange={(url) => onChange({ ...draft, url })}
          />
        </SettingRow>
      )}

      {errors.length > 0 && (
        <ul className="mcp-set__errors">
          {errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      )}

      <SettingRow label="" description="">
        <div className="mcp-set__row-actions">
          <button className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn btn--primary" disabled={errors.length > 0} onClick={onSave}>
            Save server
          </button>
        </div>
      </SettingRow>
    </div>
  )
}

/**
 * The vault, offered to other MCP clients.
 *
 * Off by default, and writing off inside that: turning the server on should not
 * also hand an agent a pen. The token is shown rather than hidden, because the
 * only way to use this is to paste it somewhere, and a secret you cannot read
 * is a secret you regenerate until you can.
 */
function VaultServer(): React.JSX.Element {
  const settings = useStore((s) => s.settings)
  const update = useStore((s) => s.updateSettings)
  const showToast = useStore((s) => s.showToast)
  const host = settings.mcp.host
  const [status, setStatus] = useState<McpHostStatus | null>(null)

  useEffect(() => {
    let live = true
    void invoke('mcp:hostStatus', undefined)
      .then((next) => live && setStatus(next))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [host.enabled, host.token, host.allowWrites])

  const apply = async (patch: Partial<typeof host>): Promise<void> => {
    update({ mcp: { ...settings.mcp, host: { ...host, ...patch } } })
    // The setting is the switch; main follows it.
    setStatus(await invoke('mcp:hostSync', undefined).catch(() => null))
  }

  return (
    <>
      <h3 className="set-group">Your vault as a server</h3>
      <p className="set-note">
        Lets Claude Code, Claude Desktop or any other MCP client search and read these notes. It
        listens on 127.0.0.1 only, and every request needs the token below.
      </p>

      <SettingRow
        label="Serve this vault"
        description={
          status?.running
            ? `Listening on ${status.url}`
            : 'Off. Nothing outside can reach the vault.'
        }
      >
        <Toggle checked={host.enabled} onChange={(enabled) => void apply({ enabled })} />
      </SettingRow>

      <SettingRow
        label="Allow writing"
        description="Creating and appending to notes. Every write still asks you first."
      >
        <Toggle
          checked={host.allowWrites}
          onChange={(allowWrites) => void apply({ allowWrites })}
        />
      </SettingRow>

      <SettingRow label="Port" description="0 asks the operating system for a free one">
        <NumberField
          value={host.port}
          min={0}
          max={65535}
          step={1}
          onChange={(port) => void apply({ port })}
        />
      </SettingRow>

      {host.enabled && status?.token && (
        <>
          <SettingRow label="Token" description="Sent as a bearer token by the client">
            <div className="mcp-set__row-actions">
              <button
                className="btn"
                onClick={() => {
                  void navigator.clipboard.writeText(status.token)
                  showToast('Token copied', 'success')
                }}
              >
                <Icon name="copy" size={13} />
                Copy token
              </button>
              <button
                className="btn"
                onClick={() => {
                  void invoke('mcp:hostRegenerateToken', undefined).then((next) => {
                    setStatus(next)
                    showToast('New token. Clients using the old one will stop.', 'info')
                  })
                }}
              >
                Regenerate
              </button>
            </div>
          </SettingRow>

          <p className="set-note">Paste this into the other client's config:</p>
          <textarea
            className="set-textarea"
            rows={7}
            readOnly
            spellCheck={false}
            value={clientConfigSnippet(status.url, status.token)}
          />
        </>
      )}

      <p className="set-note">Tools offered:</p>
      {VAULT_TOOLS.map((tool) => (
        <SettingRow
          key={tool.name}
          label={tool.title}
          description={`${tool.name}${tool.writes ? ' — writes' : ''}`}
        >
          <Toggle
            checked={!host.disabledTools.includes(tool.name)}
            onChange={(on) =>
              void apply({
                disabledTools: on
                  ? host.disabledTools.filter((name) => name !== tool.name)
                  : [...host.disabledTools, tool.name]
              })
            }
          />
        </SettingRow>
      ))}
    </>
  )
}
