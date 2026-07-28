#!/usr/bin/env bash
#
# Builds a throwaway repository worth looking at: a nested source tree, several
# branches, merges, tags, a stale branch, a fake remote, multi-line commit
# messages, a binary file, a rename, and uncommitted work.
#
# Purpose-built rather than pointing at a real repository, because GitHawk can
# reset --hard, delete branches, and rebase. Break this one freely.
#
#   ./scripts/makeSampleRepo.sh [target-dir]
#
set -euo pipefail

TARGET="${1:-/tmp/githawk-sample}"

rm -rf "$TARGET" "${TARGET}-remote" "${TARGET}-handbook" "${TARGET}-abandoned"
mkdir -p "$TARGET"

# A bare repository stands in for a remote, so remote branches are real rather
# than simulated.
git init --quiet --bare "${TARGET}-remote"

cd "$TARGET"
git init --quiet --initial-branch=main
git config user.name "Sample Author"
git config user.email "sample@example.com"
git config commit.gpgsign false
git remote add origin "${TARGET}-remote"

# Writes a file, creating its directories, then stages it.
stage() {
  local path="$1" contents="$2"
  mkdir -p "$(dirname "$path")"
  printf '%s\n' "$contents" >> "$path"
  git add "$path"
}

commit() {
  git commit --quiet -m "$1"
}

# A multi-line message, so the details panel has a body to render.
commit_with_body() {
  git commit --quiet -F -
}

# --- mainline: a nested source tree, so the Changes view has depth ------
stage README.md "# Sample project"
stage src/core/index.ts "export const version = '0.1.0';"
stage src/core/config.ts "export const defaults = {};"
commit "Initial commit"

stage src/core/request.ts "export function request() {}"
stage src/core/response.ts "export function respond() {}"
stage docs/architecture.md "## Architecture"
commit "feat(core): add the request pipeline"
git tag v0.1.0

# --- a feature branch that merged, touching several directories --------
git checkout --quiet -b feature/login
stage src/features/login/form.ts "export const LoginForm = {};"
stage src/features/login/validate.ts "export function validate() {}"
stage tests/features/login/form.test.ts "test('renders', () => {});"
commit "feat(login): add the login form"

stage src/features/login/validate.ts "export function validatePassword() {}"
stage docs/guides/login.md "## Signing in"
commit "feat(login): validate the password field"

git checkout --quiet main
git merge --quiet --no-ff -m "Merge branch 'feature/login'" feature/login

stage src/core/request.ts "// retries"
commit "refactor(core): extract the retry helper"
git tag v0.2.0

# --- two branches alive at once, so lanes overlap ----------------------
git checkout --quiet -b feature/reporting
stage src/features/reporting/builder.ts "export const ReportBuilder = {};"
stage src/features/reporting/formats/csv.ts "export function toCsv() {}"
stage tests/features/reporting/builder.test.ts "test('builds', () => {});"
commit "feat(reporting): scaffold the report builder"

git checkout --quiet main
git checkout --quiet -b bugfix/timezone
stage src/core/time.ts "export function nowUtc() {}"
commit "fix(timezone): stop assuming UTC"

git checkout --quiet main
git merge --quiet --no-ff -m "Merge branch 'bugfix/timezone'" bugfix/timezone
git branch --quiet -d bugfix/timezone

stage package.json '{ "name": "sample" }'
commit "chore: bump dependencies"

# --- a stale branch left behind ----------------------------------------
git checkout --quiet -b spike/graphql
stage src/spikes/graphql/schema.ts "export const schema = {};"
commit "spike: try GraphQL for the reporting API"
git checkout --quiet main

# --- publish, with tracking, so upstream state is real ------------------
git push --quiet --set-upstream origin main >/dev/null 2>&1
git push --quiet --set-upstream origin feature/reporting >/dev/null 2>&1
git push --quiet --set-upstream origin feature/login >/dev/null 2>&1
git push --quiet --set-upstream origin spike/graphql >/dev/null 2>&1
git push --quiet origin --tags >/dev/null 2>&1

# Acts as a colleague: commits to a branch on the remote and pushes.
advance_remote() {
  local branch="$1" message="$2"
  local scratch
  scratch="$(mktemp -d)"
  git clone --quiet "${TARGET}-remote" "$scratch"
  git -C "$scratch" config user.name "Colleague"
  git -C "$scratch" config user.email "colleague@example.com"
  git -C "$scratch" checkout --quiet "$branch"
  printf 'their work\n' >> "$scratch/collab.txt"
  git -C "$scratch" add collab.txt
  git -C "$scratch" commit --quiet -m "$message"
  git -C "$scratch" push --quiet origin "$branch"
  rm -rf "$scratch"
}

# main is purely behind — the case that can be fast-forwarded without a checkout.
advance_remote main "chore: tidy the changelog"

# feature/login is behind AND ahead, so it has diverged and cannot be advanced.
advance_remote feature/login "docs: note the login flow"
git checkout --quiet feature/login
stage src/features/login/form.ts "// local tweak"
commit "style(login): tidy the form"
git checkout --quiet main

# spike/graphql's upstream is deleted, so it shows as gone.
git push --quiet origin --delete spike/graphql >/dev/null 2>&1

# One fetch so all of the above is visible locally.
git fetch --quiet --all --prune >/dev/null 2>&1

# --- the branch to review: several commits across many directories ------
git checkout --quiet feature/reporting

stage src/features/reporting/formats/pdf.ts "export function toPdf() {}"
stage src/features/reporting/formats/html.ts "export function toHtml() {}"
commit "feat(reporting): add PDF and HTML output"

# A rename and a deletion of files that existed BEFORE this branch, so the diff
# against main shows R and D badges. Renaming a file created on this same branch
# would net out as a plain addition, which is not what we want to demonstrate.
git mv src/core/response.ts src/core/httpResponse.ts
# architecture.md predates this branch, unlike time.ts which arrived on main via
# a merge after the branch point and so is not present here at all.
git rm --quiet docs/architecture.md
git mv src/features/reporting/builder.ts src/features/reporting/reportBuilder.ts
stage src/features/reporting/columns.ts "export function widths() {}"
commit "refactor: rename response, drop the stale architecture note"

# A binary file, so the tree shows one with no line counts.
mkdir -p docs/images
printf '\x89PNG\r\n\x1a\n\x00\x01\x02\x03\xff\xfe' > docs/images/screenshot.png
git add docs/images/screenshot.png
stage docs/guides/reporting.md "## Reports"
commit "docs(reporting): document the formats"

stage src/features/reporting/schedule.ts "export function schedule() {}"
stage tests/features/reporting/schedule.test.ts "test('schedules', () => {});"
commit_with_body <<'MSG'
feat(reporting): add scheduled exports

Adds a scheduler so reports can be emailed on a cadence:

  - daily and weekly cadences
  - a per-recipient timezone
  - retries with backoff when SMTP is unavailable

The scheduler deliberately does not persist state yet; a restart
re-reads the configuration and rebuilds the queue.

Reviewed-by: Someone Else
Refs: #412
MSG

# --- worktrees: one live, one abandoned ---------------------------------
#
# Both states matter. The live one is why a branch shows as checked out
# elsewhere and cannot be checked out here. The abandoned one — directory
# deleted by hand, record left behind — is the state that wastes people's
# time, because git keeps refusing the branch until the record is pruned.
git worktree add --quiet "${TARGET}-handbook" -b docs/handbook
git worktree add --quiet "${TARGET}-abandoned" -b spike/abandoned
rm -rf "${TARGET}-abandoned"

# --- uncommitted work: staged, unstaged, and untracked ------------------
printf 'work in progress\n' >> src/features/reporting/schedule.ts
printf 'staged change\n' >> src/core/config.ts
git add src/core/config.ts
mkdir -p notes
printf 'scratch notes\n' > notes/todo.md

echo
echo "Sample repository ready at $TARGET"
echo "  branch:      $(git rev-parse --abbrev-ref HEAD)"
echo "  commits:     $(git rev-list --count --all)"
echo "  directories: $(git ls-files | sed 's|/[^/]*$||' | sort -u | wc -l | tr -d ' ') distinct"
echo "  branches:    $(git for-each-ref --format='%(refname:short)' refs/heads refs/remotes | tr '\n' ' ')"
echo "  tags:        $(git tag | tr '\n' ' ')"
echo "  uncommitted: staged src/core/config.ts, unstaged schedule.ts, untracked notes/todo.md"
echo "  worktrees:"
git worktree list | sed 's/^/    /'
echo
echo "  upstream states, so every branch-menu path is reachable:"
git for-each-ref --format='    %(refname:short) -> %(upstream:short) [%(upstream:track,nobracket)]' refs/heads
echo
echo "Try: click a branch → \"Review my work against main\" — 4 commits across"
echo "     src/features/reporting, tests/, and docs/, plus a rename and a binary."
