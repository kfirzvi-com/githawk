import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GitRunner } from './GitRunner';

export interface ReplayResult {
    /** Common ancestor the selection was replayed onto. */
    baseRev: string;
    /** Commit holding all successfully applied changes. */
    resultRev: string;
    worktreePath: string;
    skipped: { hash: string; reason: string }[];
    dispose: () => Promise<void>;
}

/**
 * Reconstructs "what do these commits change, together?" for an arbitrary,
 * possibly non-contiguous selection.
 *
 * Git cannot answer this directly. A contiguous run has a well-defined before and
 * after, but an arbitrary set does not: if you pick the 1st and 3rd commits of a
 * branch, there is no revision in history where exactly those two are applied.
 * Concatenating their individual patches is not the answer either — a file touched
 * by both would be counted twice, and the result would not be a valid diff.
 *
 * So the selection is replayed onto its common ancestor in a **separate git
 * worktree**, and the aggregate is the diff of that. The real working tree, index,
 * and HEAD are never touched, so this is safe to run mid-work.
 *
 * The resulting commit lives in the shared object database, so it stays readable
 * for the diff editor after the worktree is removed. It is unreferenced, so git
 * will eventually garbage-collect it — fine for a review session, and the reason
 * comparisons are recomputed rather than cached across restarts.
 */
export class GitWorktreeReplay {
    constructor(
        private readonly cwd: string,
        private readonly runner: GitRunner
    ) {}

    async replay(hashes: string[]): Promise<ReplayResult> {
        if (hashes.length === 0) {
            throw new Error('Select at least one commit to compare');
        }

        const ordered = await this.oldestFirst(hashes);
        const { baseRev, unreplayable } = await this.baseForSelection(ordered);

        const worktreePath = mkdtempSync(join(tmpdir(), 'githawk-replay-'));
        const skipped = [...unreplayable];
        const toApply = ordered.filter(
            (hash) => !unreplayable.some((entry) => entry.hash === hash)
        );

        const dispose = async () => {
            try {
                await this.runner.run(
                    ['worktree', 'remove', '--force', worktreePath],
                    this.cwd
                );
            } catch {
                // Fall back to removing the directory; git prunes the stale
                // administrative entry on its next worktree command.
                rmSync(worktreePath, { recursive: true, force: true });
            }
        };

        try {
            await this.runner.run(
                ['worktree', 'add', '--detach', '--quiet', worktreePath, baseRev],
                this.cwd
            );

            for (const hash of toApply) {
                try {
                    // One commit at a time, each committed, so a conflict in the
                    // middle cannot discard what already applied.
                    await this.runner.run(
                        ['cherry-pick', '--allow-empty', '--keep-redundant-commits', hash],
                        worktreePath
                    );
                } catch (error) {
                    skipped.push({
                        hash,
                        reason: reasonFor(error),
                    });
                    // Leave the replay in a clean state and carry on.
                    await this.abortCherryPick(worktreePath);
                }
            }

            const resultRev = (
                await this.runner.run(['rev-parse', 'HEAD'], worktreePath)
            ).trim();

            return { baseRev, resultRev, worktreePath, skipped, dispose };
        } catch (error) {
            await dispose();
            throw error;
        }
    }

    /** Selection order is a UI concern; replay must follow history's order. */
    private async oldestFirst(hashes: string[]): Promise<string[]> {
        const output = await this.runner.run(
            ['rev-list', '--no-walk', '--date-order', ...hashes],
            this.cwd
        );

        const newestFirst = output
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean);

        return newestFirst.reverse();
    }

    /**
     * The "before" state for the selection: a commit containing none of the
     * selected changes.
     *
     * This is the common ancestor of the selection's **parents**, not of the
     * selection itself. Using the selection directly is subtly wrong whenever one
     * selected commit is an ancestor of another: `merge-base A C` returns A, so A
     * becomes the base and A's own changes silently vanish from the aggregate.
     *
     * A root commit has no parent to step back to, so it cannot be replayed onto
     * anything and is reported rather than quietly dropped.
     */
    private async baseForSelection(ordered: string[]): Promise<{
        baseRev: string;
        unreplayable: { hash: string; reason: string }[];
    }> {
        const parents: string[] = [];
        const unreplayable: { hash: string; reason: string }[] = [];

        for (const hash of ordered) {
            try {
                const parent = (
                    await this.runner.run(['rev-parse', `${hash}^`], this.cwd)
                ).trim();
                parents.push(parent);
            } catch {
                unreplayable.push({
                    hash,
                    reason: 'is a root commit, so it has no parent to replay onto',
                });
            }
        }

        if (parents.length === 0) {
            throw new Error(
                'The selection contains only root commits, which cannot be combined'
            );
        }

        if (parents.length === 1) {
            return { baseRev: parents[0], unreplayable };
        }

        try {
            const base = (
                await this.runner.run(
                    ['merge-base', '--octopus', ...parents],
                    this.cwd
                )
            ).trim();
            if (base) {
                return { baseRev: base, unreplayable };
            }
        } catch {
            // Unrelated histories share no ancestor; the oldest parent is the
            // closest usable base, and anything that will not apply on top of it
            // is reported as skipped.
        }

        return { baseRev: parents[0], unreplayable };
    }

    private async abortCherryPick(worktreePath: string): Promise<void> {
        try {
            await this.runner.run(['cherry-pick', '--abort'], worktreePath);
        } catch {
            // --abort fails when there is no cherry-pick in progress, which is
            // the case when the commit was refused before it began.
            try {
                await this.runner.run(['reset', '--hard'], worktreePath);
            } catch {
                // Nothing further to do; the worktree is discarded anyway.
            }
        }
    }
}

function reasonFor(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);

    if (/after resolving the conflicts|could not apply|CONFLICT/i.test(message)) {
        return 'conflicts with the other selected commits';
    }
    if (/mainline|is a merge/i.test(message)) {
        return 'is a merge commit, which has no single set of changes';
    }
    return message.split('\n')[0] || 'could not be applied';
}
