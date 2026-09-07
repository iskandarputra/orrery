# One arbiter for two resolvers

The vault graph draws two kinds of edge. Wikilinks join notes by title;
imports join source files by path, extension and package root. The review
comment that prompted this asked whether an unresolved edge should be kept as
a dangling node or dropped, and said the answer is what makes backlinks
trustworthy later.

The answer is already in the code, five times, and three of those disagree.

## What is there now

| Resolver                                 | Question           | 0 candidates        | N candidates                                |
| ---------------------------------------- | ------------------ | ------------------- | ------------------------------------------- |
| `core/notes.ts:79` `resolveNote`         | click a `[[link]]` | offer to create     | `find` takes the **first** in walk order    |
| `core/graph.ts:45` `byStem`              | draw the map       | `ghost:<stem>` node | `Map.set` leaves the **last** in walk order |
| `core/wikilinks.ts:116` `findLinkLines`  | backlinks panel    | nothing to show     | matches **all** of them                     |
| `core/code-links.ts:299` `resolveImport` | draw the map       | dropped, no node    | refuses, no edge                            |
| `core/notes.ts:73` `resolveFile`         | `[[paper.pdf]]`    | offer to create     | first in walk order                         |

Two consequences, both live:

- A vault with two `store.md` opens one file on a click and draws the edge to
  the other, because `find` takes the first match and `Map.set` leaves the
  last. Navigation and the map disagree about the same link.
- The backlinks panel does not use the graph at all. `BacklinksBody` calls
  `workspace:scanLinks`, which text-walks markdown only. It never sees an
  import, never sees a ghost, and shows both `store.md` files the same
  backlinks while the graph has picked one of them.

A broken relative import is invisible. `resolveImport` returns null for a
package that is not in the vault and for a path that no longer exists, and
`graph.ts:103` drops both with the same `continue`. Renaming a file breaks
every import naming it, and nothing in the app says so.

## Decisions

### One arbiter, two candidate finders

Finding candidates genuinely differs between the two edge types and stays
split. Deciding what to do with 0, 1 or N of them is one function, in
`core/link-resolution.ts`:

```ts
export type Resolution =
  | { status: 'resolved'; to: string; ambiguous: boolean }
  | { status: 'ambiguous'; candidates: string[] }
  | { status: 'missing' }
  | { status: 'external' }
```

`ambiguous: true` on a resolved edge records that a choice was made, so a
panel can say so without a second lookup.

### Ambiguity ranks, it does not guess

Candidates are ordered by, in order:

1. same folder as the linking file
2. longest shared path prefix with the linking file
3. fewest path segments
4. lexicographic path

Rules 3 and 4 make the order total. No result can depend on the directory
walk again, which is the whole of the first bug above.

### The asymmetry stays, and is stated

Wikilinks pass `tieBreak: 'nearest'`. Bare import specifiers pass
`tieBreak: 'refuse'`, keeping what `resolveImport` does now.

The difference is evidence, not taste. A wikilink is written inside a file, in
a folder, and every wiki convention reads that folder as part of the link. A
bare specifier such as `crate::pane` carries no path evidence at all, so
choosing between two `pane.rs` is wrong half the time, and a wrong edge in a
map is worse than a missing one. A relative specifier names exactly one path,
so it can never reach the tie-break.

### The dangling policy

| Case                                    | Node                                              | Reason                                                                                                         |
| --------------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Wikilink, 0 candidates                  | `ghost:<stem>`, `exists: false`                   | an unresolved wikilink is an intent to create, and `plugins/wikilinks/index.ts:40` already offers to create it |
| Relative or dotted import, 0 candidates | `missing:<path>`, `exists: false`, `kind: 'code'` | it names a path in this vault that is not there, which is the rename breakage, currently silent                |
| Bare import, 0 candidates               | none                                              | `react` is a real dependency and not part of this folder; drawing every package buries the map                 |
| Ambiguous and refused                   | none                                              | recorded on the edge, not drawn                                                                                |

A relative specifier that does not resolve is the only new node type. It is
rare by construction, so the map does not fill with them, and when one does
appear it is exactly the thing worth seeing.

### `exists`, not a string prefix

`AnalyticsView.tsx:51`, `AnalyticsView.tsx:276` and `NoteAnalysisPanel.tsx:118`
each test `id.startsWith('ghost:')`. Broken imports need a second id shape, and
threading a second prefix through three string comparisons is how this rots.
`GraphNode.exists` is already on the type and already false for ghosts; the
three sites read it instead.

### Backlinks come from the graph

`workspace:scanLinks` changes from `{ rootPath, targetStem }` to
`{ rootPath, targetPath, withCode }`, and is answered by selecting incoming
edges from the analysis `LinkScanner.graph` already caches behind a vault
fingerprint. The panel passes `settings.graph.includeCode`, the same setting
the map uses, so both surfaces describe the same vault.

`GraphEdge` gains `line: number`, 1-based. `findImports` already carries one.
`findWikilinks` carries character offsets, so `buildGraph` builds one line
index per file and converts.

Snippets are not stored on edges. Main reads the lines it needs from the at
most 200 matching files when the panel asks. A 200-character snippet per edge
on a repository of 3,721 files with tens of thousands of imports puts
megabytes into every graph build and across every IPC reply, for text that
only ever fills a panel.

## Testing

`core/link-resolution.ts` carries the weight, in the `core/` unit suite:

- two files sharing a stem resolve to the same file from `resolveNote` and
  from `buildGraph`, in both walk orders. This is the test that would have
  caught the live bug, so it is written against a fixture whose walk order can
  be reversed.
- a bare specifier with two same-family candidates yields `ambiguous` and no
  edge.
- a relative specifier that resolves nowhere yields `missing` and a
  `missing:` node; a bare one yields `external` and no node.
- ranking is total: two candidates equal on folder and prefix still order the
  same way every run.

Red-first is not optional here. Every one of these must be watched failing
against the current code before the change lands, because three of them
describe behaviour that exists today and would otherwise pass by accident.

`e2e/ui-audit.spec.ts` gains a `Surface` for the backlinks panel showing a
broken import and an ambiguous link, since both are new UI.

## Out of scope

Rename does not rewrite wikilinks. `file-system.ts:301` is a bare
`fs.rename`, so a rename breaks the wikilink side while refactor tooling keeps
the import side working. That asymmetry is real and worth closing, but it
comes after this rather than with it: rewriting a link safely requires one
resolver that agrees what the link means, and that is what this change builds.
