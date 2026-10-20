import {
    AgentReply,
    Review,
    ReviewComment,
    commentsInOrder,
} from '../../domain/models/Review';

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
export function reviewDocument(review: Review, repliesPath?: string): string {
    const comments = commentsInOrder(review);
    const sections = comments.map((comment, index) => commentSection(comment, index + 1));

    return [
        `# Code review: ${review.label}`,
        '',
        `${comments.length === 1 ? 'One comment' : `${comments.length} comments`} left while reviewing this change in GitHawk.`,
        'Address each one in the code. Where a comment asks a question rather than for a change, answer it in your reply instead of editing anything. Where a comment has a conversation under it, the latest message is what to act on.',
        ...(repliesPath ? ['', ...replyInstructions(repliesPath), ''] : []),
        ...(review.spec.kind === 'workingTree'
            ? []
            : [
                  `What was reviewed is committed history (${describeSpec(review)}). Make the changes in the working tree as it is now, where the code may have moved on since those commits.`,
              ]),
        'Line numbers are as they were when the comment was written; if they have moved, find the place by the quoted lines.',
        '',
        ...sections,
    ].join('\n');
}

/** The revisions a review covers, in git's own words. */
function describeSpec(review: Review): string {
    const { spec } = review;
    switch (spec.kind) {
        case 'singleCommit':
            return `commit ${spec.hash.slice(0, 12)}`;
        case 'commitRange':
            return `commits ${spec.oldest.slice(0, 12)} to ${spec.newest.slice(0, 12)}`;
        case 'commitSet':
            return `commits ${spec.hashes.map((hash) => hash.slice(0, 12)).join(', ')}`;
        case 'twoRefs':
            return spec.rightIsWorkingTree
                ? `${spec.left.slice(0, 12)} against the working tree`
                : `${spec.left.slice(0, 12)}..${spec.right.slice(0, 12)}`;
        case 'branchAgainstBase':
            return `the branch against ${spec.base}`;
        case 'workingTree':
            return 'uncommitted changes';
    }
}

/**
 * How the agent answers, so its answer appears under the comment in the
 * editor. A file rather than anything tool-specific: every coding agent can
 * append a line to a file, and GitHawk is watching it.
 */
function replyInstructions(repliesPath: string): string[] {
    return [
        '## Replying',
        '',
        `When you have dealt with a comment, append one line of JSON for it to \`${repliesPath}\` (create the file if it is missing; never rewrite or reorder what is already in it):`,
        '',
        '```json',
        '{"comment": "<the id after the heading>", "status": "done", "reply": "What you changed, in a sentence or two."}',
        '```',
        '',
        '`status` is `done` when the change is made, `question` when you need an answer before you can act (ask it in `reply`), and `wontfix` when you think the comment should not be acted on (say why). Reply once per comment, after the work, not before. The reviewer reads these beside the code and may answer you.',
    ];
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
        `id: \`${comment.id}\``,
        '',
        fence,
        comment.excerpt,
        fence,
        '',
        comment.body.trim(),
        '',
        ...(comment.replies ?? []).flatMap((reply) => [
            `> **${reply.from === 'agent' ? `You (${reply.author ?? 'agent'})${reply.status ? `, ${reply.status}` : ''}` : 'Reviewer'}:** ${reply.body.trim().split('\n').join('\n> ')}`,
            '',
        ]),
    ].join('\n');
}

/**
 * What an agent wrote to the replies file: one JSON object a line, as asked.
 * Read forgivingly — a whole JSON array is taken too, and a line that is not
 * a reply is skipped rather than costing the lines after it.
 */
export function parseAgentReplies(text: string): AgentReply[] {
    const isReply = (value: unknown): value is AgentReply =>
        typeof value === 'object' &&
        value !== null &&
        typeof (value as AgentReply).comment === 'string' &&
        typeof (value as AgentReply).reply === 'string';
    const trimmed = text.trim();
    if (trimmed.startsWith('[')) {
        try {
            const all: unknown = JSON.parse(trimmed);
            return Array.isArray(all) ? all.filter(isReply) : [];
        } catch {
            // Not one array after all; fall through to lines.
        }
    }
    return trimmed
        .split('\n')
        .map((line) => {
            try {
                return JSON.parse(line) as unknown;
            } catch {
                return undefined;
            }
        })
        .filter(isReply);
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
