# MCP

Orrery speaks the Model Context Protocol in both directions.

- **As a client**, it connects to MCP servers you already run. Their tools,
  resources and prompts appear in the Tools panel, in the command palette, and
  to the AI assistant.
- **As a server**, it offers this vault to other MCP clients. Claude Code,
  Claude Desktop or anything else that speaks MCP can search your notes, read
  them, follow backlinks, and with your permission add to them.

Protocol revision `2025-11-25`, through the official TypeScript SDK.

---

## Connecting to a server

**Settings → MCP → Import** takes the `mcpServers` block you already have. All
three spellings work: Claude Desktop's `claude_desktop_config.json`, a project
`.mcp.json`, and the VS Code `servers` key. Entries that cannot be read are
named rather than skipped quietly.

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/home/me/notes"]
    },
    "github": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "ghcr.io/github/github-mcp-server"],
      "env": { "GITHUB_TOKEN": "${GITHUB_TOKEN}" }
    }
  }
}
```

`${GITHUB_TOKEN}` and `${env:GITHUB_TOKEN}` are read from your environment when
the server starts, so a token never has to be written into Orrery's settings
file. An unset variable expands to nothing rather than to its own name.

Servers over HTTP work too: give a URL instead of a command, and any headers it
needs.

### What you get

The **Tools panel** (`Ctrl+Shift+P` → Toggle MCP Tools Panel) lists every
configured server, whether it is connected, and what it offers. Each tool can be
expanded, filled in and run by hand, which is how you find out what a tool does
before deciding whether the assistant may call it. The **use** switch beside a
tool decides whether the model is offered it at all.

A server's **prompts** and **resources** are buttons: a prompt becomes a draft
question in the AI panel, a resource is attached to one. Prompts are in the
command palette too.

The **recent calls** list at the bottom of the panel is the audit log, written
to `<userData>/mcp-log/` as one JSON line per call, including the ones that were
refused.

## Permission

Every tool asks the first time. The dialog shows which server is asking, what
the tool says about itself, and the exact arguments.

| Answer           | What it means                                      |
| ---------------- | -------------------------------------------------- |
| **Allow once**   | This call, now.                                    |
| **Always allow** | Remembered for this tool of this server.           |
| **Deny**         | Not this call. It asks again next time.            |
| **Never allow**  | Remembered, until you revoke it in Settings → MCP. |

Two rules override the memory:

- A tool the server marks **destructive** asks every time, however it was
  answered. "Always allow" is not offered for one.
- Anything **writing to your vault** asks every time.

Remembered answers are per tool per server, listed and revocable in
**Settings → MCP → Permissions**. Removing a server forgets everything it was
allowed to do.

### Why the gate is where it is

A model reads text it did not write: a tool result, a fetched page, a note
somebody else wrote. That text can contain instructions aimed at the model, and
sometimes will. The defence is that permission is a decision made over data by
`core/mcp-permissions.ts`, and nothing the model reads can change what it
returns. Tool results are additionally fenced and labelled as data, which is a
second layer rather than the first one.

## Sampling, elicitation and roots

A server can ask the client for three things, and Orrery answers all three.

- **Sampling**: the server asks your model to complete something. It runs
  through the provider you configured and is charged to it, so the dialog shows
  the whole prompt first. Declining comes back to the server as an answer.
- **Elicitation**: the server asks you for structured input. The form is drawn
  from the schema it sent. Accept, decline and cancel are kept distinct.
- **Roots**: the vault is offered as the one folder a server may work in, and
  servers are told when you open another.

## Serving your vault

**Settings → MCP → Your vault as a server.** Off by default.

It listens on `127.0.0.1` only, and every request needs a bearer token that is
generated when you first switch it on. Settings shows a config block to paste
into the other client:

```json
{
  "mcpServers": {
    "orrery": {
      "url": "http://127.0.0.1:7373/mcp",
      "headers": { "Authorization": "Bearer <token>" }
    }
  }
}
```

For a client that can only launch a program and talk over pipes, use the bridge
that ships with Orrery:

```json
{
  "mcpServers": {
    "orrery": {
      "command": "node",
      "args": ["<resources>/mcp-stdio-bridge.mjs"],
      "env": {
        "ORRERY_MCP_URL": "http://127.0.0.1:7373/mcp",
        "ORRERY_MCP_TOKEN": "<token>"
      }
    }
  }
}
```

In a packaged install `<resources>` is the app's resources directory; from a
checkout it is `resources/mcp-stdio-bridge.mjs`. The bridge has no dependencies
of its own, and answers with an error rather than hanging when Orrery is closed.

### The tools

| Tool           | What it does                            |
| -------------- | --------------------------------------- |
| `search_notes` | Full-text search, with file and line    |
| `read_note`    | One note, by vault-relative path        |
| `list_notes`   | Every note, optionally under one folder |
| `backlinks`    | What links to a note, with the lines    |
| `git_status`   | What has changed in the vault           |
| `git_log`      | Recent commits                          |
| `create_note`  | A new note **(writes)**                 |
| `append_note`  | Add to an existing note **(writes)**    |

Notes are also offered as resources under `orrery://note/<path>`.

Each tool can be switched off individually. Every path argument is
vault-relative and is checked against the vault before anything opens it: a path
that resolves outside is refused, whether it climbed out with `..` or arrived
absolute.

### Writing

Off inside the server being on, deliberately: turning the server on should not
also hand an agent a pen. When it is on, every write raises the same dialog a
tool call raises, showing the path and the content, and the file is not touched
until you answer. There is no way to grant standing permission to write from
outside the app.

Everything a client does is written to the same log the panel shows, so "what
did that agent do to my notes" has an answer.

## Limits

- Remote servers authenticate with headers you supply. OAuth is not implemented
  yet; a bearer token in a header covers most hosted servers today.
- The vault server has no session state, so server-initiated streams and
  subscriptions are not offered to clients of it.
- Sampling requests are answered with a single completion, without tool use of
  their own.
