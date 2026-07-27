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

> Status: alpha. Reads real repositories and draws the graph. Branch actions
> (checkout, merge, rebase…) are not implemented, and the layout still allocates
> one lane per branch without reusing freed lanes, so repositories with many
> branches render wider than they should.

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

### Checks

```bash
npm test                    # Vitest — domain + application
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
