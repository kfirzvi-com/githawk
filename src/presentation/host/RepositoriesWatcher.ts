import * as vscode from 'vscode';
import { RepositoryWatcher } from './RepositoryWatcher';

/**
 * A {@link RepositoryWatcher} for every repository in the workspace, saying
 * which one moved.
 *
 * The graph watches only the selected repository, because a change anywhere
 * else does not move its graph. The Repositories view lists them all, and a
 * commit or a checkout in any of them — from a terminal, an agent, VS Code's
 * own Source Control — changes its row.
 */
export class RepositoriesWatcher implements vscode.Disposable {
    private readonly watchers = new Map<string, RepositoryWatcher>();
    private readonly subscriptions = new Map<string, vscode.Disposable>();

    private readonly changed = new vscode.EventEmitter<string>();
    /** The root of the repository whose metadata changed. */
    readonly onDidChange = this.changed.event;

    constructor(private readonly createWatcher: () => RepositoryWatcher) {}

    /** Watches exactly these roots: new ones are added, gone ones dropped, the rest kept. */
    async watch(roots: readonly string[]): Promise<void> {
        const wanted = new Set(roots);

        for (const root of [...this.watchers.keys()]) {
            if (!wanted.has(root)) {
                this.drop(root);
            }
        }

        await Promise.all(
            roots
                .filter((root) => !this.watchers.has(root))
                .map(async (root) => {
                    const watcher = this.createWatcher();
                    this.watchers.set(root, watcher);
                    this.subscriptions.set(
                        root,
                        watcher.onDidChange(() => this.changed.fire(root))
                    );
                    try {
                        await watcher.watch(root);
                    } catch {
                        // A repository whose .git cannot be resolved is still
                        // listed; it just will not refresh on its own.
                    }
                })
        );
    }

    /** Re-applies the auto-refresh setting to every watcher. */
    async rewatch(): Promise<void> {
        const roots = [...this.watchers.keys()];
        for (const root of roots) {
            this.drop(root);
        }
        await this.watch(roots);
    }

    private drop(root: string): void {
        this.subscriptions.get(root)?.dispose();
        this.subscriptions.delete(root);
        this.watchers.get(root)?.dispose();
        this.watchers.delete(root);
    }

    dispose(): void {
        for (const root of [...this.watchers.keys()]) {
            this.drop(root);
        }
        this.changed.dispose();
    }
}
