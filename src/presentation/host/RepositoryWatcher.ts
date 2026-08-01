import * as vscode from 'vscode';
import type { IGitDirectoryReader } from '../../domain/repositories/IGitDirectoryReader';
import { autoRefreshEnabled } from './config';
import { Debouncer } from './debounce';
import { log } from './log';

/**
 * Per-worktree state. `HEAD` moves on checkout, commit, and every step of a
 * rebase; `index` on `git add` and on a reset; the rest exist only while an
 * operation is half-finished, which is exactly when the graph is most wrong.
 */
const WORKTREE_FILES =
    '{HEAD,ORIG_HEAD,MERGE_HEAD,CHERRY_PICK_HEAD,REVERT_HEAD,REBASE_HEAD,index}';

/**
 * Shared state: every branch, tag, remote-tracking ref and stash entry, loose
 * or packed. A commit in *another* worktree of the same repository lands here,
 * which is why this is watched separately from the files above.
 */
const SHARED_REFS = '{packed-refs,refs/**}';

/** Long enough to swallow a burst, short enough to feel immediate. */
const DEBOUNCE_MS = 300;

/**
 * An upper bound, so an operation that writes steadily for a long time — a
 * rebase over hundreds of commits — still updates while it runs.
 */
const MAX_DEBOUNCE_MS = 2_000;

/**
 * Fires when the repository changes underneath us.
 *
 * The graph used to reload only after GitHawk's own actions, a workspace-folder
 * change, or the Refresh button. Everything else — a commit in a terminal, a
 * checkout from VS Code's own Source Control view, a coding agent rebasing in a
 * worktree — left the panel showing a repository that no longer existed, with
 * nothing to indicate it.
 *
 * Only git's own metadata is watched, not the working tree: every event here
 * costs a `git log` of the whole history, and a file being saved does not move
 * a single commit. Uncommitted work reaching the graph is a separate feature
 * and brings its own, cheaper, refresh.
 */
export class RepositoryWatcher implements vscode.Disposable {
    private watchers: vscode.FileSystemWatcher[] = [];
    private readonly changed = new vscode.EventEmitter<void>();
    readonly onDidChange = this.changed.event;

    private readonly debouncer = new Debouncer(
        () => this.changed.fire(),
        DEBOUNCE_MS,
        MAX_DEBOUNCE_MS
    );

    /**
     * Guards against a stale resolution winning. Switching repository twice
     * quickly leaves two `watch` calls in flight, and the slower one must not
     * install watchers for the repository that is no longer active.
     */
    private generation = 0;

    constructor(
        private readonly createDirectoryReader: (
            root: string
        ) => IGitDirectoryReader
    ) {}

    /**
     * Points the watcher at a repository, replacing whatever it was watching.
     * Passing `undefined` — no repository in the workspace — just stops. Also
     * how the setting is applied: turning it off re-runs this and installs
     * nothing.
     */
    async watch(root: string | undefined): Promise<void> {
        const generation = ++this.generation;
        this.stop();

        if (root === undefined || !autoRefreshEnabled()) {
            return;
        }

        const { gitDir, commonDir } =
            await this.createDirectoryReader(root).read();

        if (generation !== this.generation) {
            return;
        }

        this.watchers = [
            this.createWatcher(gitDir, WORKTREE_FILES),
            // In an ordinary checkout the two are the same directory; only a
            // linked worktree splits them.
            this.createWatcher(commonDir, SHARED_REFS),
        ];

        log.debug(
            `watching ${gitDir}${commonDir === gitDir ? '' : ` and ${commonDir}`} for changes`
        );
    }

    private createWatcher(
        directory: string,
        pattern: string
    ): vscode.FileSystemWatcher {
        const watcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(vscode.Uri.file(directory), pattern)
        );

        // All three matter equally: a branch is a file, so deleting one is a
        // delete, and packing loose refs is a create plus several deletes.
        watcher.onDidChange(() => this.debouncer.schedule());
        watcher.onDidCreate(() => this.debouncer.schedule());
        watcher.onDidDelete(() => this.debouncer.schedule());

        return watcher;
    }

    private stop(): void {
        this.debouncer.cancel();
        for (const watcher of this.watchers) {
            watcher.dispose();
        }
        this.watchers = [];
    }

    dispose(): void {
        this.stop();
        this.changed.dispose();
    }
}
