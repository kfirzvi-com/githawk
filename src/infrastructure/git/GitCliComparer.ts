import {
    Comparison,
    ComparisonSpec,
} from '../../domain/models/Comparison';
import { bySizeDescending } from '../../domain/models/FileChange';
import { IComparisonReader } from '../../domain/repositories/IComparisonReader';
import { GitDiffParser } from './GitDiffParser';
import {
    mergeBaseArgs,
    nameStatusArgs,
    numstatArgs,
    revParseArgs,
    showFileArgs,
} from './gitDiffCommands';
import { ExecFileGitRunner, GitRunner } from './GitRunner';
import { GitWorktreeReplay } from './GitWorktreeReplay';

export class GitCliComparer implements IComparisonReader {
    private readonly runner: GitRunner;

    constructor(
        private readonly cwd: string,
        runner?: GitRunner
    ) {
        this.runner = runner ?? new ExecFileGitRunner();
    }

    async compare(spec: ComparisonSpec): Promise<Comparison> {
        switch (spec.kind) {
            case 'branchAgainstBase':
                return this.compareBranchAgainstBase(spec);
            case 'twoRefs':
                return this.compareTwoRefs(spec);
            case 'singleCommit':
                return this.compareSingleCommit(spec);
            case 'commitRange':
                return this.compareRange(spec);
            case 'commitSet':
                return this.compareSet(spec);
        }
    }

    async fileContentAt(rev: string, path: string): Promise<string> {
        try {
            return await this.runner.run(showFileArgs(rev, path), this.cwd);
        } catch {
            // The file did not exist at that revision, which is normal for an
            // addition. An empty left-hand side is the correct diff.
            return '';
        }
    }

    /**
     * The "review my whole feature" case: diff from where the branch diverged, so
     * unrelated work that landed on the base afterwards does not appear inverted.
     */
    private async compareBranchAgainstBase(
        spec: Extract<ComparisonSpec, { kind: 'branchAgainstBase' }>
    ): Promise<Comparison> {
        const mergeBase = (
            await this.runner.run(mergeBaseArgs(spec.base, 'HEAD'), this.cwd)
        ).trim();

        // Two-dot from the merge base: to HEAD for committed work, or to the
        // working tree when uncommitted changes should be included.
        const revisions = spec.includeWorkingTree
            ? [mergeBase]
            : [mergeBase, 'HEAD'];

        const files = await this.readChanges(revisions);

        return {
            spec,
            method: 'mergeBase',
            label: spec.includeWorkingTree
                ? `${spec.base}…working tree`
                : `${spec.base}…HEAD`,
            files,
            baseRev: mergeBase,
            targetRev: spec.includeWorkingTree ? undefined : 'HEAD',
        };
    }

    /**
     * A direct comparison of two revisions, with no merge base involved.
     *
     * Deliberately two-dot: the question here is how two states differ, so an
     * unrelated commit on either side should show as a difference rather than be
     * excluded. That is the opposite of what a branch review wants, which is why
     * they are separate specs rather than one with a flag.
     */
    private async compareTwoRefs(
        spec: Extract<ComparisonSpec, { kind: 'twoRefs' }>
    ): Promise<Comparison> {
        const revisions = spec.rightIsWorkingTree
            ? [spec.left]
            : [spec.left, spec.right];

        const files = await this.readChanges(revisions);

        return {
            spec,
            method: 'direct',
            label: `${shorten(spec.left)} → ${
                spec.rightIsWorkingTree ? 'working tree' : shorten(spec.right)
            }`,
            files,
            baseRev: spec.left,
            targetRev: spec.rightIsWorkingTree ? undefined : spec.right,
        };
    }

    private async compareSingleCommit(
        spec: Extract<ComparisonSpec, { kind: 'singleCommit' }>
    ): Promise<Comparison> {
        const parent = `${spec.hash}^`;
        const baseRev = await this.resolveOrEmptyTree(parent);
        const files = await this.readChanges([baseRev, spec.hash]);

        return {
            spec,
            method: 'singleCommit',
            label: `${spec.hash.slice(0, 8)}`,
            files,
            baseRev,
            targetRev: spec.hash,
        };
    }

    private async compareRange(
        spec: Extract<ComparisonSpec, { kind: 'commitRange' }>
    ): Promise<Comparison> {
        const baseRev = await this.resolveOrEmptyTree(`${spec.oldest}^`);
        const files = await this.readChanges([baseRev, spec.newest]);

        return {
            spec,
            method: 'range',
            label: `${spec.oldest.slice(0, 8)}^…${spec.newest.slice(0, 8)}`,
            files,
            baseRev,
            targetRev: spec.newest,
        };
    }

    /**
     * An arbitrary selection has no single "before" state, so the changes are
     * reconstructed by replaying the selected commits onto their common ancestor
     * in a throwaway worktree, then diffing that. Non-destructive: the real
     * working tree, index, and HEAD are untouched.
     */
    private async compareSet(
        spec: Extract<ComparisonSpec, { kind: 'commitSet' }>
    ): Promise<Comparison> {
        // One commit needs no reconstruction, and this path also handles a lone
        // root commit, which cannot be replayed onto anything.
        if (spec.hashes.length === 1) {
            return this.compareSingleCommit({
                kind: 'singleCommit',
                hash: spec.hashes[0],
            });
        }

        const replay = new GitWorktreeReplay(this.cwd, this.runner);
        const result = await replay.replay(spec.hashes);

        try {
            const files = await this.readChanges(
                [result.baseRev, result.resultRev],
                result.worktreePath
            );

            return {
                spec,
                method: 'replay',
                label: `${spec.hashes.length} selected commits`,
                files,
                baseRev: result.baseRev,
                targetRev: result.resultRev,
                skipped: result.skipped,
            };
        } finally {
            await result.dispose();
        }
    }

    private async readChanges(revisions: string[], cwd = this.cwd) {
        const [nameStatus, numstat] = await Promise.all([
            this.runner.run(nameStatusArgs(revisions), cwd),
            this.runner.run(numstatArgs(revisions), cwd),
        ]);

        return GitDiffParser.parse(nameStatus, numstat).sort(bySizeDescending);
    }

    /**
     * A root commit has no parent, so `<hash>^` does not resolve. Git's empty
     * tree object stands in, which yields a diff showing the whole commit as
     * additions — which is what it is.
     */
    private async resolveOrEmptyTree(rev: string): Promise<string> {
        try {
            return (await this.runner.run(revParseArgs(rev), this.cwd)).trim();
        } catch {
            return EMPTY_TREE_OBJECT;
        }
    }
}

/** Full hashes are unreadable in a label; refs are left as they are. */
function shorten(rev: string): string {
    return /^[0-9a-f]{40}$/i.test(rev) ? rev.slice(0, 8) : rev;
}

/** git's well-known empty tree hash, valid in every repository. */
export const EMPTY_TREE_OBJECT = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
