#!/usr/bin/env bash
#
# Builds a workspace holding several repositories at different depths, for
# exercising discovery and the repositoryScanDepth setting.
#
# The layout is deliberately awkward:
#
#   web/                  a repository one level down
#   apps/api/             two levels down — the common "folder of buckets" shape
#   apps/api/tools/       a repository nested inside another repository
#   tools/cli/            two levels down
#   tools/cli-wt/         a linked worktree of tools/cli, whose .git is a file
#   deep/a/b/service/     four levels down, past the default depth
#   node_modules/vendored/ a real repository nobody wants listed
#   .cache/hidden/        likewise, but hidden
#
# The workspace root is intentionally not a repository, so the container case is
# what gets tested.
#
#   ./scripts/makeMultiRepoSample.sh [target-dir]
#
set -euo pipefail

TARGET="${1:-/tmp/githawk-multi-sample}"

rm -rf "$TARGET"
mkdir -p "$TARGET"

# Creates a repository with one commit, whose file name identifies it — so a
# comparison proves which repository was actually read.
make_repo() {
  local path="$TARGET/$1" marker="$2"
  mkdir -p "$path"
  (
    cd "$path"
    git init --quiet --initial-branch=main
    git config user.name "Sample Author"
    git config user.email "sample@example.com"
    git config commit.gpgsign false
    printf '%s\n' "$marker" > "${marker}.txt"
    git add "${marker}.txt"
    git commit --quiet -m "feat: add ${marker}"
  )
}

make_repo web web-only
make_repo apps/api api-only
make_repo apps/api/tools nested-only
make_repo tools/cli cli-only
make_repo deep/a/b/service service-only
make_repo node_modules/vendored vendored-only
make_repo .cache/hidden hidden-only

# A linked worktree: its .git is a file containing a `gitdir:` pointer, which is
# the case a naive "is .git a directory?" check gets wrong.
git -C "$TARGET/tools/cli" worktree add --quiet "$TARGET/tools/cli-wt" -b worktree-branch

# A plain directory, to prove the scan tolerates one with nothing in it.
mkdir -p "$TARGET/docs/adr"

echo "Multi-repository workspace ready at $TARGET"
