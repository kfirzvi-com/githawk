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
    /**
     * Opens the branch list as a picker, with the checkout already chosen.
     * Distinct from `branch:menu`, which is everything one named branch can
     * have done to it.
     */
    | { type: 'branch:switch' }
    /**
     * Grows the panel to the full window, or puts it back. The panel's height
     * belongs to the workbench, not to anything the webview can draw, so this
     * is a request for VS Code to run its own command.
     */
    | { type: 'panel:toggleMaximized' }
    /** Opens the worktree manager, or one worktree's actions when given a path. */
    | { type: 'worktree:menu'; path?: string }
    /** Opens the stash manager, or one entry's actions when given its ref. */
    | { type: 'stash:menu'; ref?: string };

/**
 * The commit box's half of the protocol. A separate pair of unions from the
 * graph's, because the two views are separate webviews with nothing in common
 * but the channel — a message meant for one arriving at the other should be a
 * type error, not a silently ignored case.
 */
export type HostToCommitViewMessage =
    /**
     * Everything the box shows. Sent whole on every change rather than as
     * deltas: the box is small, and a view that is rebuilt whenever the
     * sidebar hides it has to be able to draw itself from one message.
     */
    | {
          type: 'commit:state';
          status: WorkingTreeStatus;
          /** Names of the tools that can write a message, in setting order. */
          tools: string[];
          /** The last tool used, when it is still configured. */
          selectedTool: string | null;
          /** The reader's unsent message, kept by the host across rebuilds. */
          draft: string;
          /** A generation or a commit is in flight; the controls wait. */
          busy: boolean;
      }
    /** A tool wrote this; the box replaces the draft with it. */
    | { type: 'commit:generated'; message: string }
    /** The commit landed; the box empties. */
    | { type: 'commit:committed' };

export type CommitViewToHostMessage =
    /** The box exists and wants its state. */
    | { type: 'commit:ready' }
    /** The reader typed; the host keeps the draft so a rebuild does not lose it. */
    | { type: 'commit:draft'; message: string }
    | { type: 'commit:selectTool'; tool: string }
    /** Run the named tool over the changes and put its answer in the box. */
    | { type: 'commit:generate'; tool: string }
    /** Commit what is staged with this message. */
    | { type: 'commit:submit'; message: string }
    /** Open the Changes view's stage-everything action from the box. */
    | { type: 'commit:stageAll' };

/** What `vscodeApi` carries in either direction, for whichever view is running. */
export type AnyHostToWebviewMessage =
    | HostToWebviewMessage
    | HostToCommitViewMessage;
export type AnyWebviewToHostMessage =
    | WebviewToHostMessage
    | CommitViewToHostMessage;
