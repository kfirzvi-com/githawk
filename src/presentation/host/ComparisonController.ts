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

    /** Prompts for a base branch when one was not supplied. */
    async resolveBaseBranch(supplied?: string): Promise<string | undefined> {
        if (supplied) {
            return supplied;
        }

        const repository = await this.repositoryFor().getRepository();
        const current = repository.currentBranch?.name;

        const candidates = repository.branches
            .filter((branch) => branch.name !== current)
            // Local branches first: comparing against a local base is the common
            // case, and a long remote list would bury them.
            .sort((a, b) => {
                if (a.isLocal !== b.isLocal) {
                    return a.isLocal ? -1 : 1;
                }
                return a.name.localeCompare(b.name);
            })
            .map((branch) => ({
                label: branch.name,
                description: branch.isRemote ? 'remote' : undefined,
            }));

        if (candidates.length === 0) {
            vscode.window.showInformationMessage(
                'There is no other branch to compare against.'
            );
            return undefined;
        }

        const chosen = await vscode.window.showQuickPick(candidates, {
            title: current
                ? `Compare ${current} against…`
                : 'Compare the working tree against…',
            placeHolder: 'Choose the base branch',
        });

        return chosen?.label;
    }

    async compare(spec: ComparisonSpec): Promise<ComparisonDto> {
        return vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
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
