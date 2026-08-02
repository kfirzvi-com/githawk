# Contributing to GitHawk

Bug reports and pull requests are welcome. This file is the developer's half of the
documentation — the user-facing half is [README.md](README.md).

```bash
npm install
```

## Architecture

Four tiers, with the dependency rule enforced by `eslint-plugin-boundaries` rather
than by convention:

```
src/
  domain/          zero dependencies — entities, the layout algorithm
  application/     use cases + the host↔webview DTOs and mappers
  infrastructure/  adapters behind ports (the git CLI, the filesystem)
  presentation/    host/ (VS Code plumbing) and webview/ (Svelte 5 runes)
```

`domain` and `application` are platform-free and are bundled into **both** the
extension host and the webview. That is what lets the layout algorithm run
client-side without existing twice, and lets it be tested with no VS Code and no
browser.

Three rules worth knowing before you change anything:

- **`vscode` may only be imported by `presentation/host` and `extension.ts`.**
  Everything else stays runnable in Node and in a browser. Lint fails otherwise.
- **Rows and lanes are domain concepts; pixels are not.** The layout service emits
  `{row, lane}` only. Coordinates live in
  `presentation/webview/viewmodels/graphGeometry.ts`.
- **Native UI wherever VS Code already has it.** Menus are QuickPicks, the file
  list is a `TreeView`, diffs open in the built-in diff editor. The webview draws
  the graph, which is the one thing VS Code cannot already do.

Two conventions about git itself:

- Arguments are always an array handed to `execFile`, never a shell string. A
  cloned repository can contain a branch called `; rm -rf ~`.
- `--force` is emitted in exactly one place (`worktree remove`, after git has
  already refused and the user has confirmed a second, differently worded
  question). Everywhere else git's refusal is the desired behaviour, not an
  obstacle to route around. Intent is mapped to flags by one pure function,
  `argsFor`, which is where the tests are heaviest — it is the file where a wrong
  flag costs someone their working tree.

## The fast loop — standalone webview harness

```bash
npm run dev          # esbuild watch + Vite dev server on :5173
```

Open <http://localhost:5173>. The webview runs as an ordinary web page: when
`acquireVsCodeApi` is absent, `devFixtureHost.ts` stands in for the extension host
and posts the same DTOs the real host sends. Pick a fixture with
`?topology=linear`, `?topology=single-merge`, or `?topology=nested-branches`; add
`?repositories=3` or `?worktrees=4` to exercise those.

This is where nearly all UI work happens — full HMR, no VS Code restart, and
Playwright can drive it like any web app.

## The real thing

```bash
npm run dev:vscode   # esbuild watch + vite build --watch into dist/
```

Then press **F5**. The panel opens with `Cmd+9`.

Sample repositories to work against — purpose-built, so break them freely:

```bash
./scripts/makeSampleRepo.sh       # branches, merges, tags, worktrees, dirty files
./scripts/makeMultiRepoSample.sh  # a workspace of repositories at several depths
```

## Rendering a real repository in the harness

Fixtures only prove the code agrees with fixtures. To see real history without
launching VS Code:

```bash
npm run dump -- ../some/repo 500     # writes dev-graph.json via the real adapter
npm run dev:webview                  # in another terminal
open 'http://localhost:5173/?topology=real'

npm run shot:real artifacts/real.png # screenshot it, and count what was drawn
npx vite-node scripts/laneStats.ts   # measure lane count and gutter width
```

## Screenshotting the real thing

The harness cannot reach anything outside the webview — QuickPick menus, the
sidebar tree, the diff editor. VS Code is Electron, so Playwright can drive the
actual application:

```bash
npm run shot:vscode                  # the sample repository, every scene
npm run shot:vscode:multi            # a workspace holding several repositories
```

This is also how the README screenshots are produced, so they show the real UI
rather than a mock.

Two things the script has to work around, both documented inline: clicks inside the
webview need `force: true`, because Playwright resolves the element in a
doubly-nested Electron iframe and then wrongly reports it as invisible; and the
first click after the panel is composed is sometimes swallowed while VS Code
settles focus, so opening a QuickPick is retried.

## Checks

```bash
npm run check               # tsc (host + webview) + svelte-check + eslint
npm test                    # Vitest — domain, application, and real-git adapters
npm run test:visual         # Playwright — renders, interactions, screenshots
npm run test:integration    # two real VS Code sessions driving the real host
npm run shots               # refresh the committed screenshots only
```

### Why there are three tiers

1. **Vitest** — pure logic, plus adapters tested against **real temporary git
   repositories**. Not mocked stdout: a fixture only ever proves the parser agrees
   with whoever wrote it.
2. **Playwright** — the webview standalone, with committed screenshot baselines.
   Fast, but blind to anything outside the webview.
3. **`@vscode/test-electron`** — the real extension host. This tier exists because
   a comparison silently produced nothing in VS Code while passing in both others.
   Neither of the others could see it: one has no extension host, the other has no
   git.

Visual baselines live beside their specs in `tests/visual/*-snapshots/` and are
committed. A layout change shows up as both a failing assertion and a diffable
picture.

### Screenshots are committed twice

Every baseline exists as `<name>-darwin.png` and `<name>-linux.png`, because
contributors work on macOS and CI runs on `ubuntu-24.04`. `npm run shots` writes
only the platform you are on, so **a UI change passes locally and fails CI** until
the other half is updated.

The Playwright container is not a shortcut. `mcr.microsoft.com/playwright` renders
with a different font set from the runner's, and its baselines disagree with CI by
thousands of pixels — layout identical, text metrics not. Only the runner renders
what the runner will compare against.

So the loop for a change that moves a screenshot is:

1. `npm run shots` locally, and eyeball what changed.
2. Push, and let the visual job fail once.
3. Download the `visual-<run-id>` artifact from that run and copy its
   `*-actual.png` files over the matching `*-linux.png` baselines.
4. Push again.

One wrinkle: the artifact also contains `tests/visual/**/*.png`, and those are the
*committed* baselines rather than the new renders — useful only for a screenshot
that has no baseline yet, which Playwright writes rather than diffs. Everything
else comes from `*-actual.png`.

### Running two checkouts at once

Working in git worktrees means two checkouts want the same dev-server port and the
same integration fixtures. Both failures are silent — Playwright reuses whichever
dev server answers on the port and diffs *that* branch's rendering against *these*
baselines. `scripts/harness.ts` reads three environment variables so a worktree can
keep to itself; every default reproduces the single-checkout behaviour exactly.

| Variable | Default | Why set it |
| --- | --- | --- |
| `GITHAWK_DEV_PORT` | `5173` | One port per checkout. The dev server is `strictPort`, so a clash fails loudly instead of drifting to 5174. |
| `GITHAWK_INTEGRATION_DIR` | `$TMPDIR/githawk-integration-<checkout>` | Already unique per directory; override only to put the throwaway repositories somewhere specific. |
| `GITHAWK_VSCODE_CACHE` | `.vscode-test` in the checkout | Safe to share, and worth sharing — it is ~1.9 GB of downloaded VS Code per checkout. |

A `.env`-style export in each worktree is enough:

```bash
export GITHAWK_DEV_PORT=5181
export GITHAWK_VSCODE_CACHE=~/.cache/githawk/vscode-test
```

**Never let a test hook build its own version of what the UI builds.** That has
hidden a real bug twice here — most recently a branch menu whose test hook
assembled its own context, so a missing feature tested green. Intercept the real
code path instead.

## Fixtures

`src/infrastructure/fixtures/topologies.ts` holds named repository shapes, each
recording what it is meant to stress. Adding a hard graph case means adding one
entry there — it then flows into the harness, the unit tests, and the visual
snapshots at once.

## Releasing

Publishing is CI's job, not a laptop's — `.github/workflows/release.yml` is the
only thing holding a Marketplace token, and it runs all three test tiers on the
exact commit being published first. A version cannot be withdrawn once it is up,
only superseded, so the gate has to be on the commit rather than on whatever
happened to be in someone's working tree.

Two channels on one number line:

| Version | Channel | Triggered by |
| --- | --- | --- |
| `X.Y.0` | stable | pushing the tag `vX.Y.0` |
| `X.Y.<commits>` | pre-release | pushing to `main` |

Patch `0` is reserved for stable and every other patch is a pre-release build, so
no version is ever published on both channels — which the Marketplace forbids,
and enforces by refusing to reissue a version at all. The pre-release number is
the repository's commit count, and is never committed back to `main`: the commit
is the identity of a build, the number only has to sort.

Cutting a stable release means bumping `package.json` to `X.Y.0`, dating its
CHANGELOG section, and pushing the commit and its tag **together**:

```bash
git push --atomic origin main vX.Y.0
```

Atomically because the workflow checks whether `HEAD` carries a tag: it must not
see the commit arrive on `main` before the tag exists, or it will publish that
commit as a pre-release and take a number higher than the stable one, locking the
stable version out for good.

To try a build locally without publishing anything:

```bash
npm run package                      # check + test + build + vsix
```
