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
    constructor(private readonly readerFor: () => IComparisonReader) {}

    async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
        const { rev, path } = decodeRevisionUri(uri);
        try {
            return await this.readerFor().fileContentAt(rev, path);
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
export function encodeRevisionUri(rev: string, path: string): vscode.Uri {
    return vscode.Uri.from({
        scheme: REVISION_SCHEME,
        path: `/${path}`,
        query: rev,
    });
}

export function decodeRevisionUri(uri: vscode.Uri): { rev: string; path: string } {
    return {
        rev: uri.query,
        path: uri.path.replace(/^\//, ''),
    };
}
