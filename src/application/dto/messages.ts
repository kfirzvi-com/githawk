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
    | { type: 'comparison:loading' }
    | { type: 'comparison:loaded'; comparison: ComparisonDto }
    | { type: 'comparison:error'; message: string }
    | { type: 'comparison:cleared' };

export type WebviewToHostMessage =
    | { type: 'graph:refresh' }
    | { type: 'commit:select'; hash: string }
    /** Opens the native action menu for a commit. */
    | { type: 'commit:menu'; hash: string }
    /** Opens the native action menu for a branch. */
    | { type: 'branch:menu'; name: string; isRemote: boolean; isCurrent: boolean }
    | { type: 'remote:operation'; operation: 'fetch' | 'pull' | 'push' }
    /** Review the current branch against a base branch, chosen by the host. */
    | { type: 'compare:branch'; base?: string; includeWorkingTree: boolean }
    /** Review an arbitrary set of selected commits together. */
    | { type: 'compare:commits'; hashes: string[] }
    | { type: 'compare:clear' }
    /** Open one changed file in VS Code's diff editor. */
    | {
          type: 'compare:openFile';
          path: string;
          previousPath?: string;
          baseRev: string;
          targetRev?: string;
      };
