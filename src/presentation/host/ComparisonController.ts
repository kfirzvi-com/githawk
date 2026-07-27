import * as vscode from 'vscode';
import { ComparisonDto } from '../../application/dto/ComparisonDto';
import { CompareUseCase } from '../../application/usecases/CompareUseCase';
import { ComparisonSpec } from '../../domain/models/Comparison';
import { IComparisonReader } from '../../domain/repositories/IComparisonReader';
import { IGitRepository } from '../../domain/repositories/IGitRepository';
import { encodeRevisionUri } from './RevisionContentProvider';

export interface OpenFileRequest {
    path: string;
    previousPath?: string;
    baseRev: string;
    /** Undefined means the working tree, which opens the real editable file. */
    targetRev?: string;
}

/**
 * Runs comparisons and opens their files in VS Code's diff editor.
 *
 * The diff itself is deliberately not rendered in the webview: VS Code's editor
 * already has syntax highlighting, inline/side-by-side toggling, word-level
 * diffing, and navigation. Reimplementing that would be a worse copy of a tool
 * the user already knows.
 */
export class ComparisonController {
    constructor(
        private readonly readerFor: () => IComparisonReader,
        private readonly repositoryFor: () => IGitRepository,
        private readonly workspaceRootFor: () => string
    ) {}

    /**
     * Lets the user pick any revision to compare against: a branch, a tag, the
     * working tree, or a hash typed in. Deliberately not limited to branches, and
     * not limited to things related to HEAD — comparing two unrelated branches
     * while sitting on a third is a normal thing to want.
     */
    async pickRevision(
        title: string,
        options: { includeWorkingTree?: boolean } = {}
    ): Promise<{ rev: string; isWorkingTree: boolean } | undefined> {
        const repository = await this.repositoryFor().getRepository();

        interface RevisionItem extends vscode.QuickPickItem {
            rev?: string;
            isWorkingTree?: boolean;
        }

        const items: RevisionItem[] = [];

        if (options.includeWorkingTree !== false) {
            items.push({
                label: '$(edit) Working tree',
                description: 'including uncommitted changes',
                rev: 'WORKTREE',
                isWorkingTree: true,
            });
        }

        items.push({
            label: '$(git-commit) HEAD',
            description: repository.currentBranch?.name ?? 'detached',
            rev: 'HEAD',
        });

        const branches = repository.branches.slice().sort((a, b) => {
            if (a.isLocal !== b.isLocal) {
                return a.isLocal ? -1 : 1;
            }
            return a.name.localeCompare(b.name);
        });

        if (branches.length > 0) {
            items.push({
                label: 'Branches',
                kind: vscode.QuickPickItemKind.Separator,
            });
            for (const branch of branches) {
                items.push({
                    label: branch.name,
                    description: branch.isRemote ? 'remote' : undefined,
                    rev: branch.name,
                });
            }
        }

        const tags = [
            ...new Set(repository.commits.flatMap((commit) => commit.tagNames)),
        ].sort();
        if (tags.length > 0) {
            items.push({
                label: 'Tags',
                kind: vscode.QuickPickItemKind.Separator,
            });
            for (const tag of tags) {
                items.push({ label: tag, rev: tag });
            }
        }

        const chosen = await vscode.window.showQuickPick(items, {
            title,
            placeHolder: 'Choose a branch, tag, or revision',
            matchOnDescription: true,
        });

        if (!chosen?.rev) {
            return undefined;
        }

        return {
            rev: chosen.rev,
            isWorkingTree: chosen.isWorkingTree === true,
        };
    }

    async compare(spec: ComparisonSpec): Promise<ComparisonDto> {
        // A single commit's diff is fast and happens on every click, so it
        // reports in the status bar. Only the slow reconstruction, which spawns a
        // worktree, is worth a notification.
        const isQuick = spec.kind === 'singleCommit';

        return vscode.window.withProgress(
            {
                location: isQuick
                    ? vscode.ProgressLocation.Window
                    : vscode.ProgressLocation.Notification,
                title:
                    spec.kind === 'commitSet'
                        ? 'Combining the selected commits…'
                        : 'Comparing…',
            },
            () => new CompareUseCase(this.readerFor()).execute(spec)
        );
    }

    async openFile(request: OpenFileRequest): Promise<void> {
        // The left side is always historical; the right side is the working file
        // when comparing against the working tree, so edits go where expected.
        const left = encodeRevisionUri(
            request.baseRev,
            request.previousPath ?? request.path
        );
        const right = request.targetRev
            ? encodeRevisionUri(request.targetRev, request.path)
            : vscode.Uri.file(`${this.workspaceRootFor()}/${request.path}`);

        const title = request.previousPath
            ? `${request.previousPath} → ${request.path}`
            : request.path;

        await vscode.commands.executeCommand(
            'vscode.diff',
            left,
            right,
            title,
            { preview: true } satisfies vscode.TextDocumentShowOptions
        );
    }
}
