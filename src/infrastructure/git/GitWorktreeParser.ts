import { Worktree } from '../../domain/models/Worktree';

/**
 * Parses `git worktree list --porcelain`.
 *
 * The format is one attribute per line, records separated by a blank line:
 *
 *     worktree /path/to/main
 *     HEAD 3dd42171…
 *     branch refs/heads/main
 *
 *     worktree /path/to/linked
 *     HEAD 3dd42171…
 *     detached
 *     locked on a usb stick
 *     prunable gitdir file points to non-existent location
 *
 * `bare`, `detached`, `locked`, and `prunable` are flags; the last two may carry
 * a reason on the same line. The first record is always the main worktree.
 *
 * Known limitation: plain `--porcelain` does not quote paths, so a path
 * containing a newline is unparseable. Git offers `-z` for that case, added in
 * 2.36 — not used here, because the failure it guards against needs a directory
 * name with a newline in it.
 */
export const GitWorktreeParser = {
    /**
     * @param currentPath `git rev-parse --show-toplevel` for the directory being
     * read. Both sides then come from git, so the comparison is not defeated by
     * a symlinked path — on macOS the workspace's `/tmp` is git's `/private/tmp`.
     */
    parse(stdout: string, currentPath?: string): Worktree[] {
        const worktrees: Worktree[] = [];

        for (const record of splitRecords(stdout)) {
            const parsed = parseRecord(record, {
                // Git lists the main worktree first, always.
                isMain: worktrees.length === 0,
                currentPath,
            });
            if (parsed) {
                worktrees.push(parsed);
            }
        }

        return worktrees;
    },
};

function splitRecords(stdout: string): string[][] {
    const records: string[][] = [];
    let current: string[] = [];

    for (const raw of stdout.split('\n')) {
        const line = raw.replace(/\r$/, '');
        if (line.trim().length === 0) {
            if (current.length > 0) {
                records.push(current);
                current = [];
            }
            continue;
        }
        current.push(line);
    }

    if (current.length > 0) {
        records.push(current);
    }

    return records;
}

function parseRecord(
    lines: string[],
    context: { isMain: boolean; currentPath?: string }
): Worktree | null {
    let path: string | undefined;
    let head: string | undefined;
    let branch: string | undefined;
    let isBare = false;
    let isLocked = false;
    let lockReason: string | undefined;
    let isPrunable = false;
    let prunableReason: string | undefined;

    for (const line of lines) {
        const [keyword, ...rest] = line.split(' ');
        const value = rest.join(' ').trim();

        switch (keyword) {
            case 'worktree':
                path = value;
                break;
            case 'HEAD':
                head = value;
                break;
            case 'branch':
                // Always a full ref path here, unlike %(refname:short).
                branch = value.startsWith('refs/heads/')
                    ? value.slice('refs/heads/'.length)
                    : value;
                break;
            case 'bare':
                isBare = true;
                break;
            case 'detached':
                // Represented by the absence of a branch, so nothing to record.
                break;
            case 'locked':
                isLocked = true;
                lockReason = value || undefined;
                break;
            case 'prunable':
                isPrunable = true;
                prunableReason = value || undefined;
                break;
            default:
                // Unknown attributes are ignored rather than fatal: git has
                // added to this format before and may again.
                break;
        }
    }

    if (!path) {
        return null;
    }

    return new Worktree({
        path,
        head,
        branch,
        isBare,
        isMain: context.isMain,
        isCurrent: context.currentPath !== undefined && path === context.currentPath,
        isLocked,
        lockReason,
        isPrunable,
        prunableReason,
    });
}
