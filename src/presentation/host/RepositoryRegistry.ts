import * as vscode from 'vscode';
import { DiscoverRepositoriesUseCase } from '../../application/usecases/DiscoverRepositoriesUseCase';
import { RepositoryLocation } from '../../domain/models/RepositoryLocation';
import { IRepositoryLocator } from '../../domain/repositories/IRepositoryLocator';
import { chooseActiveRepository } from '../../domain/services/repositoryDiscovery';
import { CONFIG_SECTION, SCAN_DEPTH_SETTING, repositoryScanDepth } from './config';
import { log } from './log';

/** Where the chosen repository is remembered, per workspace. */
const ACTIVE_REPOSITORY_KEY = 'gitHawk.activeRepository';

interface RepositoryItem extends vscode.QuickPickItem {
    root?: string;
    rescan?: boolean;
}

function depthSettingButton(): vscode.QuickInputButton {
    return {
        iconPath: new vscode.ThemeIcon('gear'),
        tooltip: `Change how deep GitHawk searches (${CONFIG_SECTION}.${SCAN_DEPTH_SETTING})`,
    };
}

export class NoWorkspaceFolderError extends Error {
    constructor() {
        super('Open a folder to see its git graph.');
        this.name = 'NoWorkspaceFolderError';
    }
}

export class NoRepositoryFoundError extends Error {
    constructor(readonly searchedDepth: number) {
        super(
            `No git repository found in the workspace. GitHawk searched ${searchedDepth} level(s) deep — raise ${CONFIG_SECTION}.${SCAN_DEPTH_SETTING} to look further.`
        );
        this.name = 'NoRepositoryFoundError';
    }
}

/**
 * Knows every repository in the workspace and which one the rest of the
 * extension is currently looking at.
 *
 * Everything that talks to git resolves its working directory through here, so
 * switching repository is a single piece of state rather than a parameter
 * threaded through the graph, the writer, the comparer, and the diff editor.
 */
export class RepositoryRegistry implements vscode.Disposable {
    private repositories: RepositoryLocation[] = [];
    private activeRoot?: string;
    /** False until the first scan finishes, which changes what an empty list means. */
    private hasScanned = false;
    private lastSearchedDepth = 0;
    private inFlight?: Promise<void>;

    private readonly changed = new vscode.EventEmitter<void>();
    /** Fires when the list or the active repository changes. */
    readonly onDidChange = this.changed.event;

    constructor(
        private readonly memento: vscode.Memento,
        private readonly createLocator: () => IRepositoryLocator,
        /**
         * Resolves symlinks. Injected because touching the filesystem is not
         * this tier's job, and because it is only needed to reconcile two
         * spellings of the same directory — see setActiveByRealPath.
         */
        private readonly resolveRealPath: (path: string) => string = (path) =>
            path
    ) {}

    get all(): readonly RepositoryLocation[] {
        return this.repositories;
    }

    get active(): RepositoryLocation | undefined {
        return this.repositories.find((r) => r.root === this.activeRoot);
    }

    /**
     * Rescans and re-picks. Concurrent callers share one scan: a workspace
     * change and a refresh landing together would otherwise walk the disk twice
     * and race over which result wins.
     */
    refresh(): Promise<void> {
        this.inFlight ??= this.scan().finally(() => {
            this.inFlight = undefined;
        });
        return this.inFlight;
    }

    private async scan(): Promise<void> {
        const folders = (vscode.workspace.workspaceFolders ?? []).map(
            (folder) => folder.uri.fsPath
        );
        const maxDepth = repositoryScanDepth();

        const started = Date.now();
        const found = await new DiscoverRepositoriesUseCase(
            this.createLocator()
        ).execute({ workspaceFolders: folders, maxDepth });

        this.repositories = found.repositories;
        this.hasScanned = true;
        this.lastSearchedDepth = maxDepth;

        this.activeRoot = chooseActiveRepository(this.repositories, {
            preferredRoot: this.storedRoot(),
            activeFilePath: activeEditorPath(),
        })?.root;
        void this.remember(this.activeRoot);

        log.info(
            `found ${found.repositories.length} repositor(ies) in ${found.scannedDirectories} directories (depth ${maxDepth}, ${Date.now() - started}ms): ${found.repositories.map((r) => r.name).join(', ') || 'none'}`
        );

        if (found.reachedLimit) {
            log.warn(
                `the repository scan stopped at its directory limit, so the list may be incomplete. Lower ${CONFIG_SECTION}.${SCAN_DEPTH_SETTING}.`
            );
        }

        this.changed.fire();
    }

    /**
     * The working directory for every git command.
     *
     * Falls back to the first workspace folder only before the first scan has
     * finished, so an early load still works; once the scan has run, "nothing
     * found" is reported as such rather than silently pointing at a folder that
     * is not a repository.
     */
    rootOrThrow(): string {
        const active = this.active;
        if (active) {
            return active.root;
        }

        const folders = vscode.workspace.workspaceFolders;
        if (!folders || folders.length === 0) {
            throw new NoWorkspaceFolderError();
        }
        if (this.hasScanned) {
            throw new NoRepositoryFoundError(this.lastSearchedDepth);
        }

        return folders[0].uri.fsPath;
    }

    /** Switches repository. A root that is not in the list is ignored. */
    setActive(root: string): void {
        const match = this.repositories.find((r) => r.root === root);
        if (!match || match.root === this.activeRoot) {
            return;
        }

        this.activeRoot = match.root;
        void this.remember(match.root);
        log.info(`switched to repository ${match.root}`);
        this.changed.fire();
    }

    /**
     * Switches to a path that came from git rather than from the workspace.
     *
     * The two disagree: git resolves symlinks, so a workspace opened at
     * `/tmp/repo` is `/private/tmp/repo` in every `git worktree list`. Comparing
     * the strings directly never matches on macOS, and the failure is silent —
     * "Show in GitHawk" would simply do nothing.
     *
     * Returns false when the path is not a discovered repository, which is a
     * real answer: a worktree outside the workspace, or deeper than the scan
     * reaches, cannot be shown here.
     */
    setActiveByRealPath(path: string): boolean {
        const wanted = this.realPath(path);
        const match = this.repositories.find(
            (repository) =>
                repository.root === path || this.realPath(repository.root) === wanted
        );

        if (!match) {
            return false;
        }
        this.setActive(match.root);
        return true;
    }

    private realPath(path: string): string {
        try {
            return this.resolveRealPath(path);
        } catch {
            // A path that cannot be resolved — deleted, or unreadable — is left
            // as written, so the exact-match case still works.
            return path;
        }
    }

    /**
     * Shows the picker. Offers a rescan at the bottom, because "my new
     * repository is not listed" is the one problem the list itself cannot solve.
     */
    async pick(): Promise<void> {
        if (!this.hasScanned) {
            await this.refresh();
        }

        if (this.repositories.length === 0) {
            const choice = await vscode.window.showInformationMessage(
                `GitHawk found no git repository in this workspace (searched ${this.lastSearchedDepth} level(s) deep).`,
                'Change search depth',
                'Search again'
            );
            if (choice === 'Change search depth') {
                await this.openDepthSetting();
            } else if (choice === 'Search again') {
                await this.refresh();
            }
            return;
        }

        /*
         * createQuickPick rather than showQuickPick, which cannot carry buttons.
         * The gear next to "Search again" is what turns "my repository is not
         * listed" into a fixable problem without leaving the picker to go
         * hunting through settings.
         */
        const quickPick = vscode.window.createQuickPick<RepositoryItem>();
        quickPick.title = 'GitHawk: switch repository';
        quickPick.placeholder = 'Choose a repository';
        quickPick.matchOnDescription = true;
        quickPick.matchOnDetail = true;
        quickPick.items = this.pickItems();
        // Also in the title bar, so the gear is reachable without scrolling to
        // the bottom of a long list.
        quickPick.buttons = [depthSettingButton()];

        return new Promise<void>((resolve) => {
            const close = () => {
                quickPick.dispose();
                resolve();
            };

            quickPick.onDidTriggerButton(() => {
                void this.openDepthSetting();
                close();
            });
            quickPick.onDidTriggerItemButton(() => {
                void this.openDepthSetting();
                close();
            });
            quickPick.onDidAccept(() => {
                const chosen = quickPick.selectedItems[0];
                close();
                if (chosen?.rescan) {
                    void this.refresh();
                } else if (chosen?.root) {
                    this.setActive(chosen.root);
                }
            });
            // Covers dismissal with Escape, and clicking away.
            quickPick.onDidHide(close);
            quickPick.show();
        });
    }

    private pickItems(): RepositoryItem[] {
        const items: RepositoryItem[] = this.repositories.map((repository) => ({
            // The check mark is the only reliable way to show which is active:
            // QuickPick's own `picked` state is not rendered for a single-select.
            label: `${repository.root === this.activeRoot ? '$(check)' : '$(repo)'} ${repository.name}`,
            description: repository.description,
            detail: repository.root,
            root: repository.root,
        }));

        items.push(
            { label: '', kind: vscode.QuickPickItemKind.Separator },
            {
                label: '$(search) Search again',
                description: `looks ${this.lastSearchedDepth} level(s) deep`,
                rescan: true,
                buttons: [depthSettingButton()],
            }
        );

        return items;
    }

    /** See gitHawk.repositoryPickItems: structure only, nothing shown. */
    pickItemsForTesting(): {
        labels: string[];
        /** Labels of the entries carrying a settings button. */
        withSettingsButton: string[];
    } {
        const items = this.pickItems();
        return {
            labels: items.map((item) => item.label),
            withSettingsButton: items
                .filter((item) => (item.buttons?.length ?? 0) > 0)
                .map((item) => item.label),
        };
    }

    private async openDepthSetting(): Promise<void> {
        // Opens Settings filtered to the one setting, rather than to the
        // extension's whole section.
        await vscode.commands.executeCommand(
            'workbench.action.openSettings',
            `${CONFIG_SECTION}.${SCAN_DEPTH_SETTING}`
        );
    }

    private storedRoot(): string | undefined {
        return this.memento.get<string>(ACTIVE_REPOSITORY_KEY);
    }

    private async remember(root: string | undefined): Promise<void> {
        if (root === this.storedRoot()) {
            return;
        }
        try {
            await this.memento.update(ACTIVE_REPOSITORY_KEY, root);
        } catch (error) {
            // Losing the preference is a nuisance, not a failure.
            log.warn(`could not remember the active repository: ${String(error)}`);
        }
    }

    dispose(): void {
        this.changed.dispose();
    }
}

function activeEditorPath(): string | undefined {
    const document = vscode.window.activeTextEditor?.document;
    // Only real files locate a repository; a diff or an output channel does not.
    return document?.uri.scheme === 'file' ? document.uri.fsPath : undefined;
}
