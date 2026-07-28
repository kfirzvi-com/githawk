import { Worktree } from '../models/Worktree';
import { baseName, joinPath, parentPath } from './paths';

/**
 * The rules that decide what a worktree UI may offer.
 *
 * Pure, because every one of them is a claim about git's behaviour — "this
 * checkout will be refused", "this removal will fail" — and a claim like that
 * should be asserted directly rather than discovered by a user.
 */

/** The worktree holding a branch, if any. Git allows at most one. */
export function worktreeHolding(
    worktrees: readonly Worktree[],
    branchName: string
): Worktree | undefined {
    return worktrees.find((worktree) => worktree.holds(branchName));
}

/**
 * Whether checking a branch out here would be refused.
 *
 * Git allows a branch in exactly one working tree. Offering a checkout that is
 * going to fail is worse than offering nothing, because the error names a path
 * rather than explaining the rule.
 */
export function blocksCheckout(
    worktrees: readonly Worktree[],
    branchName: string
): Worktree | undefined {
    const holder = worktreeHolding(worktrees, branchName);
    return holder && !holder.isCurrent ? holder : undefined;
}

/** Worktrees whose directory git can no longer find. */
export function prunableWorktrees(
    worktrees: readonly Worktree[]
): Worktree[] {
    return worktrees.filter((worktree) => worktree.isPrunable);
}

/**
 * A branch name as a directory name: `feature/login` → `feature-login`.
 *
 * Slashes become dashes rather than nested directories, so a worktree for
 * `feature/login` does not create a stray `feature/` folder next to the
 * repository, and so the name still reads as one thing in a file listing.
 */
export function slugForBranch(branchName: string): string {
    return (
        branchName
            .replace(/[\\/\s]+/g, '-')
            // Anything a path or a shell would find awkward; git ref names
            // already exclude most of it, but not every filesystem agrees.
            .replace(/[^A-Za-z0-9._-]/g, '')
            .replace(/-+/g, '-')
            .replace(/^[-.]+|[-.]+$/g, '') || 'worktree'
    );
}

/**
 * Where to put a new worktree for a branch: beside the repository, named after
 * it — `/projects/gitgrit` plus `feature/login` gives
 * `/projects/gitgrit-feature-login`.
 *
 * Beside rather than inside, for two reasons. A worktree inside the repository
 * shows up as an untracked directory in its own parent, which pollutes every
 * `git status`. And a sibling stays within the repository scan's reach, so a
 * new worktree appears in GitHawk's repository picker on the next refresh —
 * which a dot-directory would not, since the scan skips those.
 */
export function suggestWorktreePath(
    mainWorktreePath: string,
    branchName: string
): string {
    const parent = parentPath(mainWorktreePath);
    const repository = baseName(mainWorktreePath);

    return joinPath(parent, `${repository}-${slugForBranch(branchName)}`);
}

/**
 * Rejects a path git or the filesystem would choke on, before git is asked.
 *
 * A leading dash is the one that matters: `git worktree add` has no `--`
 * terminator, so a path starting with `-` is read as a flag.
 */
export function describePathProblem(path: string): string | undefined {
    const trimmed = path.trim();

    if (trimmed.length === 0) {
        return 'A path is required';
    }
    if (baseName(trimmed).startsWith('-')) {
        return 'A path segment cannot start with "-": git would read it as an option';
    }
    return undefined;
}

/**
 * Whether a path already belongs to a worktree of this repository, which git
 * would refuse — and which is worth catching first, because the error mentions
 * neither the existing worktree nor its branch.
 */
export function existingWorktreeAt(
    worktrees: readonly Worktree[],
    path: string
): Worktree | undefined {
    const wanted = path.trim().replace(/[\\/]+$/, '');
    return worktrees.find(
        (worktree) => worktree.path.replace(/[\\/]+$/, '') === wanted
    );
}
