# GitHawk

A simple, fast git graph for VS Code. MIT licensed.

The extension most people used for this — [Git
Graph](https://github.com/mhutchie/vscode-git-graph) — has been abandoned
([#913](https://github.com/mhutchie/vscode-git-graph/issues/913),
[#838](https://github.com/mhutchie/vscode-git-graph/issues/838)) with millions of
installs still depending on it. Its licence looks like MIT but removes the rights
to `publish, distribute, sublicense, and/or sell derivative works`, so it is not
open source and nobody can legally ship a maintained fork.

GitHawk is a clean-room replacement under a real MIT licence. Meanwhile the
maintained alternatives keep bolting AI onto a tool whose entire job is drawing
lines between commits.

**Explicit non-goals:** no AI, no telemetry, no account, no cloud.

> Status: alpha. Reads real repositories, draws the graph correctly, and performs
> branch and commit actions. Reviewing a whole branch as one changeset is next.

## Architecture

Four tiers, with the dependency rule enforced by `eslint-plugin-boundaries`
rather than by convention:

```
src/
  domain/          zero dependencies — entities, layout algorithm
  application/     use cases + the host↔webview DTO and mappers
  infrastructure/  adapters behind ports (fixtures now, git CLI next)
  presentation/    host/ (VS Code plumbing) and webview/ (Svelte 5)
```

`domain` and `application` are platform-free and are bundled into **both** the
extension host and the webview. That is what lets the layout algorithm run
client-side without existing twice, and lets it be tested with no VS Code and no
browser.

Two rules worth knowing:

- **`vscode` may only be imported by `presentation/host` and `extension.ts`.**
  Everything else stays runnable in Node and in a browser. Lint fails otherwise.
- **Rows and lanes are domain concepts; pixels are not.** The layout emits
  `{row, lane}` only. Coordinates live in
  `presentation/webview/viewmodels/graphGeometry.ts`.
- **Native UI wherever VS Code already has it.** Menus are QuickPicks, the file
  list is a `TreeView`, and diffs open in the built-in diff editor. The webview
  draws the graph, which is the one thing VS Code cannot already do.

## Using it

The graph lives in the **panel** (`Cmd+9`). Changed files live in a tree in the
**primary sidebar**, under the GitHawk icon.

Right-click a commit, or click a branch, and GitHawk opens a **native VS Code
QuickPick** rather than a menu drawn inside the webview — so keyboard navigation,
theming, and confirmation dialogs are the ones you already know.

### Several repositories in one workspace

GitHawk searches each opened folder for git working trees and shows the one you
are working in. The repository name sits at the left of the toolbar — click it to
switch, or run **`GitHawk: Switch Repository`**.

How far it looks is `gitHawk.repositoryScanDepth`, default **2**:

| Depth | Finds |
| ----- | ----- |
| `0` | the opened folders only |
| `1` | a folder of projects |
| `2` | a folder of buckets, each holding projects |
| `3+` | anything deeper you happen to have |

The search skips dot-directories and heavy build directories (`node_modules`,
`dist`, `target`, and similar), so raising it is usually cheap — and it does not
stop at a repository, so submodules, linked worktrees, and repositories nested
inside a monorepo are all found. The picker itself has a gear that jumps straight
to the setting, and a **Search again** entry for a repository cloned since the
window opened.

Switching moves everything with it: the graph, branch actions, comparisons, and
the Changes tree, which is cleared rather than left describing the repository you
just left. Your choice is remembered per workspace.

### Keeping branches current

`main` behind the remote while you are on a feature branch is the common case, and
it does not need a checkout: click the branch and choose **"Update from
origin/main"**. That runs `git fetch origin main:main`, which moves the ref and
leaves your working tree, index, and HEAD alone.

There is deliberately no `--force`: git refuses anything that is not a
fast-forward, so a diverged branch is reported rather than overwritten. The branch
list shows ↓ behind, ↑ ahead, or "gone" for each branch, and
`GitHawk: Update All Branches From Upstream` fast-forwards every eligible one.

### Seeing what changed

- **Click a commit** — its files appear in the Changes tree. Click a file to open
  it in the diff editor.
- **Click a branch → "Review my work against …"** — everything your branch adds
  relative to that one, measured from the merge base, including uncommitted work.
- **"Compare … with …"** on a branch or commit — any two revisions, directly.
  Neither side has to involve where you currently are, so you can sit on `main`
  and compare two other branches.
- **Cmd/Ctrl-click** commits to select several, **Shift-click** for a run. The
  combined changeset appears automatically — selecting is the request, there is no
  button to press. With exactly two selected, *Diff the two instead* answers the
  other question: how those two states differ.

Whichever route you take, the tree states how the comparison was made, because a
merge-base diff, a direct diff, and a reconstruction answer different questions.

Destructive actions (reset, delete, rebase) require a modal confirmation that
states what will be lost, and `PerformGitActionUseCase` refuses to run one that
was not explicitly confirmed. Intent is mapped to git flags by a single pure
function, `argsFor`, which is where the tests are heaviest: this is the file where
a wrong flag costs someone their working tree.

## Development

```bash
npm install
```

### The fast loop — standalone webview harness

```bash
npm run dev          # esbuild watch + Vite dev server on :5173
```

Open <http://localhost:5173>. The webview runs as an ordinary web page: when
`acquireVsCodeApi` is absent, `devFixtureHost.ts` stands in for the extension
host and posts the same DTO the real host sends. Pick a fixture with
`?topology=linear`, `?topology=single-merge`, or `?topology=nested-branches`.

This is where nearly all UI work happens — full HMR, no VS Code restart, and
Playwright can drive it like any web app.

### The real thing

```bash
npm run dev:vscode   # esbuild watch + vite build --watch into dist/
```

Then press **F5**. The panel opens with `Cmd+9`.

### Rendering a real repository in the harness

Fixtures only prove the code agrees with fixtures. To see real history without
launching VS Code:

```bash
npm run dump -- ../some/repo 500     # writes dev-graph.json via the real adapter
npm run dev:webview                  # in another terminal
open 'http://localhost:5173/?topology=real'

npm run shot:real artifacts/real.png # screenshot it, and count what was drawn
npx vite-node scripts/laneStats.ts   # measure lane count and gutter width
```

### Screenshotting the real thing

The harness cannot reach anything outside the webview — QuickPick menus, the
sidebar tree, the diff editor. VS Code is Electron, so Playwright can drive the
actual application:

```bash
npm run shot:vscode                        # the sample repository, every scene
npm run shot:vscode:multi                  # a workspace holding several repositories
```

That launches a real VS Code with the extension loaded, opens the panel, and
captures the graph, the Changes tree, the grouped branch and commit menus, the
repository picker, and a multi-commit aggregate. It is also how the documentation
screenshots are produced, so they show the real UI rather than a mock.

Two things the script has to work around, both documented inline: clicks inside
the webview need `force: true`, because Playwright resolves the element in a
doubly-nested Electron iframe and then wrongly reports it as invisible; and the
first click after the panel is composed is sometimes swallowed while VS Code
settles focus, so opening a QuickPick is retried.

### Checks

```bash
npm test                    # Vitest — domain + application
npm run test:integration    # a real VS Code driving the real extension host
npm run test:visual         # Playwright — renders, interactions, screenshots
npm run shots               # refresh the screenshots only
npm run check               # tsc (host + webview) + svelte-check + eslint
```

Visual baselines live in `tests/visual/graph.spec.ts-snapshots/` and are
committed. A layout change shows up as both a failing assertion and a diffable
picture.

### Fixtures

`src/infrastructure/fixtures/topologies.ts` holds named repository shapes, each
recording what it is meant to stress. Adding a hard graph case means adding one
entry there — it then flows into the harness, the unit tests, and the visual
snapshots at once.

## Licence

MIT — see [LICENSE](LICENSE).
