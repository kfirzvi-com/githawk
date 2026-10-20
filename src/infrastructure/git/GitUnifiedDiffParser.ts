import { Hunk, hunkId } from '../../domain/models/Hunk';

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/;

/**
 * Splits `git diff` text into its hunks.
 *
 * Only the hunks are read. The file headers above them say nothing a review
 * needs that the Changes view does not already know, and skipping them means
 * a path containing `@@` cannot be mistaken for the start of a hunk — a
 * header line always begins `diff`, `index`, `---` or `+++`, and nothing is
 * read as a body line until a real `@@` has been seen.
 *
 * `\ No newline at end of file` is dropped: it describes the line above it,
 * and keeping it would make the hunk's id change with a file's last byte.
 */
export function parseUnifiedDiff(path: string, output: string): Hunk[] {
    const hunks: Omit<Hunk, 'id'>[] = [];
    let current: Omit<Hunk, 'id'> | undefined;

    for (const line of output.split('\n')) {
        const header = HUNK_HEADER.exec(line);
        if (header) {
            current = {
                oldStart: Number(header[1]),
                oldLines: header[2] === undefined ? 1 : Number(header[2]),
                newStart: Number(header[3]),
                newLines: header[4] === undefined ? 1 : Number(header[4]),
                context: header[5].trim(),
                lines: [],
            };
            hunks.push(current);
            continue;
        }
        if (line.startsWith('diff ')) {
            current = undefined;
            continue;
        }
        if (!current) {
            continue;
        }
        if (line.startsWith(' ') || line.startsWith('+') || line.startsWith('-')) {
            current.lines.push(line);
        }
    }

    return withIds(path, hunks);
}

/**
 * A file git has never seen, as the one hunk `git diff /dev/null file` would
 * print — read directly, because `--no-index` reports a difference by exiting
 * 1, which is indistinguishable from failing without parsing stderr.
 */
export function untrackedFileHunks(path: string, content: string): Hunk[] {
    if (content.includes('\0')) {
        return [];
    }
    const body = content.endsWith('\n') ? content.slice(0, -1) : content;
    if (body.length === 0) {
        return [];
    }
    const lines = body.split('\n').map((line) => `+${line}`);
    return withIds(path, [
        {
            oldStart: 0,
            oldLines: 0,
            newStart: 1,
            newLines: lines.length,
            context: '',
            lines,
        },
    ]);
}

function withIds(path: string, hunks: Omit<Hunk, 'id'>[]): Hunk[] {
    const seen = new Map<string, number>();
    return hunks.map((hunk) => {
        const base = hunkId(path, hunk.lines);
        const occurrence = seen.get(base) ?? 0;
        seen.set(base, occurrence + 1);
        return { ...hunk, id: hunkId(path, hunk.lines, occurrence) };
    });
}
