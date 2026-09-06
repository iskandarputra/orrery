# Link Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the vault one arbiter that decides what a link means, so navigation, the map and the backlinks panel stop disagreeing about the same file.

**Architecture:** Wikilinks and imports keep their own candidate finding, because matching a title and walking a relative path are genuinely different jobs. What becomes shared is the decision about 0, 1 or N candidates: a new pure module in `src/core/link-resolution.ts` with a total ordering, so no answer can depend on the directory walk. On top of that, an unresolved edge gets a stated fate per kind, and the backlinks panel is answered from the graph instead of its own text scan.

**Tech Stack:** TypeScript strict, vitest for units, Playwright for the built app. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-06-link-resolution-design.md`

## Global Constraints

- **No em dashes** in code comments, commit messages, docs or interface copy. Use a colon, a full stop, a comma or brackets.
- Plain British English. No filler ("comprehensive", "robust", "seamless", "leverage"). No "not just X but Y".
- Comments say *why*, and especially why the obvious thing is wrong. The diff already says what changed.
- `src/core/` must not import Electron, the DOM, or CodeMirror. `src/architecture.test.ts` enforces this and will fail if you do.
- Commits: conventional prefix, lowercase subject, scope where obvious (`feat(graph)`, `fix(links)`).
- The gate for every task is `./orrery.sh check` (lint, typecheck, unit tests). `npm run lint` fails on a single warning.
- Unit tests run with `--maxWorkers=1`. `npm run test` is already configured; a bare parallel `npx vitest` is where flakes come from.
- **Red-first is mandatory.** Every test below must be watched failing before its implementation is written. Three of these tests describe behaviour that exists today and would otherwise pass by accident, which is the exact failure mode `CLAUDE.md` warns about.
- Run a single test file with `npm run test -- src/core/<file>.test.ts`.
- **Out of scope:** rename does not rewrite wikilinks. `src/main/services/file-system.ts:301` stays a bare `fs.rename`. It is the obvious next thing and it is deliberately not in this plan: rewriting a link safely needs one resolver that agrees what the link means, which is what this builds.

---

### Task 1: The arbiter

**Files:**
- Create: `src/core/link-resolution.ts`
- Test: `src/core/link-resolution.test.ts`

**Interfaces:**
- Consumes: `dirname` from `src/core/paths.ts`.
- Produces: `type Resolution`, `type TieBreak`, `rankCandidates(fromPath: string, candidates: readonly string[]): string[]`, `resolve(fromPath: string, candidates: readonly string[], options: { tieBreak: TieBreak; whenEmpty: Resolution }): Resolution`. Tasks 2, 3 and 4 all import from here.

- [ ] **Step 1: Write the failing test**

Create `src/core/link-resolution.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { rankCandidates, resolve } from './link-resolution'

describe('rankCandidates', () => {
  it('prefers a candidate in the linking file’s own folder', () => {
    const ranked = rankCandidates('/v/notes/A.md', ['/v/store.md', '/v/notes/store.md'])
    expect(ranked[0]).toBe('/v/notes/store.md')
  })

  it('falls back to the nearest shared folder, then the shallowest path', () => {
    const ranked = rankCandidates('/v/a/b/A.md', ['/v/z/store.md', '/v/a/store.md'])
    expect(ranked[0]).toBe('/v/a/store.md')
    expect(rankCandidates('/v/A.md', ['/v/x/y/store.md', '/v/x/store.md'])[0]).toBe(
      '/v/x/store.md'
    )
  })

  it('orders totally, so the input order cannot change the answer', () => {
    // The bug this whole change exists for: `resolveNote` took the first stem
    // match in the directory walk and `buildGraph` kept the last, so the same
    // link opened one file and drew an edge to another. A total order is the
    // only thing that makes those two agree, so it is asserted directly.
    const candidates = ['/v/x/store.md', '/v/y/store.md', '/v/z/store.md']
    const forwards = rankCandidates('/v/A.md', candidates)
    const backwards = rankCandidates('/v/A.md', [...candidates].reverse())
    expect(backwards).toEqual(forwards)
    expect(forwards[0]).toBe('/v/x/store.md') // lexicographic, the last resort
  })
})

describe('resolve', () => {
  it('hands back the only candidate without calling it ambiguous', () => {
    expect(resolve('/v/A.md', ['/v/B.md'], { tieBreak: 'nearest', whenEmpty: { status: 'missing', at: 'B' } })).toEqual({
      status: 'resolved',
      to: '/v/B.md',
      ambiguous: false
    })
  })

  it('picks the nearest and says a choice was made', () => {
    expect(
      resolve('/v/notes/A.md', ['/v/store.md', '/v/notes/store.md'], {
        tieBreak: 'nearest',
        whenEmpty: { status: 'missing', at: 'store' }
      })
    ).toEqual({ status: 'resolved', to: '/v/notes/store.md', ambiguous: true })
  })

  it('refuses when asked to, and ranks what it refused', () => {
    const found = resolve('/v/main.rs', ['/v/b/pane.rs', '/v/a/pane.rs'], {
      tieBreak: 'refuse',
      whenEmpty: { status: 'external' }
    })
    expect(found).toEqual({ status: 'ambiguous', candidates: ['/v/a/pane.rs', '/v/b/pane.rs'] })
  })

  it('returns the caller’s own answer for no candidates at all', () => {
    expect(
      resolve('/v/A.md', [], { tieBreak: 'nearest', whenEmpty: { status: 'missing', at: 'Nowhere' } })
    ).toEqual({ status: 'missing', at: 'Nowhere' })
    expect(
      resolve('/v/a.ts', [], { tieBreak: 'refuse', whenEmpty: { status: 'external' } })
    ).toEqual({ status: 'external' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/core/link-resolution.test.ts`
Expected: FAIL, "Failed to resolve import './link-resolution'".

- [ ] **Step 3: Write the implementation**

Create `src/core/link-resolution.ts`:

```ts
/**
 * What a link means, once its candidates are known.
 *
 * The vault draws two kinds of edge and they find candidates in genuinely
 * different ways: a wikilink matches a title, an import walks a relative path
 * and guesses an extension. What they must not do differently is decide what 0,
 * 1 or N candidates mean. Five places used to answer that and three disagreed:
 * `resolveNote` took the first stem match in the directory walk, `buildGraph`
 * kept the last, and the backlinks panel matched all of them. A vault holding
 * two `store.md` opened one file on a click and drew the edge to the other.
 *
 * The ordering below is total on purpose. Ranking by folder alone leaves ties,
 * and a tie resolved by input order is the bug again wearing a rule.
 */

import { dirname } from './paths'

export type Resolution =
  /** `ambiguous` records that a choice was made, so a panel can say so. */
  | { status: 'resolved'; to: string; ambiguous: boolean }
  | { status: 'ambiguous'; candidates: string[] }
  /** `at` is what was looked for: a wikilink target, or an attempted path. */
  | { status: 'missing'; at: string }
  | { status: 'external' }

/**
 * What to do with more than one candidate.
 *
 * `nearest` is for wikilinks, which are written inside a file, in a folder, and
 * every wiki convention reads that folder as part of the link. `refuse` is for
 * a bare import specifier, which carries no path evidence at all: choosing
 * between two `pane.rs` would be wrong half the time, and a wrong edge in a map
 * is worse than a missing one.
 */
export type TieBreak = 'nearest' | 'refuse'

const segments = (path: string): string[] => path.split('/').filter(Boolean)

/** Leading folders two files share, counting neither file's own name. */
function sharedFolders(a: string, b: string): number {
  const left = segments(a)
  const right = segments(b)
  let shared = 0
  while (shared < left.length - 1 && shared < right.length - 1 && left[shared] === right[shared]) {
    shared++
  }
  return shared
}

/**
 * Candidates, nearest first.
 *
 * Same folder, then the nearest shared folder, then the shallowest path, then
 * the path itself. The last two exist to make the order total: without them two
 * candidates equally far away would keep whatever order they arrived in.
 */
export function rankCandidates(fromPath: string, candidates: readonly string[]): string[] {
  const home = dirname(fromPath)
  return [...candidates].sort((a, b) => {
    const sameFolder = Number(dirname(b) === home) - Number(dirname(a) === home)
    if (sameFolder !== 0) return sameFolder
    const shared = sharedFolders(fromPath, b) - sharedFolders(fromPath, a)
    if (shared !== 0) return shared
    const depth = segments(a).length - segments(b).length
    if (depth !== 0) return depth
    return a < b ? -1 : a > b ? 1 : 0
  })
}

/**
 * The one decision both edge types share.
 *
 * `whenEmpty` is supplied by the caller rather than inferred, because "nothing
 * matched" means different things on the two sides: a wikilink to nothing is a
 * note somebody intends to write, `import 'react'` is a real dependency that is
 * not in this folder, and `import './editorr'` is broken. Only the caller knows
 * which of those it is holding.
 */
export function resolve(
  fromPath: string,
  candidates: readonly string[],
  options: { tieBreak: TieBreak; whenEmpty: Resolution }
): Resolution {
  if (candidates.length === 0) return options.whenEmpty
  const ranked = rankCandidates(fromPath, candidates)
  if (ranked.length === 1) return { status: 'resolved', to: ranked[0]!, ambiguous: false }
  if (options.tieBreak === 'refuse') return { status: 'ambiguous', candidates: ranked }
  return { status: 'resolved', to: ranked[0]!, ambiguous: true }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- src/core/link-resolution.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Run the full gate**

Run: `./orrery.sh check`
Expected: PASS. `src/architecture.test.ts` confirms the new file imports nothing above `core/`.

- [ ] **Step 6: Commit**

```bash
git add src/core/link-resolution.ts src/core/link-resolution.test.ts
git commit -m "feat(links): one arbiter for what a link means

Two resolvers, one decision. Wikilinks match a title and imports walk a
path, and that part stays split because it really is different work. What
they shared was a question they answered three different ways: which file
does this name mean when more than one could.

The ordering is total. Ranking by folder alone leaves ties, and a tie
settled by input order is how resolveNote and buildGraph ended up picking
opposite ends of the same list."
```

---

### Task 2: Navigation resolves through the arbiter

**Files:**
- Modify: `src/core/notes.ts:73-83` (`resolveFile`, `resolveNote`)
- Modify: `src/core/notes.test.ts:45-55`
- Test: `src/core/notes.test.ts`

**Interfaces:**
- Consumes: `resolve` and `Resolution` from Task 1.
- Produces: `resolveNote(index: readonly NoteRef[], target: string, fromPath: string): NoteRef | null` and `resolveFile(index: readonly NoteRef[], target: string, fromPath: string): NoteRef | null`. The third parameter is new and **required**. Task 5 updates the six renderer call sites.

- [ ] **Step 1: Write the failing test**

Append to `src/core/notes.test.ts`:

```ts
describe('resolveNote with more than one candidate', () => {
  const duplicates = [
    { path: '/vault/archive/Store.md', stem: 'Store' },
    { path: '/vault/projects/Store.md', stem: 'Store' }
  ]

  it('prefers the note beside the one doing the linking', () => {
    expect(resolveNote(duplicates, 'store', '/vault/projects/Plan.md')?.path).toBe(
      '/vault/projects/Store.md'
    )
  })

  it('gives the same answer whichever order the walk found them', () => {
    // `find` used to take the first match, so reversing the index changed the
    // answer. That is half of the bug: buildGraph kept the last match, so the
    // two halves of the app pointed at different files.
    const forwards = resolveNote(duplicates, 'store', '/vault/A.md')?.path
    const backwards = resolveNote([...duplicates].reverse(), 'store', '/vault/A.md')?.path
    expect(backwards).toBe(forwards)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/core/notes.test.ts`
Expected: FAIL. TypeScript rejects the third argument, and once that compiles the "same answer" case fails because `find` returns whichever came first.

- [ ] **Step 3: Write the implementation**

In `src/core/notes.ts`, add the import and replace both functions:

```ts
import { resolve } from './link-resolution'
```

```ts
/**
 * Resolve a link target to any file in the vault, by its whole name.
 *
 * Separate from `resolveNote` because the two are asked different questions.
 * `[[Ideas]]` means the note called Ideas; `[[paper.pdf]]` names a file, and
 * treating that as a note would offer to create `paper.pdf.md`.
 *
 * `fromPath` is the file the link is written in, and it is required rather than
 * optional: it is what decides between two files of the same name, and a
 * default would quietly give a different answer here than the graph gives.
 */
export function resolveFile(
  index: readonly NoteRef[],
  target: string,
  fromPath: string
): NoteRef | null {
  return pick(index, target, fromPath, (ref) => ref.stem)
}

/** Resolve a wikilink target to a note (case-insensitive stem match). */
export function resolveNote(
  index: readonly NoteRef[],
  target: string,
  fromPath: string
): NoteRef | null {
  return pick(index, target, fromPath, (ref) => ref.stem)
}

function pick(
  index: readonly NoteRef[],
  target: string,
  fromPath: string,
  nameOf: (ref: NoteRef) => string
): NoteRef | null {
  const needle = target.trim().toLowerCase()
  const matches = index.filter((ref) => nameOf(ref).toLowerCase() === needle)
  const found = resolve(
    fromPath,
    matches.map((ref) => ref.path),
    { tieBreak: 'nearest', whenEmpty: { status: 'missing', at: target } }
  )
  if (found.status !== 'resolved') return null
  return matches.find((ref) => ref.path === found.to) ?? null
}
```

- [ ] **Step 4: Update the three existing assertions**

`src/core/notes.test.ts:49-54` calls `resolveNote` with two arguments. Add `'/vault/Inbox.md'` as the third to each so they compile. Their expectations do not change: those fixtures have one candidate each.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test -- src/core/notes.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core/notes.ts src/core/notes.test.ts
git commit -m "fix(links): stop resolving a wikilink by directory walk order

resolveNote used find, so with two Store.md the answer was whichever the
walk reached first. Reverse the index and the same link opened a different
file. It now ranks candidates and takes the nearest, which is an answer
that does not depend on how the vault was read.

fromPath is required rather than defaulted: it is the parameter that
decides between two files of the same name, so a default would give a
quietly different answer here than the graph gives for the same link."
```

---

### Task 3: The map resolves wikilinks the same way

**Files:**
- Modify: `src/core/graph.ts:44-91`
- Modify: `src/shared/types.ts:63-68` (`GraphEdge`)
- Test: `src/core/graph.test.ts`

**Interfaces:**
- Consumes: `resolve` from Task 1, `resolveNote` from Task 2.
- Produces: `GraphEdge` gains `ambiguous: boolean`. Task 7 adds `line` to the same interface.

- [ ] **Step 1: Write the failing test**

Append to `src/core/graph.test.ts`:

```ts
import { resolveNote } from './notes'

describe('two files with the same name', () => {
  const duplicates: GraphFile[] = [
    { path: '/v/archive/Store.md', stem: 'Store', content: '' },
    { path: '/v/projects/Store.md', stem: 'Store', content: '' },
    { path: '/v/projects/Plan.md', stem: 'Plan', content: 'see [[Store]]' }
  ]

  it('draws the edge to the file a click would open', () => {
    // The bug in one assertion. buildGraph kept the last stem match and
    // resolveNote took the first, so this link opened /v/archive/Store.md
    // while the map drew an edge to /v/projects/Store.md.
    const graph = buildGraph(duplicates, '/v')
    const drawn = graph.edges.find((e) => e.from === '/v/projects/Plan.md')!.to
    const opened = resolveNote(
      duplicates.map((f) => ({ path: f.path, stem: f.stem })),
      'Store',
      '/v/projects/Plan.md'
    )!.path
    expect(drawn).toBe(opened)
    expect(drawn).toBe('/v/projects/Store.md')
  })

  it('gives the same edge whichever order the walk found the files', () => {
    const forwards = buildGraph(duplicates, '/v').edges.find((e) => e.kind === 'link')!.to
    const backwards = buildGraph([...duplicates].reverse(), '/v').edges.find(
      (e) => e.kind === 'link'
    )!.to
    expect(backwards).toBe(forwards)
  })

  it('marks the edge as a choice between candidates', () => {
    const edge = buildGraph(duplicates, '/v').edges.find((e) => e.kind === 'link')!
    expect(edge.ambiguous).toBe(true)
  })

  it('leaves an unambiguous edge unmarked', () => {
    const graph = buildGraph(
      [
        { path: '/v/A.md', stem: 'A', content: '[[B]]' },
        { path: '/v/B.md', stem: 'B', content: '' }
      ],
      '/v'
    )
    expect(graph.edges[0]!.ambiguous).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/core/graph.test.ts`
Expected: FAIL. `ambiguous` does not exist on `GraphEdge`, and once it compiles the first case fails with `drawn` being `/v/archive/Store.md`.

- [ ] **Step 3: Widen the edge type**

In `src/shared/types.ts`, replace the `GraphEdge` interface:

```ts
export interface GraphEdge {
  from: string
  to: string
  /** `link` is a wikilink between notes; `import` is one file requiring another. */
  kind: 'link' | 'import'
  /**
   * True when more than one file could have been meant and one was picked.
   *
   * Worth carrying rather than recomputing: the panel showing a backlink is a
   * long way from the index that knew there were two candidates.
   */
  ambiguous: boolean
}
```

- [ ] **Step 4: Write the implementation**

In `src/core/graph.ts`, add the import:

```ts
import { resolve } from './link-resolution'
```

Replace the stem index at line 45:

```ts
  // Every file carrying a stem, not the last one seen. A plain `Map.set` in
  // this loop left whichever file the walk reached last, which is how the map
  // came to draw an edge to a different Store.md than a click would open.
  const byStem = new Map<string, string[]>()
  for (const f of files) {
    const key = f.stem.toLowerCase()
    const bucket = byStem.get(key)
    if (bucket) bucket.push(f.path)
    else byStem.set(key, [f.path])
  }
```

Replace the body of the wikilink loop:

```ts
    for (const link of findWikilinks(f.content)) {
      const found = resolve(f.path, byStem.get(link.target.toLowerCase()) ?? [], {
        tieBreak: 'nearest',
        whenEmpty: { status: 'missing', at: link.target }
      })
      // A wikilink to nothing is a note somebody intends to write, and the
      // editor already offers to create it on click, so the graph keeps it.
      const to = found.status === 'resolved' ? found.to : `ghost:${link.target.toLowerCase()}`
      if (found.status !== 'resolved' && !nodes.has(to)) {
        // A linked-but-missing note: no file, so no words, folder or mtime.
        nodes.set(to, {
          id: to,
          label: link.target,
          exists: false,
          kind: 'note',
          degree: 0,
          folder: '',
          words: 0,
          mtimeMs: 0,
          tags: []
        })
      }
      if (to === f.path) continue // self-link
      const key = `${f.path}→${to}`
      if (seen.has(key)) continue
      seen.add(key)
      edges.push({
        from: f.path,
        to,
        kind: 'link',
        ambiguous: found.status === 'resolved' && found.ambiguous
      })
      nodes.get(f.path)!.degree++
      nodes.get(to)!.degree++
    }
```

Add `ambiguous: false` to the import edge pushed further down, so the file compiles. Task 4 replaces it properly.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test -- src/core/graph.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the full gate**

Run: `./orrery.sh check`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/core/graph.ts src/core/graph.test.ts src/shared/types.ts
git commit -m "fix(graph): draw the edge to the file a click would open

byStem was a Map<stem, path> filled in a loop, so with two Store.md it kept
whichever the walk reached last. resolveNote took the first. The link in a
note therefore opened one file while the map drew an edge to the other, and
nothing in the app said which was right.

Both now go through the same arbiter, and the test asserts the two agree
rather than asserting either one alone. An edge records whether a choice was
made, since the panel that shows a backlink is a long way from the index
that knew there were two candidates."
```

---

### Task 4: Imports say which kind of unresolved they are

**Files:**
- Modify: `src/core/code-links.ts:277-300` (`resolveImport`)
- Modify: `src/core/code-links.test.ts:87-145`
- Modify: `src/core/graph.ts:93-113` (the import loop)
- Test: `src/core/code-links.test.ts`, `src/core/graph.test.ts`

**Interfaces:**
- Consumes: `resolve`, `Resolution` from Task 1.
- Produces: `resolveImport(fromPath: string, spec: string, index: ImportIndex): Resolution`, no longer `string | null`.

- [ ] **Step 1: Write the failing test**

Append to `src/core/code-links.test.ts`:

```ts
describe('what kind of unresolved', () => {
  const files = ['/v/src/app.ts', '/v/src/store.tsx']

  it('calls a package external, not missing', () => {
    expect(resolveImport('/v/src/app.ts', 'react', indexImports(files))).toEqual({
      status: 'external'
    })
  })

  it('calls a relative path that resolves nowhere missing, and says where', () => {
    // Renaming a file breaks every relative import naming it. That used to
    // share a `continue` with `react`, so the app could not tell a broken
    // import from a dependency it was never going to draw.
    expect(resolveImport('/v/src/app.ts', './editorr', indexImports(files))).toEqual({
      status: 'missing',
      at: '/v/src/editorr'
    })
  })

  it('still refuses to choose between two files of the same name', () => {
    const ambiguous = ['/v/a/pane.rs', '/v/b/pane.rs', '/v/main.rs']
    expect(resolveImport('/v/main.rs', 'crate::pane', indexImports(ambiguous))).toEqual({
      status: 'ambiguous',
      candidates: ['/v/a/pane.rs', '/v/b/pane.rs']
    })
  })
})
```

Append to `src/core/graph.test.ts`:

```ts
describe('imports that resolve nowhere', () => {
  it('keeps a broken relative import as a node you can see', () => {
    const graph = buildGraph(
      [{ path: '/v/src/app.ts', stem: 'app', content: "import x from './editorr'" }],
      '/v'
    )
    const broken = graph.nodes.find((n) => !n.exists)!
    expect(broken).toMatchObject({ id: 'missing:/v/src/editorr', kind: 'code', exists: false })
    expect(graph.edges).toHaveLength(1)
  })

  it('draws nothing at all for a package', () => {
    const graph = buildGraph(
      [{ path: '/v/src/app.ts', stem: 'app', content: "import x from 'react'" }],
      '/v'
    )
    expect(graph.edges).toHaveLength(0)
    expect(graph.nodes).toHaveLength(1)
  })

  it('draws nothing for an import it refused to guess at', () => {
    const graph = buildGraph(
      [
        { path: '/v/main.rs', stem: 'main', content: 'use crate::pane;' },
        { path: '/v/a/pane.rs', stem: 'pane', content: '' },
        { path: '/v/b/pane.rs', stem: 'pane', content: '' }
      ],
      '/v'
    )
    expect(graph.edges.filter((e) => e.kind === 'import')).toHaveLength(0)
    expect(graph.nodes.every((n) => n.exists)).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- src/core/code-links.test.ts src/core/graph.test.ts`
Expected: FAIL. `resolveImport` returns a string or null, so every `toEqual` on an object fails, and no `missing:` node is created.

- [ ] **Step 3: Write the implementation**

In `src/core/code-links.ts`, add the import and rewrite `resolveImport`:

```ts
import { resolve, type Resolution } from './link-resolution'
```

```ts
/**
 * Which file in the vault an import means, and if none, which kind of none.
 *
 * Two ways in. A relative specifier is a path, so it is joined and tried with
 * the extensions its language leaves off, `index` files included. Anything else
 * (a package, a crate, a Java package name) is matched by its last segment
 * against the files there are.
 *
 * The three ways of not resolving are kept apart because they mean different
 * things. `react` is a real dependency that is not in this folder, so nothing
 * is drawn. `./editorr` names a path in this vault that is not there, which is
 * what a rename leaves behind and is worth seeing. Two files called `pane.rs`
 * is a refusal: with no path evidence a guess is wrong half the time, and a
 * wrong edge in a map is worse than a missing one.
 */
export function resolveImport(fromPath: string, spec: string, index: ImportIndex): Resolution {
  const known = index.paths
  const own = extname(fromPath).toLowerCase()
  const tries = CANDIDATES[own] ?? [own]

  // Two spellings of "relative": a path, and Python's leading dots.
  const asPath = spec.startsWith('./') || spec.startsWith('../')
  const asDots = /^\.+(?:\w|$)/.test(spec)

  if (asPath || asDots) {
    let base = dirOf(fromPath)
    let rest = spec
    if (asDots) {
      // One dot is "this folder", each extra dot is one level up.
      const dots = /^\.+/.exec(spec)?.[0].length ?? 0
      for (let up = 1; up < dots; up++) base = dirOf(base)
      rest = spec.slice(dots).replace(/\./g, '/')
    }

    const target = normalise(`${base}/${rest}`)
    const hit = (path: string): Resolution | null =>
      known.has(path) ? { status: 'resolved', to: path, ambiguous: false } : null
    for (const ext of tries) {
      const found = hit(`${target}${ext}`)
      if (found) return found
    }
    for (const ext of tries) {
      const found =
        hit(`${target}/index${ext}`) ?? hit(`${target}/mod${ext}`) ?? hit(`${target}/__init__${ext}`)
      if (found) return found
    }
    // A path names exactly one file, so this can never be ambiguous: either
    // that file is in the vault or the import is broken.
    return hit(target) ?? { status: 'missing', at: target }
  }

  const segments = spec.split(/[/:.\\]+/).filter(Boolean)
  const last = segments[segments.length - 1]
  if (!last) return { status: 'external' }

  // Only files of the same language: `crate::pane` in Rust cannot mean a
  // TypeScript file that happens to share the name.
  const family = FAMILY[own]
  const sharing = index.byStem.get(last.toLowerCase()) ?? []
  const matches = sharing.filter((file) => FAMILY[extname(file).toLowerCase()] === family)
  return resolve(fromPath, matches, { tieBreak: 'refuse', whenEmpty: { status: 'external' } })
}
```

In `src/core/graph.ts`, replace the import loop body:

```ts
    for (const found of findImports(f.content, f.path)) {
      const where = resolveImport(f.path, found.spec, index)
      // A package is a real dependency and not part of this folder, and a
      // refusal is a guess not worth making. Neither draws anything.
      if (where.status === 'external' || where.status === 'ambiguous') continue
      const to = where.status === 'resolved' ? where.to : `missing:${where.at}`
      if (where.status === 'missing' && !nodes.has(to)) {
        // What a rename leaves behind. Rare by construction, so it does not
        // fill the map, and when one appears it is the thing worth seeing.
        nodes.set(to, {
          id: to,
          label: stemOfPath(where.at),
          exists: false,
          kind: 'code',
          degree: 0,
          folder: '',
          words: 0,
          mtimeMs: 0,
          tags: []
        })
      }
      if (to === f.path) continue
      const key = `${f.path}→${to}`
      if (seen.has(key)) continue
      seen.add(key)
      edges.push({ from: f.path, to, kind: 'import', ambiguous: false })
      nodes.get(f.path)!.degree++
      nodes.get(to)!.degree++
    }
```

Add near the top of `src/core/graph.ts`, beside `folderOf`:

```ts
/** File name without its extension, for labelling a path that has no file. */
function stemOfPath(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '')
}
```

- [ ] **Step 4: Update the existing resolveImport assertions**

`src/core/code-links.test.ts` has 12 calls at lines 101-143 asserting `.toBe(path)` or `.toBeNull()`. Change each resolving one to `.toEqual({ status: 'resolved', to: <path>, ambiguous: false })`. Line 134 (`crate::pane` with two candidates) becomes the `ambiguous` shape, line 138 (`react`) becomes `{ status: 'external' }`, and line 139 (`./nowhere`) becomes `{ status: 'missing', at: '/v/src/nowhere' }`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test -- src/core/code-links.test.ts src/core/graph.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the full gate**

Run: `./orrery.sh check`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/core/code-links.ts src/core/code-links.test.ts src/core/graph.ts src/core/graph.test.ts
git commit -m "feat(graph): tell a broken import apart from a dependency

resolveImport returned null for react and for ./editorr alike, and graph.ts
dropped both with the same continue. So renaming a file broke every import
naming it and nothing in the app said so, while the one case that genuinely
belongs outside the map was treated identically.

Three answers now. A package is external and draws nothing, which is what it
did before and is still right: drawing every dependency buries the map. A
relative path that resolves nowhere is missing, and keeps a node, because
that is the rename damage and it is rare enough not to crowd anything. Two
candidates is still a refusal, for the reason the old comment gave."
```

---

### Task 5: The UI asks whether a node exists

**Files:**
- Modify: `src/renderer/src/components/AnalyticsView.tsx:51`, `:276`
- Modify: `src/renderer/src/components/NoteAnalysisPanel.tsx:118`
- Modify: `src/renderer/src/plugins/wikilinks/extension.ts:17-24`, `:72-74`
- Modify: `src/renderer/src/plugins/wikilinks/index.ts:19-31`
- Modify: `src/renderer/src/editor/preview-view.ts:38-48`
- Modify: `src/renderer/src/editor/link-preview.ts:39`
- Modify: `src/renderer/src/components/OutgoingPanel.tsx:49`
- Modify: `src/shared/types.ts:39`

**Interfaces:**
- Consumes: `resolveNote`/`resolveFile` with the required `fromPath` from Task 2.
- Produces: `WikilinkHost` gains `getFromPath(): string`.

- [ ] **Step 1: Replace the three prefix tests**

There is no unit test here: this is renderer code covered by Playwright, and the change is a mechanical swap of a string test for a field that already exists on the type. Adding a `ghost:` unit test would assert the thing being removed.

`AnalyticsView.tsx:51` sits in a handler that has the id only. Change the handler to take the node, and test `node.exists`:

```ts
    if (!node.exists) return // no file behind it yet
```

`AnalyticsView.tsx:276`:

```tsx
                title={note.exists ? note.id : 'This note does not exist yet'}
```

`NoteAnalysisPanel.tsx:118`:

```tsx
                  onClick={() => n.exists && void openPaths([n.id])}
```

Note the old line read `n.id.startsWith('ghost:') || void openPaths([n.id])`, which fired for every real node. Keep that meaning: open when it exists.

Update the comment on `src/shared/types.ts:39`:

```ts
  /**
   * File path for a file that is there.
   *
   * `ghost:<stem>` is a wikilink to a note nobody has written; `missing:<path>`
   * is an import naming a path that is not there. Read `exists` rather than the
   * prefix: there are two prefixes now, and a third would be missed by every
   * `startsWith` that had to be found by hand.
   */
  id: string
```

- [ ] **Step 2: Thread the linking file through the wikilink host**

In `src/renderer/src/plugins/wikilinks/extension.ts`, add to `WikilinkHost`:

```ts
  /** The file the links are written in, which decides between two of a name. */
  getFromPath(): string
```

At line 72, pass it:

```ts
            const from = host.getFromPath()
            const resolved =
              resolveNote(index, link.target, from) !== null ||
              (/\.[a-z0-9]+$/i.test(link.target) &&
                resolveFile(host.getFileIndex(), link.target, from) !== null)
```

In `src/renderer/src/plugins/wikilinks/index.ts`, add to the host and use it:

```ts
      getFromPath: () => activeFilePath(ctx.store.getState()),
```

and inside `openTarget`:

```ts
        const from = activeFilePath(state)
        const existing = resolveNote(state.noteIndex, target, from)
```

```ts
        const file = /\.[a-z0-9]+$/i.test(target) ? resolveFile(state.fileIndex, target, from) : null
```

- [ ] **Step 3: Add the selector the six call sites need**

The pattern `activeId ? buffers[activeId]?.filePath ?? null : null` is already written out at `App.tsx:72`, `canvas-commands.ts:55`, `canvas-commands.ts:102`, `commands/builtins.ts:313`, `documents.ts:225` and `BacklinksPanel.tsx:11`. Add it once in `src/renderer/src/state/app-state.ts` beside the `AppState` type:

```ts
/** The file in the focused pane, or '' when the pane holds nothing saved yet. */
export function activeFilePath(state: AppState): string {
  return (state.activeId && state.buffers[state.activeId]?.filePath) || ''
}
```

Use it in `preview-view.ts` (add `getFromPath: () => activeFilePath(appState())` to the host it builds, and pass `activeFilePath(state)` to both resolvers at lines 42 and 47), in `link-preview.ts:39`, and in `OutgoingPanel.tsx:49`. `OutgoingPanel` already reads `activeId`; give it `activeFilePath` from the store the same way it reads `noteIndex`, and add it to the dependency array on line 55.

- [ ] **Step 4: Run the full gate**

Run: `./orrery.sh check`
Expected: PASS. The typecheck is what proves every `resolveNote` and `resolveFile` call site was found: the third parameter is required, so a missed one cannot compile.

- [ ] **Step 5: Run the app and click a link**

Run: `./orrery.sh dev`
Open a vault with two notes of the same name in different folders, link to one from a note beside it, and Mod+click. It must open the one in the same folder.

- [ ] **Step 6: Commit**

```bash
git add src/renderer src/shared/types.ts
git commit -m "refactor(graph): ask a node whether it exists, not how its id starts

Three places tested id.startsWith('ghost:'). Broken imports need a second
prefix, and threading one through three string comparisons found by hand is
how this rots: the fourth would be missed. exists was already on the type
and already false for both.

The wikilink host now knows which file its links are written in, because
that is what decides between two notes of the same name. The typecheck
found the six call sites, which is why the parameter is required."
```

---

### Task 6: A broken import is not an unwritten note

**Files:**
- Modify: `src/core/metrics.ts:298-307`
- Modify: `src/shared/types.ts` (`BrokenLink`)
- Modify: `src/renderer/src/components/AnalyticsView.tsx` (the broken links list)
- Test: `src/core/metrics.test.ts`

**Interfaces:**
- Consumes: the `missing:` nodes from Task 4.
- Produces: `BrokenLink` gains `kind: 'note' | 'import'`.

`computeInsights` pushes every node with `exists: false` into `brokenLinks`.
Task 4 made a second kind of such node, so broken imports would land in the
analytics list beside ghost notes without anyone deciding they should. The two
are not the same thing and do not have the same fix: a ghost is a note somebody
intends to write, and an import naming a path that is not there is damage.
The comment at `metrics.ts:300` argues for the old lumping and goes stale the
moment Task 4 lands, which is worse than no comment because it will be trusted.

- [ ] **Step 1: Write the failing test**

Append to `src/core/metrics.test.ts`:

```ts
describe('broken links of two kinds', () => {
  it('tells an unwritten note apart from an import that resolves nowhere', () => {
    const analysis = analyzeGraph(
      buildGraph(
        [
          { path: '/v/note.md', stem: 'note', content: 'see [[Nowhere]]' },
          { path: '/v/app.ts', stem: 'app', content: "import x from './gone'" }
        ],
        '/v'
      )
    )
    const kinds = Object.fromEntries(analysis.insights.brokenLinks.map((b) => [b.id, b.kind]))
    expect(kinds['ghost:nowhere']).toBe('note')
    expect(kinds['missing:/v/gone']).toBe('import')
  })
})
```

`metrics.test.ts` imports `analyzeGraph`; add `buildGraph` from `./graph` if it
is not already imported there.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/core/metrics.test.ts`
Expected: FAIL, `kind` is not on `BrokenLink`.

- [ ] **Step 3: Write the implementation**

In `src/shared/types.ts`, add to `BrokenLink`:

```ts
  /**
   * Which kind of nothing this points at.
   *
   * `note` is a wikilink to a note nobody has written, which is a normal thing
   * to have in a vault and is fixed by writing it. `import` is a path that is
   * not there, which is usually what a rename left behind and is fixed by
   * correcting the path. Listing them together made the list read as a to-do
   * where half the rows were aspirations and half were faults.
   */
  kind: 'note' | 'import'
```

In `src/core/metrics.ts`, replace the `!node.exists` branch:

```ts
    if (!node.exists) {
      // Neither kind is an orphan: there is no file to fix up, only a link.
      brokenLinks.push({
        id: node.id,
        label: node.label,
        kind: node.id.startsWith('missing:') ? 'import' : 'note',
        from: into[i]!.map((j) => nodes[j]!.id).sort()
      })
      return
    }
```

This is the one place the id prefix is still read, because it is the only place
that has to tell the two apart after the fact and `kind` on the node would be
`'code'` for both a real file and a missing one.

In `AnalyticsView.tsx`, label the rows in the broken links list by `kind`:
"not written yet" for `note`, "path not found" for `import`, using the same
muted text style the list already uses for its secondary line.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- src/core/metrics.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full gate**

Run: `./orrery.sh check`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core/metrics.ts src/core/metrics.test.ts src/shared/types.ts src/renderer/src/components/AnalyticsView.tsx
git commit -m "fix(analytics): separate an unwritten note from a path that is gone

computeInsights listed every node without a file as a broken link, which was
right while the only such node was a ghost. Broken imports are nodes now, so
the list would have mixed notes somebody intends to write with paths a rename
broke, and the two have different fixes.

The comment arguing for the old lumping is corrected rather than left, since
a stale reason is worse than none: it gets trusted."
```

---

### Task 7: Edges carry the line they were written on

**Files:**
- Modify: `src/shared/types.ts` (`GraphEdge`)
- Modify: `src/core/graph.ts`
- Test: `src/core/graph.test.ts`

**Interfaces:**
- Produces: `GraphEdge` gains `line: number`, 1-based. Task 8 reads it.

- [ ] **Step 1: Write the failing test**

Append to `src/core/graph.test.ts`:

```ts
describe('where a link was written', () => {
  it('records the line of a wikilink and of an import', () => {
    const graph = buildGraph(
      [
        { path: '/v/A.md', stem: 'A', content: 'first\nsecond\nsee [[B]]' },
        { path: '/v/B.md', stem: 'B', content: '' },
        { path: '/v/a.ts', stem: 'a', content: "// header\nimport x from './b'" },
        { path: '/v/b.ts', stem: 'b', content: '' }
      ],
      '/v'
    )
    expect(graph.edges.find((e) => e.kind === 'link')!.line).toBe(3)
    expect(graph.edges.find((e) => e.kind === 'import')!.line).toBe(2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/core/graph.test.ts`
Expected: FAIL, `line` is not on `GraphEdge`.

- [ ] **Step 3: Write the implementation**

Add to `GraphEdge` in `src/shared/types.ts`:

```ts
  /** 1-based line the link was written on, so a panel can open it there. */
  line: number
```

In `src/core/graph.ts`, add the helper:

```ts
/**
 * Offset to 1-based line, over one prepared index per file.
 *
 * `findWikilinks` reports character offsets and a backlinks panel needs lines.
 * Counting newlines per link would rescan the file once per link; a file with
 * 200 links would read itself 200 times.
 */
function lineIndex(content: string): (offset: number) => number {
  const starts: number[] = [0]
  for (let at = content.indexOf('\n'); at !== -1; at = content.indexOf('\n', at + 1)) {
    starts.push(at + 1)
  }
  return (offset) => {
    let low = 0
    let high = starts.length - 1
    while (low < high) {
      const mid = Math.ceil((low + high) / 2)
      if (starts[mid]! <= offset) low = mid
      else high = mid - 1
    }
    return low + 1
  }
}
```

In the wikilink loop, build the index once per file before the loop and use it:

```ts
    const lineAt = lineIndex(f.content)
```

then `line: lineAt(link.from)` on the pushed edge. In the import loop, `findImports` already returns `line`, so push `line: found.line`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- src/core/graph.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/graph.ts src/core/graph.test.ts src/shared/types.ts
git commit -m "feat(graph): record the line a link was written on

The backlinks panel has to open a result at a line, and it is about to be
answered from the graph rather than from its own scan of the vault.

The offsets come from findWikilinks, so the conversion is done against one
prepared index per file. Counting newlines per link would make a file with
200 links read itself 200 times."
```

---

### Task 8: Backlinks come from the graph

**Files:**
- Modify: `src/shared/ipc.ts:205-209`
- Modify: `src/main/ipc/handlers.ts` (the `workspace:scanLinks` handler)
- Modify: `src/main/services/link-scanner.ts` (replace `scan` and `walk`)
- Modify: `src/renderer/src/components/BacklinksPanel.tsx`
- Test: `src/main/services/link-scanner.test.ts`

**Interfaces:**
- Consumes: `GraphEdge.line` and `.ambiguous` from Tasks 3 and 7, `LinkScanner.graph` as it already is.
- Produces: `LinkScanner.backlinks(rootPath: string, targetPath: string, withCode: boolean): Promise<BacklinkHit[]>`. `workspace:scanLinks` takes `{ rootPath, targetPath, withCode }`.

- [ ] **Step 1: Write the failing test**

Append to `src/main/services/link-scanner.test.ts`, following the existing real-temp-directory style in that file:

```ts
describe('backlinks from the graph', () => {
  it('finds a wikilink and an import pointing at the same file', () => {
    writeFileSync(path.join(vault, 'note.md'), 'see [[helper]]\n')
    writeFileSync(path.join(vault, 'helper.ts'), 'export const helper = 1\n')
    writeFileSync(path.join(vault, 'app.ts'), "import { helper } from './helper'\n")
    return scanner.backlinks(vault, path.join(vault, 'helper.ts'), true).then((hits) => {
      expect(hits.map((h) => path.basename(h.path)).sort()).toEqual(['app.ts', 'note.md'])
      expect(hits.find((h) => h.path.endsWith('app.ts'))).toMatchObject({
        line: 1,
        snippet: "import { helper } from './helper'"
      })
    })
  })

  it('does not report the file linking to itself', async () => {
    writeFileSync(path.join(vault, 'self.md'), 'see [[self]] and [[B]]\n')
    const hits = await scanner.backlinks(vault, path.join(vault, 'self.md'), false)
    expect(hits).toEqual([])
  })

  it('leaves source files out when the graph is set to notes only', async () => {
    writeFileSync(path.join(vault, 'helper.ts'), 'export const helper = 1\n')
    writeFileSync(path.join(vault, 'app.ts'), "import { helper } from './helper'\n")
    const hits = await scanner.backlinks(vault, path.join(vault, 'helper.ts'), false)
    expect(hits).toEqual([])
  })
})
```

The `vault` and `scanner` come from the `beforeEach` already at the top of that
file, which seeds `A.md` and `B.md`. Use `writeFileSync` and `path.join` as the
rest of the file does; there is no async fs helper in it and adding one would
leave two styles side by side.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/main/services/link-scanner.test.ts`
Expected: FAIL, `backlinks` is not a method on `LinkScanner`.

- [ ] **Step 3: Write the implementation**

In `src/main/services/link-scanner.ts`, replace `scan` and delete `walk`:

```ts
  /**
   * What links to a file, answered from the graph rather than from a scan.
   *
   * It used to be its own recursive text walk for `[[stem]]` over markdown
   * only, which made it a third answer to a question the map and the editor
   * were already answering two other ways: it never saw an import, and with two
   * files of the same name it reported both while the map had picked one.
   *
   * `withCode` is the caller's graph setting rather than a decision made here,
   * so the panel and the map describe the same vault. Asking for one while the
   * other is loaded rebuilds, because the two walks read different files.
   */
  async backlinks(rootPath: string, targetPath: string, withCode: boolean): Promise<BacklinkHit[]> {
    const analysis = await this.graph(rootPath, withCode)
    const incoming = analysis.edges.filter(
      (edge) => edge.to === targetPath && edge.from !== targetPath
    )
    if (incoming.length === 0) return []

    // Snippets are read here, not carried on every edge. A 200-character
    // snippet per edge would put megabytes into every graph build and every
    // IPC reply, for text that only ever fills a panel.
    const byFile = new Map<string, GraphEdge[]>()
    for (const edge of incoming.slice(0, MAX_HITS)) {
      const bucket = byFile.get(edge.from)
      if (bucket) bucket.push(edge)
      else byFile.set(edge.from, [edge])
    }

    const hits: BacklinkHit[] = []
    for (const [file, edges] of byFile) {
      let lines: string[]
      try {
        lines = (await fs.readFile(file, 'utf-8')).split('\n')
      } catch {
        continue // vanished since the graph was built
      }
      for (const edge of edges) {
        hits.push({
          path: file,
          line: edge.line,
          snippet: (lines[edge.line - 1] ?? '').trim().slice(0, 200)
        })
      }
    }
    return hits
  }
```

Add `GraphEdge` to the type import from `@shared/types`. `GraphAnalysis` already carries `edges: GraphEdge[]` (`src/shared/types.ts:153`), so nothing new is needed on it.

- [ ] **Step 4: Change the IPC contract**

In `src/shared/ipc.ts`:

```ts
  /** What links to a file: wikilinks and imports, from the vault graph. */
  'workspace:scanLinks': {
    req: { rootPath: string; targetPath: string; withCode: boolean }
    res: BacklinkHit[]
  }
```

In `src/main/ipc/handlers.ts`, update the zod schema and the call:

```ts
    z.object({
      rootPath: z.string().min(1),
      targetPath: z.string().min(1),
      withCode: z.boolean()
    }),
    (_e, req) => links.backlinks(req.rootPath, req.targetPath, req.withCode)
```

- [ ] **Step 5: Update the panel**

In `src/renderer/src/components/BacklinksPanel.tsx`, read the setting and pass the path:

```tsx
  const withCode = useStore((s) => s.settings.graph.includeCode)
```

```tsx
    void invoke('workspace:scanLinks', { rootPath, targetPath: activePath, withCode })
```

`scanKey` becomes `${rootPath}|${activePath}|${withCode}`, and `withCode` joins the `useCallback` dependency array. The empty state keeps its wording for a note. For a file that is not markdown, say what is actually true:

```tsx
      <EmptyState icon="link">
        Nothing links to <strong>{stem(activePath)}</strong> yet.
        {withCode ? null : ' Turn on code in the graph settings to include imports.'}
      </EmptyState>
```

The existing `.filter((h) => h.path !== activePath)` can go: `backlinks` already drops the file's own edges.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm run test -- src/main/services/link-scanner.test.ts`
Expected: PASS.

- [ ] **Step 7: Run the full gate**

Run: `./orrery.sh check`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/shared src/main src/renderer/src/components/BacklinksPanel.tsx
git commit -m "feat(links): answer backlinks from the graph

The panel ran its own recursive text walk for [[stem]] over markdown, which
made it a third answer to a question the map and the editor already answered
two other ways. It never saw an import, so a source file had no backlinks at
all, and with two notes of the same name it listed both while the map had
already chosen one of them.

It now selects incoming edges from the analysis the scanner already caches
behind a vault fingerprint, and reads snippets for the files it is about to
show. Carrying a 200-character snippet on every edge would put megabytes
into every graph build and every IPC reply for text that fills a panel."
```

---

### Task 9: Measure the new surfaces

**Files:**
- Modify: `e2e/ui-audit.spec.ts`
- Test: `e2e/ui-audit.spec.ts`

**Interfaces:**
- Consumes: the backlinks panel from Task 8, the broken-import node from Task 4.

- [ ] **Step 1: Add a Surface for each new piece of UI**

`CLAUDE.md` requires a `Surface` in the same change as new UI, because it measures contrast and pointer target size across all 28 themes and a surface added later is one that was never measured. Two are new: a backlinks panel showing an import hit, and a graph node for a broken import.

Follow the existing `Surface` shape in that file exactly. Each needs a vault fixture containing `app.ts` importing `./helper`, `helper.ts`, and a `note.md` with a wikilink, so the panel has an import hit and the map has a `missing:` node.

- [ ] **Step 2: Build, then run the audit**

Run: `./orrery.sh e2e e2e/ui-audit.spec.ts`
Expected: PASS across all 28 themes. The suite drives `out/`, so it must be built first; the wrapper does that.

If a new surface fails contrast, fix the colour rather than the threshold. The syntax palettes are the one documented exemption and neither of these is one.

- [ ] **Step 3: Commit**

```bash
git add e2e/ui-audit.spec.ts
git commit -m "test(a11y): measure the backlinks panel and the broken-import node

Both are new UI in this change, and a surface added later is a surface that
was never measured across the themes."
```

---

## Final verification

- [ ] Run `./orrery.sh check`. Expected: PASS.
- [ ] Run `npx tsc -p tsconfig.json --noEmit` for the e2e specs, which neither project tsconfig covers.
- [ ] Run `./orrery.sh e2e`. Expected: PASS.
- [ ] Prove the headline test can fail. Revert `src/core/notes.ts` `pick` to `index.find(...)` and confirm `graph.test.ts` "draws the edge to the file a click would open" goes red, then restore. A test that cannot fail is worse than no test, and this is the one the whole change exists for.
