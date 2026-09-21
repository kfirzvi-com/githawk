import * as vscode from 'vscode';
import type { IRevisionTreeReader } from '../../domain/repositories/IRevisionTreeReader';
import type { IGitRepository } from '../../domain/repositories/IGitRepository';
import { REVISION_FILES_VIEW_ID, RevisionFilesTree } from './RevisionFilesTree';
import { log } from './log';

/**
 * Fills the Files view with a revision, and knows which revision it is
 * showing. The tree draws; this decides what it draws.
 */
export class RevisionBrowser {
    /**
     * Which request is the one the tree should end up showing, for the same
     * reason the Changes tree has a ticket: git does not answer in the order
     * it was asked, and the reader's last click should win.
     */
    private ticket = 0;

    constructor(
        private readonly tree: RevisionFilesTree,
        private readonly createReader: () => IRevisionTreeReader,
        private readonly createRepository: () => IGitRepository
    ) {}

    /**
     * Shows every file at `rev` — a hash, branch or tag — and puts the view
     * in front. Resolved to a commit first, so the tree is pinned to what the
     * name meant when it was asked for; a branch that moves afterwards does
     * not move the tree under the reader.
     */
    async browse(rev: string): Promise<void> {
        const ticket = ++this.ticket;
        log.info(`browsing files at ${rev}`);
        try {
            const reader = this.createReader();
            const hash = await reader.resolve(rev);
            const [paths, subject] = await Promise.all([
                reader.listPaths(hash),
                this.subjectOf(hash),
            ]);
            if (ticket !== this.ticket) {
                return;
            }

            this.tree.show({ hash, subject, paths });
            await this.reveal();
        } catch (error) {
            if (ticket !== this.ticket) {
                return;
            }
            log.error(`could not browse ${rev}`, error);
            vscode.window.showErrorMessage(
                `GitHawk could not read the files at ${rev}: ${
                    error instanceof Error ? error.message : String(error)
                }`
            );
        }
    }

    get current() {
        return this.tree.current;
    }

    clear(): void {
        this.ticket += 1;
        this.tree.clear();
    }

    expandAll(): void {
        this.tree.expandAll();
    }

    /**
     * From the loaded graph, when the commit is in it; a commit past the
     * commit limit, or reached by a tag the graph did not load, is still
     * browsable — just without its subject in the title.
     */
    private async subjectOf(hash: string): Promise<string | undefined> {
        try {
            const repository = await this.createRepository().getRepository();
            return repository.getCommit(hash)?.subject;
        } catch {
            return undefined;
        }
    }

    /**
     * The view is contributed with a `when` clause on the context the tree
     * sets, so it may not exist yet when `show` returns; focusing it is what
     * makes VS Code create it. Not fatal if it cannot be: the tree is filled
     * either way.
     */
    private async reveal(): Promise<void> {
        try {
            await vscode.commands.executeCommand(`${REVISION_FILES_VIEW_ID}.focus`);
        } catch {
            // The revision is in the tree, just not surfaced.
        }
    }
}
