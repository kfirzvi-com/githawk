#!/usr/bin/env bash
#
# Builds a throwaway repository with topology worth looking at: several branches,
# merges, tags, a long-running branch, a stale branch, a fake remote, and
# uncommitted work.
#
# Purpose-built rather than pointing at a real repository, because GitHawk can now
# reset --hard, delete branches, and rebase. Break this one freely.
#
#   ./scripts/makeSampleRepo.sh [target-dir]
#
set -euo pipefail

TARGET="${1:-/tmp/githawk-sample}"

rm -rf "$TARGET" "${TARGET}-remote"
mkdir -p "$TARGET"

# A bare repository stands in for a remote, so remote branches and ahead/behind
# states are real rather than simulated.
git init --quiet --bare "${TARGET}-remote"

cd "$TARGET"
git init --quiet --initial-branch=main
git config user.name "Sample Author"
git config user.email "sample@example.com"
git config commit.gpgsign false
git remote add origin "${TARGET}-remote"

commit() {
  local file="$1" message="$2" body="${3:-}"
  printf '%s\n' "${body:-$message}" >> "$file"
  git add "$file"
  git commit --quiet -m "$message"
}

# --- mainline ------------------------------------------------------------
commit README.md "Initial commit" "# Sample project"
commit README.md "docs: describe the project"
commit src.txt "feat: add the core module" "core module"
git tag v0.1.0

# --- a feature branch that merged ---------------------------------------
git checkout --quiet -b feature/login
commit login.txt "feat(login): add the login form"
commit login.txt "feat(login): validate the password field"
commit login.txt "test(login): cover the empty password case"
git checkout --quiet main
git merge --quiet --no-ff -m "Merge branch 'feature/login'" feature/login

commit src.txt "refactor: extract the request helper"
git tag v0.2.0

# --- two branches alive at the same time, so lanes overlap --------------
git checkout --quiet -b feature/reporting
commit reporting.txt "feat(reporting): scaffold the report builder"
commit reporting.txt "feat(reporting): add CSV output"

git checkout --quiet main
git checkout --quiet -b bugfix/timezone
commit timezone.txt "fix(timezone): stop assuming UTC"

git checkout --quiet main
git merge --quiet --no-ff -m "Merge branch 'bugfix/timezone'" bugfix/timezone
git branch --quiet -d bugfix/timezone

commit src.txt "chore: bump dependencies"

# --- a stale branch left behind ----------------------------------------
git checkout --quiet -b spike/graphql
commit spike.txt "spike: try GraphQL for the reporting API"
git checkout --quiet main

# --- publish, so remote branches exist ---------------------------------
git push --quiet --set-upstream origin main >/dev/null 2>&1
git push --quiet origin feature/reporting >/dev/null 2>&1
git push --quiet origin --tags >/dev/null 2>&1

# --- an in-progress feature: several commits plus uncommitted work ------
# This is the branch to try "Review branch…" on.
git checkout --quiet feature/reporting
commit reporting.txt "feat(reporting): add PDF output"
commit reporting.txt "refactor(reporting): share the column formatter"
commit README.md "docs: mention the reporting module"

# Uncommitted: one staged change, one unstaged, one untracked.
printf 'work in progress\n' >> reporting.txt
printf 'staged change\n' >> src.txt
git add src.txt
printf 'scratch notes\n' > notes.txt

echo
echo "Sample repository ready at $TARGET"
echo "  branch:      $(git rev-parse --abbrev-ref HEAD)"
echo "  commits:     $(git rev-list --count --all)"
echo "  branches:    $(git for-each-ref --format='%(refname:short)' refs/heads refs/remotes | tr '\n' ' ')"
echo "  tags:        $(git tag | tr '\n' ' ')"
echo "  uncommitted: staged src.txt, unstaged reporting.txt, untracked notes.txt"
echo
echo "Try: Review branch… against main (feature/reporting is 3 commits ahead)"
