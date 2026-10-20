import { Review, ReviewComment, commentsInOrder } from '../../domain/models/Review';

/**
 * A review's comments as a document an agent can act on.
 *
 * Written to a file rather than typed into the agent's terminal: a terminal
 * running an interactive tool treats every newline as "send", so a multi-line
 * review typed in arrives as a dozen half-messages. The file is read whole,
 * and the one line typed in is the instruction to read it.
 *
 * Each comment carries the lines it was written against, as they read then.
 * By the time the agent reaches the fifth comment it has edited the file for
 * the first four, and the line numbers no longer point where they did.
 */
export function reviewDocument(review: Review): string {
    const comments = commentsInOrder(review);
    const sections = comments.map((comment, index) => commentSection(comment, index + 1));

    return [
        `# Code review: ${review.label}`,
        '',
        `${comments.length === 1 ? 'One comment' : `${comments.length} comments`} left while reviewing this change in GitHawk.`,
        'Address each one in the code. Where a comment asks a question rather than for a change, answer it in your reply instead of editing anything.',
        'Line numbers are as they were when the comment was written; if they have moved, find the place by the quoted lines.',
        '',
        ...sections,
    ].join('\n');
}

function commentSection(comment: ReviewComment, number: number): string {
    const where =
        comment.line === comment.endLine
            ? `line ${comment.line}`
            : `lines ${comment.line}–${comment.endLine}`;
    const side = comment.side === 'old' ? ' (on lines the change removed)' : '';
    const fence = comment.excerpt.includes('```') ? '~~~~' : '```';

    return [
        `## ${number}. \`${comment.path}\`, ${where}${side}`,
        '',
        fence,
        comment.excerpt,
        fence,
        '',
        comment.body.trim(),
        '',
    ].join('\n');
}

/** The single line typed into the agent's terminal: what to read, and what to do with it. */
export function reviewPrompt(documentPath: string, count: number): string {
    return `Please address the ${count === 1 ? 'code review comment' : `${count} code review comments`} in ${documentPath} — read the file first; each comment names a file, the lines and what to change.`;
}

/**
 * A command line with the prompt in it, for tools that take a first message
 * as an argument (`claude "…"`, `codex "…"`). `{prompt}` becomes the prompt
 * in POSIX single quotes, which nothing inside can escape from — the prompt
 * contains a path, and a path can contain anything.
 */
export function commandWithPrompt(template: string, prompt: string): string {
    const quoted = `'${prompt.replace(/'/g, `'\\''`)}'`;
    return template.includes('{prompt}')
        ? template.split('{prompt}').join(quoted)
        : `${template} ${quoted}`;
}
