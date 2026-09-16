import type { PatchScope } from '../../domain/repositories/IWorkingTreeReader';

/**
 * How much of the diff a tool is shown. Past this the message gets no better
 * and the run gets slower and dearer; a change this large is better described
 * from its shape than from every line.
 */
export const PATCH_LIMIT_CHARS = 120_000;

/**
 * The instructions handed to whichever tool writes the message, with the
 * diff appended. Written for a model but kept plain enough that a person
 * piping it to `cat` could follow it too.
 *
 * The scope is said out loud because the two differ in what they promise:
 * a staged diff *is* the commit, while "everything" is a proposal the reader
 * will be asked to stage.
 */
export function commitMessagePrompt(patch: string, scope: PatchScope): string {
    const trimmed = truncate(patch, PATCH_LIMIT_CHARS);
    const what =
        scope === 'staged'
            ? 'The diff below is exactly what will be committed.'
            : 'Nothing is staged yet; the diff below is every uncommitted change, and all of it will be committed.';

    return [
        'Write a git commit message for the change below.',
        '',
        'Rules:',
        '- Output the message only: no preamble, no explanation, no code fences, no quotes around it.',
        '- First line: an imperative summary of at most 72 characters, no trailing full stop.',
        '- If the change needs more than the summary, add a blank line and then a short body saying what changed and why, wrapped at 72 columns.',
        '- Describe the change, not the files: "Stage and unstage files from the Changes view", not "Update ChangedFilesTree.ts".',
        '',
        what,
        '',
        trimmed,
    ].join('\n');
}

/**
 * What a tool prints is rarely exactly a message. Fences, a quoted block, a
 * "Commit message:" label, or a trailing note all turn up, and each would
 * otherwise land in history verbatim.
 */
export function cleanGeneratedMessage(raw: string): string {
    let text = raw.replace(/\r\n/g, '\n').trim();

    // A fenced block, with or without a language tag: keep what is inside.
    const fenced = /^```[^\n]*\n([\s\S]*?)\n```\s*$/.exec(text);
    if (fenced) {
        text = fenced[1].trim();
    } else {
        // Or a message whose first fence is stray: drop every fence line.
        text = text
            .split('\n')
            .filter((line) => !/^\s*```/.test(line))
            .join('\n')
            .trim();
    }

    // A label some tools insist on.
    text = text.replace(/^(?:commit message|message)\s*:\s*\n?/i, '').trim();

    // Wrapped in one pair of matching quotes, as a whole.
    const quoted = /^(["'`“])([\s\S]*)(["'`”])$/.exec(text);
    if (quoted && quoted[2].indexOf(quoted[1]) === -1) {
        text = quoted[2].trim();
    }

    // At most one blank line in a row, and no trailing spaces on any line.
    return text
        .split('\n')
        .map((line) => line.replace(/\s+$/, ''))
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function truncate(text: string, limit: number): string {
    if (text.length <= limit) {
        return text;
    }
    return `${text.slice(0, limit)}\n\n[diff truncated: ${
        text.length - limit
    } more characters not shown]`;
}
