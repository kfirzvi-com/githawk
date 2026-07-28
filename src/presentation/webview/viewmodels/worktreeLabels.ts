import { baseName } from '../../../domain/services/paths';

/**
 * Shortens a worktree's directory name for the sidebar.
 *
 * Worktrees are conventionally named after the repository they belong to —
 * `gitgrit`, `gitgrit-readme`, `gitgrit-github-app` — which is useful in a file
 * listing and useless in a 256px column, where the repeated prefix pushes the
 * part that differs off the end. It cost the branch names their labels: a badge
 * reading `githawk-sample-handbook` truncated `docs/handbook` to `d…`.
 *
 * The full name is still available; callers put it in a tooltip.
 */
export function shortWorktreeName(path: string, mainPath?: string): string {
    const name = baseName(path);
    if (!mainPath) {
        return name;
    }

    const main = baseName(mainPath);
    if (name === main) {
        return name;
    }

    const prefix = `${main}-`;
    // Only when something is left over: a worktree called exactly `<repo>-`
    // would otherwise abbreviate to nothing.
    return name.startsWith(prefix) && name.length > prefix.length
        ? name.slice(prefix.length)
        : name;
}

/** The main worktree's path, which is the prefix everything else is shortened against. */
export function mainWorktreePath(
    worktrees: readonly { path: string; isMain: boolean }[]
): string | undefined {
    return worktrees.find((worktree) => worktree.isMain)?.path;
}
