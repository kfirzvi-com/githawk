import { RepositoryLocation } from '../../domain/models/RepositoryLocation';
import { ComparisonDto } from './ComparisonDto';
import { GitGraphDto } from './GitGraphDto';

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
      };

export type WebviewToHostMessage =
    | { type: 'graph:refresh' }
    | { type: 'commit:select'; hash: string }
    /** Opens the native action menu for a commit. */
    | { type: 'commit:menu'; hash: string }
    | { type: 'commit:copyHash'; hash: string }
    /** Opens the native action menu for a branch. */
    | { type: 'branch:menu'; name: string; isRemote: boolean; isCurrent: boolean }
    | { type: 'remote:operation'; operation: 'fetch' | 'pull' | 'push' }
    /**
     * Show what these commits changed. One commit shows its own diff; several are
     * combined. Results land in the Changes tree, not in the webview.
     */
    | { type: 'compare:commits'; hashes: string[] }
    /** Diff exactly two commits directly against each other. */
    | { type: 'compare:twoCommits'; left: string; right: string }
    | { type: 'compare:clear' }
    /** Opens the native picker for switching repository. */
    | { type: 'repository:menu' };
