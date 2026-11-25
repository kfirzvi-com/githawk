import * as vscode from 'vscode';
import { IComparisonReader } from '../../domain/repositories/IComparisonReader';

export const REVISION_SCHEME = 'githawk-rev';

/**
 * Serves file contents at a git revision so VS Code's own diff editor can show
 * them. Registering a scheme is what lets `vscode.diff` compare two historical
 * revisions — without it, only files on disk are viewable.
 */
export class RevisionContentProvider
    implements vscode.TextDocumentContentProvider
{
    constructor(private readonly readerFor: (root?: string) => IComparisonReader) {}

    async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
        const { rev, path, root } = decodeRevisionUri(uri);
        try {
            return await this.readerFor(root).fileContentAt(rev, path);
        } catch (error) {
            return `Could not read ${path} at ${rev}\n\n${
                error instanceof Error ? error.message : String(error)
            }`;
        }
    }
}

/**
 * The path is kept in the URI's path so VS Code picks the right language for
 * syntax highlighting from the file extension; the revision travels in the query
 * so it does not disturb that.
 */
/**
 * `root` names the repository when it is not the one the graph shows — a row
 * of another repository in the Changes view. Left out otherwise, so every
 * URI made before there was a choice still reads the same.
 */
export function encodeRevisionUri(rev: string, path: string, root?: string): vscode.Uri {
    return vscode.Uri.from({
        scheme: REVISION_SCHEME,
        path: `/${path}`,
        query: rev,
        fragment: root ?? '',
    });
}

export function decodeRevisionUri(uri: vscode.Uri): { rev: string; path: string; root?: string } {
    return {
        rev: uri.query,
        path: uri.path.replace(/^\//, ''),
        root: uri.fragment || undefined,
    };
}
