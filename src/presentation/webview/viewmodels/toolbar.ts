import type { RepositoryLocation } from '../../../domain/models/RepositoryLocation';

export type ToolbarAction = 'refresh' | 'fetch' | 'pull' | 'push';

export interface ToolbarActionSpec {
    id: ToolbarAction;
    label: string;
    icon: string;
    primary: boolean;
}

/**
 * Four actions, all of which do something rather than open something.
 *
 * Managing remotes was briefly a fifth button here. It moved to the Remote
 * section in the sidebar, next to the remote branches it is about and matching
 * the Manage on Worktrees and Stashes — two ways into one manager is one too
 * many, and the sidebar is where the other three live.
 */
export const toolbarActions: ToolbarActionSpec[] = [
    { id: 'refresh', label: 'Refresh', icon: '↻', primary: true },
    { id: 'fetch', label: 'Fetch', icon: '⇣', primary: false },
    { id: 'pull', label: 'Pull', icon: '⇣', primary: false },
    { id: 'push', label: 'Push', icon: '⇡', primary: false },
];

export interface RepositoryIndicator {
    name: string;
    /** Where it is. Shown as a tooltip rather than inline. */
    detail: string;
    /**
     * How many there are to choose from. The control is always a selector, even
     * at one: the picker also offers a rescan, and "my new repository is not
     * listed" is the one problem a plain label cannot help with.
     */
    count: number;
}

/**
 * What the toolbar says about the repository being shown.
 *
 * Returns null when the host has reported none — before the first scan
 * finishes, and in the dev harness, which has no filesystem to scan. The
 * toolbar then looks exactly as it did before multi-repo existed, rather than
 * showing an empty control.
 */
export function repositoryIndicator(
    repositories: readonly RepositoryLocation[],
    activeRoot?: string
): RepositoryIndicator | null {
    if (repositories.length === 0) {
        return null;
    }

    // Falling back to the first rather than rendering nothing: a list with no
    // active root is a bug, but hiding the whole control makes it invisible.
    const active =
        repositories.find((repository) => repository.root === activeRoot) ??
        repositories[0];

    return {
        name: active.name,
        detail: active.description
            ? `${active.description} — ${active.root}`
            : active.root,
        count: repositories.length,
    };
}
