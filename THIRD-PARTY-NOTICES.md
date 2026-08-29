# Third-party notices

Orrery is MIT licensed (see [LICENSE](LICENSE)). It redistributes the fonts and
libraries below, which carry their own terms. Nothing here is copyleft: there is
no GPL, LGPL, AGPL or SSPL anywhere in the production dependency tree.

## Fonts bundled in the application

Font licences generally require the licence text and copyright notice to travel
with the font, so both are shipped: the full texts are in [`licenses/`](licenses/),
and the build copies them next to the fonts it installs.

### Editor and terminal

| Font                    | Licence     | Copyright                                                          |
| ----------------------- | ----------- | ------------------------------------------------------------------ |
| MesloLGL Nerd Font Mono | Apache-2.0  | 2009, 2010, 2013 André Berg; Nerd Fonts patches by Ryan L McIntyre |
| Inter                   | SIL OFL 1.1 | The Inter Project Authors                                          |
| JetBrains Mono          | SIL OFL 1.1 | The JetBrains Mono Project Authors                                 |
| Newsreader              | SIL OFL 1.1 | The Newsreader Project Authors                                     |

### Drawing surface

Copied out of `@excalidraw/excalidraw` at build time by
[`scripts/sync-assets.mjs`](scripts/sync-assets.mjs), because Excalidraw
otherwise fetches them from a CDN that a desktop application cannot reach.

| Font          | Licence     | Copyright                                                                                                    |
| ------------- | ----------- | ------------------------------------------------------------------------------------------------------------ |
| Excalifont    | SIL OFL 1.1 | 2024 Excalidraw. Excalifont is a trademark of Excalidraw                                                     |
| Virgil        | SIL OFL 1.1 | Excalidraw                                                                                                   |
| Comic Shanns  | MIT         | 2018 Shannon Miwa; 2023 Jesus Gonzalez; 2023 Rodrigo Batista de Moraes; 2024 Fini Jastrow; 2024 Kyle Beechly |
| Nunito        | SIL OFL 1.1 | The Nunito Project Authors                                                                                   |
| Assistant     | SIL OFL 1.1 | The Assistant Project Authors                                                                                |
| Cascadia Code | SIL OFL 1.1 | Microsoft Corporation                                                                                        |
| Lilita One    | SIL OFL 1.1 | The Lilita One Project Authors                                                                               |
| Liberation    | SIL OFL 1.1 | Red Hat, Inc.                                                                                                |

The CJK face (Xiaolai) is deliberately not shipped: it is 13 MB of the 14 MB and
is needed only for CJK text in a drawing, which falls back to a system font.

## Notable libraries

Full terms for every dependency are in each package under `node_modules`.
`npx license-checker --production --summary` reproduces the breakdown.

| Library                                     | Licence                                       |
| ------------------------------------------- | --------------------------------------------- |
| Electron, React, CodeMirror 6, Zustand, zod | MIT                                           |
| `@excalidraw/excalidraw`                    | MIT                                           |
| `@replit/codemirror-minimap`                | MIT                                           |
| `node-pty`, `@xterm/xterm`                  | MIT                                           |
| `@modelcontextprotocol/sdk`                 | MIT                                           |
| `dompurify`                                 | MPL-2.0 OR Apache-2.0 (used under Apache-2.0) |
| `pako`                                      | MIT AND Zlib                                  |

Electron bundles Chromium (BSD-3-Clause and others) and Node.js (MIT); their
notices ship inside the Electron distribution.

## The Rust sidecar

`native/orrery-sidecar` depends on `serde`, `serde_json`, `regex` and `ignore`,
each MIT OR Apache-2.0. Run `cargo license` in that directory for the full tree.
