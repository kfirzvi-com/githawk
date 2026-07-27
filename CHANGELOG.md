# Changelog

All notable changes to GitHawk are documented here, following
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

Pre-alpha. The graph renders from fixtures; there is no git adapter yet, so this
is not yet usable against a real repository.

### Added

- Commit graph with lane assignment and merge rendering, laid out in a
  dependency-free domain service.
- Branch list, commit details panel, and toolbar shell.
- Standalone webview harness with named repository topologies, so the UI can be
  developed and screenshotted without launching VS Code.
- Playwright coverage: render counts, commit selection, and committed screenshot
  baselines at two widths.

### Known limitations

- Commits are ordered by timestamp rather than topologically, so histories
  containing rebases or skewed clocks can draw a parent above its child.
- Branch and tag refs appear only in the details panel, not inline on the graph.
- Colours are dark-theme oriented and do not yet follow the active VS Code theme.
- No commit paging or row virtualisation; large histories will be slow.
