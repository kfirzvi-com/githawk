import { WorkingTreeStatus, describeWorkingTree } from './WorkingTreeStatus';

/**
 * One repository at a glance: where HEAD is, how it stands against its
 * upstream, and how much is uncommitted.
 *
 * What the Repositories view lists for every repository in the workspace, so
 * it is deliberately everything a single `git status` can answer and nothing
 * that needs the log.
 */
export interface RepositorySummary {
    /**
     * The branch, or the short hash when HEAD is detached. Undefined only when
     * git names neither — a repository whose HEAD cannot be read.
     */
    head?: string;
    detached: boolean;
    /** The branch has no commit yet. */
    unborn: boolean;
    /** `origin/main`, when the branch tracks one. */
    upstream?: string;
    /** Commits on the branch that the upstream does not have. */
    ahead: number;
    /** Commits on the upstream that the branch does not have. */
    behind: number;
    status: WorkingTreeStatus;
    /**
     * Distinct files with anything uncommitted. Not the sum of the status
     * counts: a file staged and then edited again is one file to look at,
     * though it is two things to commit.
     */
    changedFiles: number;
}

/** Anything uncommitted at all. Ahead and behind are not changes: they are already commits. */
export function hasUncommittedChanges(summary: RepositorySummary): boolean {
    return summary.changedFiles > 0;
}

/**
 * The row's one line: `main · 4 changed · ↑1 ↓2`. Every part after the branch
 * appears only when there is something to say.
 */
export function describeSummary(summary: RepositorySummary): string {
    const parts = [summary.head ?? 'unknown HEAD'];

    if (summary.changedFiles > 0) {
        const conflicted = summary.status.conflicted;
        parts.push(
            conflicted > 0
                ? `${summary.changedFiles} changed, ${conflicted} conflicted`
                : `${summary.changedFiles} changed`
        );
    }

    const sync = describeSync(summary);
    if (sync) {
        parts.push(sync);
    }

    return parts.join(' · ');
}

/** `↑1 ↓2`, `↑1`, or nothing when the branch is level with its upstream. */
export function describeSync(summary: RepositorySummary): string {
    const arrows: string[] = [];
    if (summary.ahead > 0) {
        arrows.push(`↑${summary.ahead}`);
    }
    if (summary.behind > 0) {
        arrows.push(`↓${summary.behind}`);
    }
    return arrows.join(' ');
}

/**
 * The hover: each fact on its own line, in words rather than arrows, for a
 * reader who has not learned what the arrows mean.
 */
export function explainSummary(summary: RepositorySummary): string[] {
    const lines: string[] = [];

    if (summary.detached) {
        lines.push(`HEAD is detached at ${summary.head}`);
    } else if (summary.unborn) {
        lines.push(`On ${summary.head}, which has no commits yet`);
    } else {
        lines.push(`On ${summary.head ?? 'an unknown branch'}`);
    }

    if (summary.upstream) {
        const level = summary.ahead === 0 && summary.behind === 0;
        const parts: string[] = [];
        if (summary.ahead > 0) {
            parts.push(`${summary.ahead} ${plural(summary.ahead, 'commit')} to push`);
        }
        if (summary.behind > 0) {
            parts.push(`${summary.behind} ${plural(summary.behind, 'commit')} to pull`);
        }
        lines.push(
            level
                ? `Up to date with ${summary.upstream}`
                : `${parts.join(', ')} (${summary.upstream})`
        );
    } else if (!summary.detached && !summary.unborn) {
        lines.push('Not tracking a remote branch');
    }

    lines.push(
        summary.changedFiles > 0
            ? `${summary.changedFiles} ${plural(summary.changedFiles, 'file')} changed: ${describeWorkingTree(summary.status)}`
            : 'Nothing uncommitted'
    );

    return lines;
}

function plural(count: number, word: string): string {
    return count === 1 ? word : `${word}s`;
}
