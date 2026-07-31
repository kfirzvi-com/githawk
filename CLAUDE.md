# GitHawk — Claude Code Instructions

A git graph for VS Code: simple, fast, MIT, no AI and no telemetry. Built because Git Graph
is unmaintained and carries a problematic licence, and the maintained alternatives lean
heavily on AI.

Work is tracked in the Basecamp project **Product: GitHawk** (48334046).

## Architecture — four DDD tiers

```
domain/         no dependencies at all; runs in Node and in a browser
application/    use cases + the DTOs that cross the webview boundary
infrastructure/ adapters behind ports (git CLI, filesystem)
presentation/   host/ (the extension) + webview/ (Svelte 5 runes)
```

`domain` and `application` are bundled into **both** the host and the webview. Three rules,
all enforced by `eslint-plugin-boundaries` rather than by convention:

- **`vscode` may only be imported by `presentation/host` and `extension.ts`.** Everything
  else stays runnable in Node and in a browser. Lint fails otherwise.
- **Rows and lanes are domain concepts; pixels are not.** The layout service emits
  `{row, lane}`; coordinates live in `presentation/webview/viewmodels/graphGeometry.ts`.
- **Native UI wherever VS Code already has it.** Menus are QuickPicks, the file list is a
  `TreeView`, diffs open in the built-in diff editor. The webview draws the graph, which is
  the one thing VS Code cannot already do.

## Commands

```bash
npm run dev                 # host + webview watch
npm run check               # tsc (host + webview) + svelte-check + eslint
npm test                    # Vitest — domain, application, and real-git adapters
npm run test:visual         # Playwright against the standalone webview harness
npm run test:integration    # two real VS Code sessions driving the real extension host
npm run shot:vscode         # screenshot the real UI (also how README images are made)
npm run package             # check + test + build + vsce package
```

Sample repositories to work against — purpose-built, so break them freely:

```bash
./scripts/makeSampleRepo.sh       # one repo: branches, merges, tags, worktrees, dirty files
./scripts/makeMultiRepoSample.sh  # a workspace of repos at several depths
```

## Three test tiers, and why each exists

1. **Vitest** — pure logic, plus adapters against **real temporary git repositories**. Not
   mocked stdout: a fixture only ever proves the parser agrees with whoever wrote it.
2. **Playwright** — the webview standalone, with committed screenshot baselines. Fast, but
   it cannot see QuickPicks, the sidebar tree, or the diff editor.
3. **`@vscode/test-electron`** — the real extension host. This tier exists because a
   comparison silently produced nothing in VS Code while passing in both others.

**Never let a test hook build its own version of what the UI builds.** That has hidden a bug
twice here — most recently a branch menu whose test hook assembled its own context, so a
missing feature tested green. Intercept the real path instead.

## Conventions

- `feature/` branch prefixes; delete branches after merge; keep commits atomic.
- Git arguments are always an array passed to `execFile`, never a shell string: a cloned
  repository can contain a branch called `; rm -rf ~`.
- `--force` is emitted in exactly one place (`worktree remove`, after git has already
  refused and the user has confirmed a second, differently-worded question). Everywhere
  else git's refusal is the desired behaviour, not an obstacle.
- Destructive actions must state what will be lost; `PerformGitActionUseCase` refuses to run
  one that was not confirmed.
