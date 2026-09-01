# Security

Orrery is a desktop application that opens a folder you point it at. It reads
and writes files in that folder, runs `git`, offers a terminal, and can talk to
MCP servers you configure. Those are the features, not the vulnerabilities — but
they are also the whole attack surface, so it is worth being precise about which
parts are meant to be trusted and which are not.

## Reporting a vulnerability

Please report privately through
[GitHub's private vulnerability reporting](https://github.com/iskandarputra/orrery/security/advisories/new)
rather than opening a public issue.

Include what you did, what happened, and the version (`orrery --version`, or the
`version` field in `package.json`). A proof of concept helps; a working exploit
is not required and is not expected.

There is one developer, so there is no response-time commitment. You will get an
acknowledgement, and if the report is valid you will be credited in the fix
unless you would rather not be.

## Supported versions

Version 0.1.x, and only the latest commit on `main`. Orrery is pre-1.0 software
with no release branches, so a fix lands on `main` and nowhere else.

## What is trusted, and what is not

**Trusted: your vault.** A folder you open is treated as yours. Orrery reads
every text file in it to build the index, the graph and search. If you open a
folder of files you do not trust, you are asking the application to read files
you do not trust.

**Not trusted: a document's contents.** A note, a PDF or a drawing may have come
from anywhere, so what is _inside_ a file is never allowed to act:

- The renderer runs with `contextIsolation`, `sandbox` and `webSecurity` on, and
  `nodeIntegration` off. A document cannot reach Node.
- Every IPC channel is declared once in `src/shared/ipc.ts` and validated with
  zod in main, so a compromised renderer cannot hand main a shape it does not
  expect.
- In-app navigation is denied outright and `window.open` is refused; an
  `http(s)` link is handed to the operating system instead of being followed.
- A PDF's own JavaScript is never executed (`isEvalSupported: false`,
  `enableXfa: false`). Forms still fill in; only their scripting is absent.
- Local files reach the renderer over a read-only `orrery-asset://` protocol
  rather than by disabling `webSecurity`.

**Trusted by your decision: MCP servers, and the terminal.** An MCP server you
add is a program you have chosen to run, and tool calls that reach outside the
vault are gated and audited rather than silent. The built-in terminal is a
shell: it can do whatever your shell can do. Neither is sandboxed from you, and
neither is claimed to be.

**Not in scope.** The AI features send what you ask them to send to the provider
you configure, using your key. That is the feature working; if you would rather
nothing left the machine, do not configure a provider.

## What is not audited

No third-party security audit has been done. The hardening above is what the
code does, verified by tests where testable, not an assurance that nothing was
missed.
