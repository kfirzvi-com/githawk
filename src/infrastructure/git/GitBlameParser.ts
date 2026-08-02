import {
    Blame,
    BlameCommit,
    UNCOMMITTED_HASH,
    toBlocks,
} from '../../domain/models/Blame';

/**
 * Parses `git blame --porcelain`.
 *
 * The format is a header per line — `<sha> <origLine> <finalLine> [<count>]` —
 * followed by the commit's details the *first* time that commit appears, then a
 * tab-prefixed copy of the line itself. Later lines from the same commit carry
 * the header alone, so the details have to be remembered rather than re-read.
 * That back-reference is also what makes the format cheap on a large file.
 *
 * A header key can legitimately be missing (a commit with an empty message has
 * no `summary`), so every field defaults rather than assuming presence.
 */
export class GitBlameParser {
    static parse(output: string): Blame {
        const commits = new Map<string, Partial<BlameCommit> & { hash: string }>();
        const lines: { line: number; commit: BlameCommit }[] = [];

        let current: (Partial<BlameCommit> & { hash: string }) | undefined;
        let currentLine = 0;

        for (const raw of output.split('\n')) {
            // The content of the blamed line, which carries no information the
            // decorations need — the editor already has the file.
            if (raw.startsWith('\t')) {
                if (current) {
                    lines.push({
                        line: currentLine,
                        commit: complete(current),
                    });
                }
                current = undefined;
                continue;
            }

            const header = /^([0-9a-f]{40}) \d+ (\d+)(?: \d+)?$/.exec(raw);
            if (header) {
                const [, hash, finalLine] = header;
                current = commits.get(hash) ?? { hash };
                commits.set(hash, current);
                currentLine = Number(finalLine);
                continue;
            }

            if (!current) {
                continue;
            }

            const space = raw.indexOf(' ');
            const key = space === -1 ? raw : raw.slice(0, space);
            const value = space === -1 ? '' : raw.slice(space + 1);

            switch (key) {
                case 'author':
                    current.author = value;
                    break;
                case 'author-mail':
                    // Git wraps it in angle brackets; nothing else does.
                    current.authorEmail = value.replace(/^<|>$/g, '');
                    break;
                case 'author-time':
                    current.authoredAt = new Date(Number(value) * 1000);
                    break;
                case 'summary':
                    current.summary = value;
                    break;
            }
        }

        return { blocks: toBlocks(lines) };
    }
}

function complete(
    partial: Partial<BlameCommit> & { hash: string }
): BlameCommit {
    const isUncommitted = partial.hash === UNCOMMITTED_HASH;

    return {
        hash: partial.hash,
        shortHash: partial.hash.slice(0, 8),
        /*
         * Git names the uncommitted author after the current user, which reads
         * as though someone committed it. Saying so plainly is more useful, and
         * is what every other blame UI does.
         */
        author: isUncommitted ? 'You' : (partial.author ?? 'Unknown'),
        authorEmail: isUncommitted ? '' : (partial.authorEmail ?? ''),
        authoredAt: partial.authoredAt ?? new Date(0),
        summary: isUncommitted
            ? 'Uncommitted changes'
            : (partial.summary ?? ''),
        isUncommitted,
    };
}
