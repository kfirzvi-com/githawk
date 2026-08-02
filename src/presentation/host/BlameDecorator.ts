import * as vscode from 'vscode';
import type { Blame, BlameBlock } from '../../domain/models/Blame';
import type { IBlameReader } from '../../domain/repositories/IBlameReader';
import { blameStyle, type BlameStyle } from './config';
import { gutterLabel, inlineLabel } from './blameLabels';
import { log } from './log';

/**
 * Draws blame into the editor.
 *
 * Three styles, because VS Code cannot do the obvious thing. Beside the line
 * numbers is a *gutter*, and a gutter takes an image — `gutterIconPath` is a
 * URI, not a string — so text there has to be drawn as an SVG per line and
 * handed over as a data URI. That works and is what this offers, but it renders
 * type as pictures, which does not scale with the editor's font or respect the
 * user's ligatures. The alternatives put real text either before the line, which
 * shifts the code right, or after it, which is where GitLens puts it.
 *
 * Which of the three is right is a matter of taste rather than of correctness,
 * so all three ship and `gitHawk.blame.style` chooses.
 */
export class BlameDecorator implements vscode.Disposable {
    /** One type per text style, disposed together: a stale type keeps drawing. */
    private readonly types = new Map<string, vscode.TextEditorDecorationType>();
    /**
     * The gutter's cost, made explicit. `gutterIconPath` exists only on the
     * options a decoration *type* is created with, not on the per-range options
     * — so a gutter label that differs per line needs a type per line. They are
     * held here and disposed on the next pass, because a type that is dropped
     * without being disposed keeps drawing forever.
     */
    private gutterTypes: vscode.TextEditorDecorationType[] = [];
    /** Cancels the blame in flight when the file changes underneath it. */
    private generation = 0;

    constructor(
        private readonly createReader: (root: string) => IBlameReader,
        private readonly repositoryRoot: () => string | undefined
    ) {}

    async decorate(editor: vscode.TextEditor | undefined): Promise<void> {
        const generation = ++this.generation;
        if (!editor) {
            return;
        }

        const style = blameStyle();
        this.clear(editor);
        if (style === 'off' || editor.document.uri.scheme !== 'file') {
            return;
        }

        const root = this.repositoryRoot();
        if (!root) {
            return;
        }

        let blame: Blame;
        try {
            blame = await this.createReader(root).read(
                editor.document.uri.fsPath
            );
        } catch (error) {
            // A file git has never seen is the common case here, not a fault.
            log.debug(`no blame for ${editor.document.uri.fsPath}: ${String(error)}`);
            return;
        }

        // The document may have been closed, edited, or replaced while git ran.
        if (generation !== this.generation || editor.document.isClosed) {
            return;
        }

        const now = new Date();
        if (style === 'gutter') {
            this.decorateGutter(editor, blame, now);
            return;
        }

        editor.setDecorations(
            this.typeFor(style),
            blame.blocks.map((block) =>
                this.optionsFor(block, style, now, editor.document)
            )
        );
    }

    /**
     * One decoration type per block, since each carries a different image.
     * Measured rather than assumed: see the note on `gutterTypes`.
     */
    private decorateGutter(
        editor: vscode.TextEditor,
        blame: Blame,
        now: Date
    ): void {
        this.disposeGutterTypes();

        for (const block of blame.blocks) {
            const type = vscode.window.createTextEditorDecorationType({
                gutterIconPath: gutterIcon(gutterLabel(block, now)),
                gutterIconSize: 'contain',
            });
            this.gutterTypes.push(type);

            const line = block.startLine - 1;
            editor.setDecorations(type, [
                {
                    range: new vscode.Range(line, 0, line, 0),
                    hoverMessage: hover(block),
                },
            ]);
        }
    }

    private disposeGutterTypes(): void {
        for (const type of this.gutterTypes) {
            type.dispose();
        }
        this.gutterTypes = [];
    }

    private optionsFor(
        block: BlameBlock,
        style: Exclude<BlameStyle, 'off' | 'gutter'>,
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
        const text = inlineLabel(block, now);

        if (style === 'inline') {
            return {
                range: new vscode.Range(line, 0, line, 0),
                hoverMessage: hover(block),
                renderOptions: { before: { contentText: `${text}  ` } },
            };
        }

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
        style: Exclude<BlameStyle, 'off' | 'gutter'>
    ): vscode.TextEditorDecorationType {
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

        const created = vscode.window.createTextEditorDecorationType(
            style === 'inline'
                ? {
                      before: {
                          color: colour,
                          fontStyle: 'italic',
                          margin: '0 1em 0 0',
                      },
                  }
                : { after: { color: colour, fontStyle: 'italic' } }
        );

        this.types.set(style, created);
        return created;
    }

    private clear(editor: vscode.TextEditor): void {
        for (const type of this.types.values()) {
            editor.setDecorations(type, []);
        }
        this.disposeGutterTypes();
    }

    dispose(): void {
        for (const type of this.types.values()) {
            type.dispose();
        }
        this.types.clear();
        this.disposeGutterTypes();
    }
}

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

/**
 * Text drawn as an SVG, because that is the only way to put words in the
 * gutter. Sized in `em` so it tracks the editor's font size, and coloured with
 * `currentColor` so VS Code's own gutter colour applies.
 */
function gutterIcon(text: string): vscode.Uri {
    const escaped = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="130" height="18">
<text x="0" y="13" font-family="var(--vscode-editor-font-family, monospace)" font-size="11" fill="#888" opacity="0.9">${escaped}</text>
</svg>`;

    return vscode.Uri.parse(
        `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
    );
}
