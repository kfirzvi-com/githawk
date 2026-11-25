import * as vscode from 'vscode';

/** Remembered per workspace: a workspace of several repositories is opened the way it was left. */
const SHOW_ALL_KEY = 'gitHawk.showAllRepositories';
/** The toggle's two buttons swap on this. */
export const ALL_REPOSITORIES_CONTEXT = 'gitHawk.allRepositories';
/** The toggle exists only where there is more than one repository to show. */
export const MULTIPLE_REPOSITORIES_CONTEXT = 'gitHawk.multipleRepositories';
/** The selectors above the commit box exist wherever there is a repository to select. */
export const HAS_REPOSITORY_CONTEXT = 'gitHawk.hasRepository';

/**
 * Whether the Changes view shows the selected repository's working tree or
 * every repository's at once.
 *
 * Only the Changes view reads this. The graph, the commit box and every
 * action without a row of its own stay on the selected repository: showing
 * more changes never changes where a commit lands.
 */
export class RepositoryScope implements vscode.Disposable {
    private all: boolean;
    private readonly changed = new vscode.EventEmitter<boolean>();
    readonly onDidChange = this.changed.event;

    constructor(private readonly memento: vscode.Memento) {
        this.all = memento.get<boolean>(SHOW_ALL_KEY, false);
        void vscode.commands.executeCommand('setContext', ALL_REPOSITORIES_CONTEXT, this.all);
    }

    get showsAll(): boolean {
        return this.all;
    }

    async set(all: boolean): Promise<void> {
        if (all === this.all) {
            return;
        }
        this.all = all;
        await vscode.commands.executeCommand('setContext', ALL_REPOSITORIES_CONTEXT, all);
        this.changed.fire(all);
        try {
            await this.memento.update(SHOW_ALL_KEY, all);
        } catch {
            // Forgetting the choice next time is a nuisance, not a failure.
        }
    }

    /** Called after every scan: one repository has nothing to toggle between. */
    noteRepositoryCount(count: number): void {
        void vscode.commands.executeCommand('setContext', MULTIPLE_REPOSITORIES_CONTEXT, count > 1);
        void vscode.commands.executeCommand('setContext', HAS_REPOSITORY_CONTEXT, count > 0);
    }

    dispose(): void {
        this.changed.dispose();
    }
}
