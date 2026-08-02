import { RepositoryLocation } from '../../domain/models/RepositoryLocation';
import { ComparisonDto } from './ComparisonDto';
import { GitGraphDto } from './GitGraphDto';
import { WorktreeDto } from './WorktreeDto';
import { WorkingTreeStatus } from '../../domain/models/WorkingTreeStatus';

/**
 * Every message crossing the webview boundary, in both directions.
 *
 * Discriminated unions mean an unhandled message type is a compile error rather
 * than a silent no-op — which is how the previous `{parents}` vs `{parentHashes}`
 * mismatch survived unnoticed.
 */
export type HostToWebviewMessage =
    | { type: 'graph:loaded'; graph: GitGraphDto }
    | { type: 'graph:error'; message: string }
    /** Kept so the webview can reflect selection state; files live in the tree. */
    | { type: 'comparison:loaded'; comparison: ComparisonDto }
    | { type: 'comparison:cleared' }
    /**
     * Sent separately from the graph, and on its own schedule: a scan is slower
     * than a load, and the picker must still appear when the graph itself failed.
     */
    | {
          type: 'repositories:loaded';
          repositories: RepositoryLocation[];
          activeRoot?: string;
      }
    /** Sent alongside the graph, so the sidebar can list the working trees. */
    | { type: 'worktrees:loaded'; worktrees: WorktreeDto[] }
    /**
     * Counts of what is uncommitted, for the row above the graph. Sent even
     * when everything is clean, because the row has to disappear as well as
     * appear.
     */
    | { type: 'workingTree:loaded'; status: WorkingTreeStatus }
    /** Select and scroll to a commit chosen somewhere other than the graph. */
    | { type: 'commit:reveal'; hash: string };

export type WebviewToHostMessage =
    | { type: 'graph:refresh' }
    | { type: 'commit:select'; hash: string }
    /** Show everything uncommitted, as one changeset against HEAD. */
    | { type: 'workingTree:select' }
    /** Opens the native action menu for a commit. */
    | { type: 'commit:menu'; hash: string }
    | { type: 'commit:copyHash'; hash: string }
    /** Opens the native action menu for a branch. */
    | { type: 'branch:menu'; name: string; isRemote: boolean; isCurrent: boolean }
    | { type: 'remote:operation'; operation: 'fetch' | 'pull' | 'push' }
    /** Opens the native manager for the repository's remotes. */
    | { type: 'remotes:menu' }
    /**
     * Show what these commits changed. One commit shows its own diff; several are
     * combined. Results land in the Changes tree, not in the webview.
     */
    | { type: 'compare:commits'; hashes: string[] }
    /** Diff exactly two commits directly against each other. */
    | { type: 'compare:twoCommits'; left: string; right: string }
    | { type: 'compare:clear' }
    /** Opens the native picker for switching repository. */
    | { type: 'repository:menu' }
    /** Opens the worktree manager, or one worktree's actions when given a path. */
    | { type: 'worktree:menu'; path?: string }
    /** Opens the stash manager, or one entry's actions when given its ref. */
    | { type: 'stash:menu'; ref?: string };
