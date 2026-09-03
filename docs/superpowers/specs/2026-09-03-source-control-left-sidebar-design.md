# Source control moves to the left sidebar

Source control lives in the right-hand panel, beside the outline, backlinks and
the rest. It is being moved to the left sidebar, where the file tree is, and it
leaves the right panel entirely.

The reason is where the work is. Staging a file, reading a diff and picking a
commit out of the graph are all things done _to_ the tree of files, and the tree
is on the left. Every other editor that has both puts them on the same side, so
the muscle memory arriving from elsewhere expects it there too.

## What changes for someone using it

The left sidebar gains a second view. The rail down the far edge grows a branch
icon beside the folder icon, and clicking it swaps the sidebar from the file
tree to source control — the branch bar, the commit box, the staged and
unstaged lists, and the graph, all as they are today. Clicking the icon of the
view already showing hides the sidebar, which is what the folder icon has
always done.

The Git tab on the right is gone. The **Source Control** command still opens
source control; it now opens it on the left.

Each view keeps its own header. The file tree keeps the workspace name, the
new-note and new-folder buttons, collapse, refresh and its filter box. Source
control gets a title strip carrying its refresh and its list/tree toggle.

## Structure

`Sidebar.tsx` is 188 lines and does two jobs: it is the shell — the `aside`, its
width, the resize handle — and it is the file tree's header. Only the first job
is about the sidebar, and a second view makes the confusion expensive, so the
two separate:

- **`Sidebar`** — the shell. The `aside`, the width, the resizer, and a switch
  on which view to render. Nothing about files.
- **`FilesView`** — today's header, the filter, `FileTree`, and the
  empty-workspace state, moved wholesale.
- **`SourceControlPanel`** — unchanged in substance, plus a title strip. The
  refresh and list/tree buttons move out of its branch bar and into that strip.

Each view renders its own header and its own scroll container, because the
header of one is not the header of the other and a shared wrapper would only
have to be told which it was looking at.

### State

A new setting, `sidebar.view`, holding `files` or `git` and defaulting to
`files`. Remembered for the same reason the open right-hand panel is: closing
the app should not lose which view somebody was working in.

One new store action, `showSidebarView(view)`: switch to the view and reveal the
sidebar, or hide the sidebar if that view is the one already showing. Hiding
leaves `view` where it was, so reopening returns to what was last being read.

Both rail icons route through it — the folder icon included, which today calls
`toggleSidebar` directly. That matters: with two views, a folder icon that only
toggles visibility would hide the sidebar when someone on source control was
asking for the file tree.

`Ctrl+B` keeps toggling visibility alone and does not change the view. It is the
"get this out of my way" key, and which view it was showing is not part of the
question.

A second command, **Files** (`view.toggleFiles`), joins **Source Control**. This
was not in the design and should have been: the sidebar has two views, and
shipping a command that reaches only one of them leaves the palette a one-way
door into source control.

## Retiring the stored `'git'`

`'git'` is a value in `sidePanelSchema`, which is persisted twice — as
`rightPanel.panel`, and as `sidePanel` inside every saved workspace. Removing it
from the enum is not a free edit.

`SettingsStore.load()` runs one `safeParse` over the whole document and falls
back to `defaultSettings` if it fails. There is no migration step; the comment
in `settings.ts` that says to "bump `schemaVersion` and add a migration in
SettingsStore" describes a facility that was never built. So a naive removal
means anyone whose panel was left on Git opens the app to _every_ setting reset
— their theme, their vault list, their MCP servers.

Three of these were checked against zod 4.4.3 rather than assumed:

- Removing a value from the enum fails the whole document, not the one field.
- `.catch(null)` on that field alone rescues the rest of the document.
- Changing `schemaVersion: z.literal(1)` to `z.literal(2)` rejects every file
  that already exists — following the comment's advice would itself be the
  reset it was meant to prevent.

So:

- `'git'` leaves `sidePanelSchema`, the `SidePanel` union, and `RightPanel`'s
  tab list.
- `rightPanel.panel` and each workspace's `sidePanel` gain `.catch(null)`. A
  stored `'git'` becomes "no panel open" and everything else survives. A panel
  name is not precious enough to be worth failing a document over, which is the
  same argument for catching any other corrupt value there.
- `schemaVersion` stops being a `z.literal` and becomes
  `z.number().int().default(1).catch(1)`, so it can never be the field that
  invalidates a document, and its comment is corrected to say what the code
  actually does rather than describing a migration step that does not exist.

This is deliberately not a migration framework. It is one removed string, and
the tolerant field is proportionate to it. The second time a value is retired,
build the versioned migration the comment imagines — and do it before the
removal, not during.

## Tests

- **`settings-store.test.ts`** — a `settings.json` holding
  `rightPanel.panel: "git"` loads, an unrelated `theme: "dark"` in the same file
  survives, and the panel reads back `null`. This is the regression the whole
  section above exists for, so it is written first and watched to fail.
- **`Sidebar` / `SidebarRail`** — the branch icon switches the view; clicking the
  icon of the visible view hides the sidebar; the view survives a reload from
  settings.
- **e2e** — all four specs reach source control through the `view.toggleGit`
  command rather than the right-hand tab. That made them look unaffected, and
  two of them were not:

  - `ui-audit.spec.ts` returned from source control with
    `runCommand('view.toggleOutline')`, on the assumption that opening git had
    displaced the right-hand panel. It no longer does, so the toggle closed an
    outline that was already open — and the surface left the sidebar on source
    control, which the next theme's first surface filters as a file tree. Both
    steps become "leave this showing" helpers rather than toggles.
  - `right-panel.spec.ts` asserts the right-hand rail holds eleven tabs. Ten,
    now.

  `ui-audit.spec.ts` also audits contrast and target size in the panel's new
  home, on rendered pixels, and covers the new rail icon and view header.

The lesson worth keeping: "it goes through a command, so it is unaffected" was
true of how the specs _navigate_ and false about what they _assume_ on the way
back out.

`.scm` and `.gitgraph` class names do not change. The e2e specs select on them,
and moving a panel is not a reason to rewrite what it is called.

## Out of scope

The list/tree toggle for changed files, which shipped separately and is
independent of where the panel is mounted. The graph's own contents. Push, pull
and fetch, which source control still deliberately does not do.
