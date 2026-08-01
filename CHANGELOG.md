# Changelog

All notable changes to GitHawk are documented here, following
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- The graph reloads by itself when the repository changes. A commit, checkout,
  fetch, rebase, or stash made in a terminal, in VS Code's own Source Control
  view, or by a tool running in a worktree now reaches the panel without pressing
  Refresh. GitHawk watches git's metadata — `HEAD`, `refs`, `packed-refs`, the
  index, and the in-progress operation markers — in both the per-worktree and the
  shared git directory, so a commit made in another worktree of the same
  repository counts too. Writes are coalesced, so one rebase is one reload rather
  than one per replayed commit. Turn it off with `gitHawk.autoRefresh`.
- A reload keeps your place: the row at the top of the viewport stays there
  rather than sliding down as new commits arrive above it, and a selected commit
  that no longer exists after an amend or a rebase is dropped rather than left
  describing history that has gone.

## [0.2.0] — 2026-07-31

First public release, marked **Preview** on the Marketplace. Everything listed
here works and is covered by tests; the known limitations at the bottom are the
reason it is a preview rather than a 1.0.

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
- Worktree management, aimed at the reason worktrees stay niche: git's refusals
  name a path without explaining the rule.
  - A branch checked out in another worktree is badged in the branch list, and
    its menu offers **Open the worktree** in place of a **Check out** that git
    would refuse. This costs nothing extra to know — `%(worktreepath)` rides
    along on the branch listing already being run.
  - A **Worktrees** section in the sidebar once there is more than one, showing
    what each has checked out and flagging `locked` and `missing`. Names are
    shortened against the repository's own directory, so `gitgrit-readme` reads
    as `readme` rather than truncating the branch beside it.
  - `GitHawk: Manage Worktrees` — create, open, lock, remove, and prune. Creating
    one suggests a sibling of the repository named after the branch, which keeps
    it out of its own parent's `git status` and inside the repository scan's reach.
  - Removing asks twice, and the second question is its own: git refuses a
    worktree holding uncommitted or untracked files, and overriding that destroys
    work that exists nowhere else.
  - A worktree whose directory is gone is reported as `missing` with a prune
    entry, because git keeps refusing its branch until the record is cleared.
- Per-worktree launchers: open a new VS Code window, open a terminal, or start an
  AI CLI there — Claude Code, Codex, Gemini CLI, and opencode by default, via the
  `gitHawk.aiTools` setting. `GitHawk: Start An AI CLI Here` covers the current
  repository. The directory is passed as the terminal's `cwd` rather than sent as
  a `cd`, so a path with spaces or quotes is never interpreted by a shell.
- Multi-repository workspaces. Every opened folder is searched for git working
  trees, to `gitHawk.repositoryScanDepth` levels (default 2). The toolbar names
  the repository being shown and opens a picker; `GitHawk: Switch Repository`
  does the same from the palette, and accepts a path so it can be scripted.
  - The search skips dot-directories and heavy build directories such as
    `node_modules`, and does not follow symlinks, so raising the depth is cheap.
  - It does not stop at a repository, so submodules, linked worktrees (whose
    `.git` is a file), and repositories nested inside a monorepo are all found.
  - Switching moves the graph, branch actions, and comparisons with it, and
    clears the Changes tree rather than leaving it describing the previous
    repository. The choice is remembered per workspace.
  - The picker offers a rescan, with a gear that jumps to the depth setting.
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
- One repository is shown at a time; there is no combined view across several.
- Repositories are found by scanning on load, not watched, so one cloned while
  the window is open needs a refresh or the picker's "Search again".
- `git worktree move` is not offered; move a worktree from the command line.
- Worktree paths containing a newline cannot be read, because plain
  `--porcelain` does not quote them. Git's `-z` form would fix it and is not used.
- Starting an AI CLI does not check that it is installed; the shell reports it.
- A merge or rebase that conflicts leaves the repository mid-operation; GitHawk
  reports git's message but offers no conflict resolution or abort.
- A reconstructed comparison's combined commit is unreferenced, so `git gc` can
  eventually prune it and stale diffs may fail to open.
