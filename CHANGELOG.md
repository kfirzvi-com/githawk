# Changelog

All notable changes to GitHawk are documented here, following
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

Alpha. Reads real repositories and performs branch actions.

### Added

- Reads real repositories through the git CLI: commits across all refs, parent
  topology, branches, tags, and the checked-out branch.
- Topological commit ordering with date as the tiebreaker, so rebased and
  cherry-picked history no longer draws a parent above its child.
- Lane reuse: a lane is released as soon as its branch delivers, so lane count
  follows how many branches are open at the same row rather than how many the
  repository has. On a 49-branch repository this went from 23 lanes to 4, and the
  graph gutter from 644px to 112px.
- The checked-out branch claims lane 0, so repositories on `master` or any other
  default get a spine.
- Inline ref badges on the graph, distinguishing the checked-out branch, local
  branches, remote branches, tags, and a detached HEAD. Refs are a structured
  domain type rather than bare strings, so a tag named `release` is no longer
  indistinguishable from the branch `release`.
- Git actions, presented through VS Code's own QuickPick and modal dialogs:
  - On a commit: create branch here, create tag here, check out (detached),
    cherry-pick, revert, reset (soft / mixed / hard), copy hash, delete a tag.
  - On a branch: check out, check out a remote as a tracking branch, merge into
    the current branch, rebase the current branch onto it, delete.
  - On the toolbar: fetch (with prune), pull, push.
  - Destructive actions require modal confirmation stating what will be lost, and
    the use case refuses to run one that was not confirmed.
- Changed files appear as a folder tree in the primary sidebar, with git's own
  status letters and colours, per-directory file counts, and markdown tooltips.
  Selecting commits fills it automatically; clicking a file opens VS Code's diff
  editor. The graph panel shows the same comparison's totals, method, and included
  commits.
- Full commit details for a single selection: subject and body kept distinct with
  the author's own line breaks preserved, author name and email, relative and
  absolute dates, the full hash with a copy action, clickable parents, ref badges,
  and merge/root markers. A commit whose committer differs from its author says so,
  which is what explains dates that otherwise look wrong after a rebase.
- Review a whole branch as one changeset, from a branch's context menu, measured
  **from the merge base** so work that landed on the base after you branched is
  not shown as though you had reverted it. Uncommitted work is included.
- Compare any two revisions directly — branch, tag, commit, or working tree — with
  no requirement that either side involves HEAD.
- Review several selected commits together. Cmd/Ctrl-click to pick individual
  commits, Shift-click for a contiguous run. A contiguous run is a true range
  diff; a scattered selection has no single "before" state in git, so its combined
  effect is reconstructed by replaying the commits onto their common ancestor in a
  temporary worktree. Which method was used is always stated, and commits that
  could not be combined are listed rather than silently dropped.
- Update a branch you are not standing on. A branch behind its upstream offers
  "Update from origin/…", which fast-forwards the ref via a refspec fetch —
  without checking it out and without touching your working tree. Diverged
  branches say so instead, since advancing one needs a merge or rebase.
  `GitHawk: Update All Branches From Upstream` does every eligible branch at once.
- Ahead/behind indicators in the branch list (↓3, ↑2, or "gone"), so which
  branches need attention is visible without opening anything.
- Delete a remote branch, and rename a local one.
- Branch and commit menus are grouped by topic rather than being one flat list.
- Branch filter, shown once a repository has more than eight branches.
- `gitHawk.commitLimit` setting (default 500) and a truncation notice when older
  history exists.
- `GitHawk: Refresh Git Graph` command; the graph also reloads when the
  workspace folders or the setting change.
- Standalone webview harness with named repository topologies, plus a mode that
  renders a dump of a real repository, so the UI can be developed and
  screenshotted without launching VS Code.
- Playwright coverage: render counts, commit selection, and committed screenshot
  baselines at two widths.

### Known limitations

- Colours are dark-theme oriented and do not yet follow the active VS Code theme.
- No row virtualisation, so a large `commitLimit` will be slow to render.
- Multi-root workspaces show the first folder's repository only.
- A merge or rebase that conflicts leaves the repository mid-operation; GitHawk
  reports git's message but offers no conflict resolution or abort.
- A reconstructed comparison's combined commit is unreferenced, so `git gc` can
  eventually prune it and stale diffs may fail to open.
