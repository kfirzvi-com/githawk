/**
 * Command construction, kept pure so the exact arguments can be asserted in
 * tests without spawning anything.
 *
 * Fields are separated by ASCII US (0x1f) and records by ASCII RS (0x1e).
 * Newlines are unusable as separators because a commit subject can contain
 * almost anything; these two control characters cannot appear in a ref name and
 * will not survive into a subject in practice.
 *
 * Built from char codes deliberately. A literal control character here is
 * invisible in every editor and diff, survives refactoring only by luck, and its
 * failure mode is a parser that silently returns zero commits.
 */
export const UNIT_SEPARATOR = String.fromCharCode(0x1f);
export const RECORD_SEPARATOR = String.fromCharCode(0x1e);

/**
 * hash, parents, author name, author email, author date, committer name,
 * committer date, ref decorations, then the raw message.
 *
 * `%B` is last on purpose: it is the only field that can contain newlines, and
 * keeping it at the end means a multi-line message cannot be mistaken for the
 * start of another field. Records are still delimited by RS, so newlines inside
 * it are harmless.
 */
export const LOG_FORMAT =
    ['%H', '%P', '%an', '%ae', '%aI', '%cn', '%cI', '%D', '%B'].join('%x1f') +
    '%x1e';

export interface LogOptions {
    /** Maximum commits to display. One extra is requested so truncation is detectable. */
    limit: number;
}

export function logArgs({ limit }: LogOptions): string[] {
    return [
        'log',
        /*
         * `--all` means every ref under `refs/`, and `refs/stash` is one — so
         * without this the top stash entry arrives as an ordinary commit, and
         * so does the snapshot of the index that git hangs off it as a second
         * parent. That snapshot is a commit nobody wrote, drawn as a merge that
         * never happened.
         *
         * Excluded here so the stash is added deliberately instead, from the
         * stash list, which is also the only way to reach the older entries:
         * only stash@{0} is a ref at all.
         *
         * `--exclude` applies to the `--all` that follows it, so the order
         * matters.
         */
        '--exclude=refs/stash',
        // Every ref, not just HEAD — a graph showing one branch is not a graph.
        '--all',
        // Parents before children within the page git returns.
        '--topo-order',
        '--no-color',
        // Full ref paths in %D, so a branch, a tag, and a remote are
        // distinguishable. Short names alone cannot tell `v1.0` from `main`.
        '--decorate=full',
        // One extra distinguishes "exactly `limit` commits" from "more exist".
        `--max-count=${limit + 1}`,
        `--format=${LOG_FORMAT}`,
    ];
}

export function branchArgs(): string[] {
    return [
        'for-each-ref',
        // `upstream:track,nobracket` yields "ahead 2, behind 3", "gone", or
        // nothing — which is how a branch's relationship to its remote is read
        // without a second command per branch.
        //
        // `worktreepath` is the working tree holding the branch, empty when it
        // is not checked out anywhere. It comes free with this command, which is
        // why the graph does not need to list worktrees separately just to know
        // that a checkout would be refused.
        [
            '--format=%(refname)',
            '%(objectname)',
            '%(HEAD)',
            '%(upstream:short)',
            '%(upstream:track,nobracket)',
            '%(worktreepath)',
        ].join(UNIT_SEPARATOR),
        'refs/heads',
        'refs/remotes',
    ];
}

export function worktreeListArgs(): string[] {
    return ['worktree', 'list', '--porcelain'];
}

export function repositoryRootArgs(): string[] {
    return ['rev-parse', '--show-toplevel'];
}

/**
 * The per-worktree git directory and the shared one, in that order, one per
 * line. They differ only in a linked worktree — see GitDirectories.
 *
 * `--path-format=absolute` because `--git-common-dir` is otherwise relative to
 * the working directory, and a watcher needs a path it can hand to the
 * filesystem rather than one that depends on where git happened to run.
 */
export function gitDirectoriesArgs(): string[] {
    return ['rev-parse', '--path-format=absolute', '--git-dir', '--git-common-dir'];
}

/** `-v` rather than a bare list: without it git prints names and no URLs. */
export function remoteListArgs(): string[] {
    return ['remote', '-v'];
}

/**
 * Counts, not contents — the file list comes from the comparison machinery.
 *
 * `-z` because a path may contain a newline, which git otherwise handles by
 * quoting the path, giving a second format to parse. `--untracked-files=normal`
 * is stated rather than assumed: `status.showUntrackedFiles=no` in a user's
 * config would otherwise silently drop them from the count.
 */
export function statusArgs(): string[] {
    return ['status', '--porcelain', '-z', '--untracked-files=normal'];
}

/**
 * The stash, most recent first.
 *
 * `%gd` is the `stash@{n}` selector, `%H` the commit the entry is, `%gs` git's
 * reflog subject — which is where the branch and the message live — and `%aI`
 * when it was made. Separated by the same control characters the log uses, for
 * the same reason: a stash message can contain anything a person can type.
 */
export function stashListArgs(): string[] {
    return [
        'stash',
        'list',
        `--format=%gd${UNIT_SEPARATOR}%H${UNIT_SEPARATOR}%gs${UNIT_SEPARATOR}%aI${UNIT_SEPARATOR}%an${UNIT_SEPARATOR}%P${RECORD_SEPARATOR}`,
    ];
}

/**
 * Who last touched each line of one file.
 *
 * `--porcelain` rather than the human format: it reports each commit's details
 * once and then refers back to it, which is both cheaper on a large file and
 * unambiguous — the human format packs author, date and line into one string
 * that a name containing a bracket can break.
 *
 * `--` before the path so a file called `-f` is a file rather than a flag.
 */
export function blameArgs(
    path: string,
    options: { fromStdin?: boolean; rev?: string } = {}
): string[] {
    return [
        'blame',
        '--porcelain',
        /*
         * Blaming a revision rather than the working tree, which is what the
         * historical side of a diff is showing. Mutually exclusive with
         * --contents by nature: a revision's content is not on stdin.
         */
        ...(options.rev !== undefined ? [options.rev] : []),
        /*
         * `--contents -` blames the content on stdin instead of the file on
         * disk, which is what makes an editor with unsaved changes report
         * honestly: lines the buffer has and no commit does come back as
         * uncommitted, and everything below them keeps its real author rather
         * than being shifted by the edit.
         */
        ...(options.fromStdin ? ['--contents', '-'] : []),
        '--',
        path,
    ];
}
