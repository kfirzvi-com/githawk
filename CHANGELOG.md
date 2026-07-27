# Changelog

All notable changes to GitHawk are documented here, following
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

Alpha. Reads real repositories; branch actions are not implemented.

### Added

- Reads real repositories through the git CLI: commits across all refs, parent
  topology, branches, tags, and the checked-out branch.
- Topological commit ordering with date as the tiebreaker, so rebased and
  cherry-picked history no longer draws a parent above its child.
- The checked-out branch claims lane 0, so repositories on `master` or any other
  default get a spine.
- `gitHawk.commitLimit` setting (default 500) and a truncation notice when older
  history exists.
- `GitHawk: Refresh Git Graph` command; the graph also reloads when the
  workspace folders or the setting change.
- Commit graph with lane assignment and merge rendering, laid out in a
  dependency-free domain service.
- Branch list, commit details panel, and toolbar shell.
- Standalone webview harness with named repository topologies, plus a mode that
  renders a dump of a real repository, so the UI can be developed and
  screenshotted without launching VS Code.
- Playwright coverage: render counts, commit selection, and committed screenshot
  baselines at two widths.

- Lane reuse: a lane is released as soon as its branch delivers, so lane count
  follows how many branches are open at the same row rather than how many the
  repository has. On a 49-branch repository this went from 23 lanes to 4, and the
  graph gutter from 644px to 112px.
- Branch filter, shown once a repository has more than eight branches.
- Inline ref badges on the graph, distinguishing the checked-out branch, local
  branches, remote branches, tags, and a detached HEAD. Refs are a structured
  domain type rather than bare strings, so a tag named `release` is no longer
  indistinguishable from the branch `release`.

### Known limitations
- Colours are dark-theme oriented and do not yet follow the active VS Code theme.
- Branch actions (checkout, merge, rebase, cherry-pick…) show a placeholder.
- No row virtualisation, so a large `commitLimit` will be slow to render.
- Multi-root workspaces show the first folder's repository only.
