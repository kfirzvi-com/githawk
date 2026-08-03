import * as vscode from 'vscode';
import type { Blame, BlameBlock } from '../../domain/models/Blame';
import type {
    BlameRequest,
    IBlameReader,
} from '../../domain/repositories/IBlameReader';
import { REVISION_SCHEME, decodeRevisionUri } from './RevisionContentProvider';
import { blameStyle, type BlameStyle } from './config';
import { columnLabel, endOfLineLabel } from './blameLabels';
import {
    UNCOMMITTED_COLOUR,
    commitRanks,
    rampColour,
} from './blameColours';
import { log } from './log';

/**
 * Draws blame into the editor.
 *
 * Two placements, and the choice between them is taste rather than
 * correctness. `column` is IntelliJ's annotate: a fixed-width column of date
 * and author on every line, coloured by commit, sitting between the line
 * numbers and the code — which is where a `before` attachment lands, and where
 * IntelliJ's column is. `endOfLine` leaves the code where it is and annotates
 * the space to its right, one label per block.
 *
 * Beside the line numbers, strictly speaking, is not available: that is the
 * gutter, and a gutter takes an image, which VS Code scales to icon size. A
 * spike drew labels there as SVG and they came out as smudges.
 */
export class BlameDecorator implements vscode.Disposable {
    /** One type per text style, disposed together: a stale type keeps drawing. */
    private readonly types = new Map<string, vscode.TextEditorDecorationType>();
    /**
     * Cancels the blame in flight when a document changes underneath it. Kept
     * per document, not globally: a diff has two editors open at once and a
     * single counter would have each of them cancelling the other.
     */
    private readonly generations = new Map<string, number>();

    constructor(
        private readonly createReader: (root: string) => IBlameReader,
        /**
         * Which repository to ask about a given file. Passed the absolute path
         * for a file on disk, and nothing for a revision document, whose path
         * is repository-relative and belongs to the active repository.
         */
        private readonly repositoryRoot: (
            filePath?: string
        ) => string | undefined
    ) {}

    /**
     * Every editor on screen, not only the focused one — a diff is two editors,
     * and annotating whichever half happens to have focus is worse than
     * annotating neither.
     */
    async decorateVisible(): Promise<void> {
        await Promise.all(
            vscode.window.visibleTextEditors.map((editor) =>
                this.decorate(editor)
            )
        );
    }

    async decorate(editor: vscode.TextEditor | undefined): Promise<void> {
        if (!editor) {
            return;
        }

        const key = editor.document.uri.toString();
        const generation = (this.generations.get(key) ?? 0) + 1;
        this.generations.set(key, generation);

        const style = blameStyle();
        this.clear(editor);
        if (style === 'off') {
            return;
        }

        const request = requestFor(editor.document);
        if (!request) {
            return;
        }

        const root = this.repositoryRoot(
            editor.document.uri.scheme === 'file'
                ? editor.document.uri.fsPath
                : undefined
        );
        if (!root) {
            return;
        }

        let blame: Blame;
        try {
            blame = await this.createReader(root).read(request);
        } catch (error) {
            // A file git has never seen is the common case here, not a fault.
            log.debug(`no blame for ${editor.document.uri.fsPath}: ${String(error)}`);
            return;
        }

        // The document may have been closed, edited, or replaced while git ran.
        if (
            this.generations.get(key) !== generation ||
            editor.document.isClosed
        ) {
            return;
        }

        const now = new Date();
        if (style === 'column') {
            this.decorateColumn(editor, blame);
            return;
        }
        editor.setDecorations(
            this.typeFor(style),
            blame.blocks.map((block) =>
                this.optionsFor(block, now, editor.document)
            )
        );
    }

    /**
     * IntelliJ's annotate column: every line labelled, one fixed width, and a
     * colour per commit behind it so a run of lines from one commit reads as a
     * block without needing a separator.
     *
     * Every line rather than every block start, deliberately. It is the same
     * information — a run of identical labels sharing one background *is* the
     * block — but it survives scrolling into the middle of a run, which a label
     * only on the first line does not.
     *
     * The colours are ordered oldest to newest, so the column is also a reading
     * of how the file was built: cool at the bottom of its history, warm at the
     * top. See blameColours.
     */
    private decorateColumn(editor: vscode.TextEditor, blame: Blame): void {
        const ranks = commitRanks(blame.blocks);

        const options: vscode.DecorationOptions[] = [];
        for (const block of blame.blocks) {
            const text = columnLabel(block, COLUMN_WIDTH);
            const rank = ranks.get(block.commit.hash);
            const background =
                block.commit.isUncommitted || rank === undefined
                    ? UNCOMMITTED_COLOUR
                    : rampColour(rank, ranks.size);
            const message = hover(block);

            for (let line = block.startLine; line <= block.endLine; line++) {
                options.push({
                    range: new vscode.Range(line - 1, 0, line - 1, 0),
                    hoverMessage: message,
                    renderOptions: {
                        before: { contentText: text, backgroundColor: background },
                    },
                });
            }
        }

        editor.setDecorations(this.typeFor('column'), options);
    }

    /** endOfLine only; `column` builds its own, per line rather than per block. */
    private optionsFor(
        block: BlameBlock,
        now: Date,
        document: vscode.TextDocument
    ): vscode.DecorationOptions {
        /*
         * Anchored to the block's first line only. Repeating the label down
         * every line of a run is exactly the wall of names that blocks exist to
         * avoid, and it is also what makes the annotation readable as "this edit
         * starts here".
         */
        const line = block.startLine - 1;
        const text = endOfLineLabel(block, now);

        /*
         * At the *end* of the line, which means the range has to be there too:
         * an `after` decoration renders after its range, and a zero-width range
         * at column 0 puts "after" at the start of the line, in front of the
         * code. That is the same position `before` gives, so the two styles
         * looked identical until this was fixed.
         */
        const end = document.lineAt(line).range.end;
        return {
            range: new vscode.Range(end, end),
            hoverMessage: hover(block),
            renderOptions: { after: { contentText: `    ${text}` } },
        };
    }

    private typeFor(
        style: Exclude<BlameStyle, 'off'>
    ): vscode.TextEditorDecorationType {
        if (style === 'column') {
            return this.columnType();
        }
        const existing = this.types.get(style);
        if (existing) {
            return existing;
        }

        /*
         * `themeColor` rather than a literal: blame is chrome, so it must recede
         * in whatever theme the reader has chosen. Same reasoning as the panel.
         */
        const colour = new vscode.ThemeColor(
            'editorCodeLens.foreground'
        ) as unknown as string;

        const created = vscode.window.createTextEditorDecorationType({
            after: { color: colour, fontStyle: 'italic' },
        });

        this.types.set(style, created);
        return created;
    }

    /**
     * The column's own type. `width` in `ch` holds it open even on a line the
     * label does not fill, which is what keeps the code beside it aligned;
     * without it the column breathes line by line and the effect is lost.
     */
    private columnType(): vscode.TextEditorDecorationType {
        const existing = this.types.get('column');
        if (existing) {
            return existing;
        }

        const created = vscode.window.createTextEditorDecorationType({
            before: {
                color: new vscode.ThemeColor(
                    'editorLineNumber.foreground'
                ) as unknown as string,
                width: `${COLUMN_WIDTH + 1}ch`,
                margin: '0 0.6em 0 0',
                textDecoration: 'none; white-space: pre',
            },
        });
        this.types.set('column', created);
        return created;
    }

    private clear(editor: vscode.TextEditor): void {
        for (const type of this.types.values()) {
            editor.setDecorations(type, []);
        }
    }

    /**
     * See gitHawk.blame. What the decorator would draw, from the same reader
     * and the same grouping — a hook that rebuilt either would assert a
     * rendering no reader ever sees.
     */
    async blameForTesting(
        path: string
    ): Promise<
        | {
              startLine: number;
              endLine: number;
              author: string;
              summary: string;
              hash: string;
              isUncommitted: boolean;
          }[]
        | undefined
    > {
        const root = this.repositoryRoot(path);
        if (!root) {
            return undefined;
        }

        const blame = await this.createReader(root).read({ path });
        return blame.blocks.map((block) => ({
            startLine: block.startLine,
            endLine: block.endLine,
            author: block.commit.author,
            summary: block.commit.summary,
            hash: block.commit.hash,
            isUncommitted: block.commit.isUncommitted,
        }));
    }

    dispose(): void {
        for (const type of this.types.values()) {
            type.dispose();
        }
        this.types.clear();
    }
}

/**
 * What to blame, for whichever kind of document is on screen — or nothing, for
 * a document git cannot say anything about.
 *
 * The historical side of a diff is a `githawk-rev` document rather than a file,
 * and it is worth annotating: "who wrote this line, as of that commit" is the
 * question a diff raises. Without this the two sides of a comparison disagreed
 * — the working-tree side annotated, the revision side blank — which reads as a
 * bug rather than as a limit.
 */
function requestFor(document: vscode.TextDocument): BlameRequest | undefined {
    if (document.uri.scheme === REVISION_SCHEME) {
        const { rev, path } = decodeRevisionUri(document.uri);
        // A working-tree side is served as a file; anything else names a commit.
        return rev === '' || rev === 'WORKTREE'
            ? undefined
            : { path, rev };
    }

    if (document.uri.scheme !== 'file') {
        return undefined;
    }

    return {
        path: document.uri.fsPath,
        // Only when there is something on disk to disagree with.
        contents: document.isDirty ? document.getText() : undefined,
    };
}

/** Wide enough for `8/11/20` and eight characters of a name. */
const COLUMN_WIDTH = 16;

/**
 * A hover carries what the label had to leave out, and is where the link back
 * to the graph lives — decoration text is not clickable, but a MarkdownString
 * with `isTrusted` can hold a `command:` URI.
 */
function hover(block: BlameBlock): vscode.MarkdownString | undefined {
    if (block.commit.isUncommitted) {
        return new vscode.MarkdownString('Not committed yet.');
    }

    const { hash, shortHash, author, authorEmail, authoredAt, summary } =
        block.commit;
    const lines = block.endLine - block.startLine + 1;
    const argument = encodeURIComponent(JSON.stringify([hash]));

    const markdown = new vscode.MarkdownString(
        [
            `**${summary}**`,
            '',
            `${author} <${authorEmail}> — ${authoredAt.toLocaleString()}`,
            '',
            `${lines} line${lines === 1 ? '' : 's'} · [\`${shortHash}\` — show in the graph](command:gitHawk.revealCommit?${argument})`,
        ].join('\n')
    );
    // Required for a command: link to be clickable, and safe here because every
    // part of the string is either literal or URI-encoded.
    markdown.isTrusted = true;
    return markdown;
}
